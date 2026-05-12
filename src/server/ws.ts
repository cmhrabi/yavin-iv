import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type {
  GateKind,
  ServerToWorker,
  ServerToClient,
  WorkerToServer,
  ClientToServer,
  Ticket,
  RepoConfig,
} from "@yavin/protocol";
import { eq } from "drizzle-orm";
import type { Caller } from "@/server/caller";
import { resolveCallerFromUpgrade, parseUpgradeUrl } from "@/server/ws-auth";
import { publish, subscribe as subscribePubsub } from "@/server/pubsub";
import { db, schema } from "@/db/client";
import {
  claimRun,
  filterOwnedRunIds,
  getRunById,
  isRunOwnedBy,
  transitionStatus,
  updateStage,
} from "@/server/runs";
import { appendEvent } from "@/server/events";
import { recordGateDecision } from "@/server/gates";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;

interface ClientEntry {
  ws: WebSocket;
  caller: Caller;
  subscriptions: Set<string>;
}

interface WorkerEntry {
  ws: WebSocket;
  caller: Caller;
}

const clientSubscribers = new Set<ClientEntry>();
const workerSockets = new Set<WorkerEntry>();
const workerClaims = new Map<string, WebSocket>();

let attached = false;

export function attachWebSocketServer(httpServer: HttpServer): void {
  if (attached) return;
  attached = true;

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = parseUpgradeUrl(req);
    } catch {
      return;
    }
    if (url.pathname !== "/ws") return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      const buffered: WebSocket.RawData[] = [];
      const bufferHandler = (data: WebSocket.RawData) => buffered.push(data);
      ws.on("message", bufferHandler);
      void onUpgrade(ws, req, url, buffered, bufferHandler).catch((err) => {
        console.error("[ws] upgrade handler threw", err);
        try {
          ws.close(1011, "server_error");
        } catch {
          // socket already torn down
        }
      });
    });
  });

  subscribePubsub((event) => {
    for (const sub of clientSubscribers) {
      if (sub.subscriptions.has(event.runId)) {
        send(sub.ws, event.message);
      }
    }
  });
}

async function onUpgrade(
  ws: WebSocket,
  req: IncomingMessage,
  url: URL,
  buffered: WebSocket.RawData[],
  bufferHandler: (data: WebSocket.RawData) => void,
): Promise<void> {
  const role = url.searchParams.get("role");
  if (role !== "worker" && role !== "client") {
    ws.removeListener("message", bufferHandler);
    ws.close(4400, "bad_role");
    return;
  }
  const caller = await resolveCallerFromUpgrade(req);
  if (!caller) {
    ws.removeListener("message", bufferHandler);
    ws.close(4401, "unauthorized");
    return;
  }
  ws.removeListener("message", bufferHandler);
  if (role === "worker") onWorker(ws, caller);
  else onClient(ws, caller);
  for (const data of buffered) {
    ws.emit("message", data);
  }
}

function send(ws: WebSocket, payload: ServerToWorker | ServerToClient): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function parseEnvelope<T extends { kind: string }>(data: WebSocket.RawData): T | null {
  try {
    const msg = JSON.parse(data.toString()) as unknown;
    if (
      msg &&
      typeof msg === "object" &&
      typeof (msg as { kind?: unknown }).kind === "string"
    ) {
      return msg as T;
    }
  } catch {
    // fall through
  }
  return null;
}

export function getAvailableWorker(): WorkerEntry | null {
  for (const entry of workerSockets) {
    if (entry.ws.readyState === entry.ws.OPEN) return entry;
  }
  return null;
}

async function loadTicketForWorker(
  runId: string,
): Promise<{ ticket: Ticket; repoConfig: RepoConfig } | null> {
  const [runRow] = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
    .limit(1);
  if (!runRow) return null;
  const [repoRow] = await db
    .select()
    .from(schema.repoConfigs)
    .where(eq(schema.repoConfigs.id, runRow.repoConfigId))
    .limit(1);
  if (!repoRow) return null;
  const ticket: Ticket = {
    provider: runRow.ticketProvider as Ticket["provider"],
    id: runRow.ticketId,
    url: runRow.ticketUrl,
    title: runRow.ticketTitle ?? runRow.ticketId,
    body: runRow.instructions,
  };
  const repoConfig: RepoConfig = {
    id: repoRow.id,
    name: repoRow.name,
    repoPath: repoRow.repoPath,
    baseBranch: repoRow.baseBranch,
    branchPrefix: repoRow.branchPrefix,
    concurrencyLimit: repoRow.concurrencyLimit,
    ticketProviders: Array.isArray(repoRow.ticketProviders)
      ? (repoRow.ticketProviders as RepoConfig["ticketProviders"])
      : [],
    githubRepo: repoRow.githubRepo,
    createdAt: repoRow.createdAt.toISOString(),
    updatedAt: repoRow.updatedAt.toISOString(),
  };
  return { ticket, repoConfig };
}

export async function sendRunStartToWorker(
  ws: WebSocket,
  runId: string,
): Promise<boolean> {
  const run = await getRunById(runId);
  if (!run) return false;
  const aux = await loadTicketForWorker(runId);
  if (!aux) return false;
  send(ws, { kind: "run.start", run, repoConfig: aux.repoConfig, ticket: aux.ticket });
  workerClaims.set(runId, ws);
  return true;
}

export async function dispatchPendingRun(runId: string): Promise<boolean> {
  const worker = getAvailableWorker();
  if (!worker) return false;
  const claimed = await claimRun(runId);
  if (!claimed) return false;
  await publish({ runId, message: { kind: "run.updated", run: claimed } });
  const ok = await sendRunStartToWorker(worker.ws, runId);
  return ok;
}

function onWorker(ws: WebSocket, caller: Caller): void {
  console.log(`[ws] worker connected userId=${caller.userId} kind=${caller.kind}`);
  const entry: WorkerEntry = { ws, caller };
  workerSockets.add(entry);

  let lastPongAt = Date.now();
  send(ws, { kind: "ping" });
  const interval = setInterval(() => {
    if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      console.log("[ws] worker missed heartbeat — terminating");
      ws.terminate();
      return;
    }
    send(ws, { kind: "ping" });
  }, HEARTBEAT_INTERVAL_MS);

  ws.on("message", (data) => {
    const msg = parseEnvelope<WorkerToServer>(data);
    if (!msg) {
      ws.close(4400, "bad_message");
      return;
    }
    void handleWorkerMessage(ws, msg).catch((err) => {
      console.error(`[ws] worker handler threw kind=${msg.kind}`, err);
    });
    if (msg.kind === "pong") {
      lastPongAt = Date.now();
    }
  });

  ws.once("close", (code, reason) => {
    clearInterval(interval);
    workerSockets.delete(entry);
    for (const [runId, claimWs] of workerClaims) {
      if (claimWs === ws) workerClaims.delete(runId);
    }
    console.log(`[ws] worker disconnected code=${code} reason=${reason.toString()}`);
  });
  ws.on("error", (err) => {
    console.error("[ws] worker error", err);
  });
}

async function handleWorkerMessage(ws: WebSocket, msg: WorkerToServer): Promise<void> {
  switch (msg.kind) {
    case "pong":
      return;

    case "run.claim": {
      const run = await claimRun(msg.runId);
      if (!run) {
        console.warn(`[ws] worker tried to claim missing run ${msg.runId}`);
        return;
      }
      workerClaims.set(msg.runId, ws);
      await publish({ runId: msg.runId, message: { kind: "run.updated", run } });
      const aux = await loadTicketForWorker(msg.runId);
      if (aux) {
        send(ws, { kind: "run.start", run, repoConfig: aux.repoConfig, ticket: aux.ticket });
      }
      return;
    }

    case "stage.started": {
      const stage = await updateStage(msg.runId, msg.stage.kind, {
        status: "running",
        startedAt: new Date(),
      });
      await publish({ runId: msg.runId, message: { kind: "stage.updated", stage } });
      return;
    }

    case "stage.completed": {
      const stage = await updateStage(msg.runId, msg.stage.kind, {
        status: "completed",
        endedAt: new Date(),
        output: msg.stage.output,
      });
      await publish({ runId: msg.runId, message: { kind: "stage.updated", stage } });
      return;
    }

    case "stage.failed": {
      const [stageRow] = await db
        .select({ runId: schema.stages.runId, kind: schema.stages.kind })
        .from(schema.stages)
        .where(eq(schema.stages.id, msg.stageId))
        .limit(1);
      if (stageRow) {
        const stage = await updateStage(
          stageRow.runId,
          stageRow.kind as import("@yavin/protocol").StageKind,
          {
            status: "failed",
            endedAt: new Date(),
            errorText: msg.error,
          },
        );
        await publish({ runId: msg.runId, message: { kind: "stage.updated", stage } });
      }
      try {
        const run = await transitionStatus(msg.runId, "failed");
        await publish({ runId: msg.runId, message: { kind: "run.updated", run } });
      } catch (err) {
        console.error(`[ws] stage.failed transition failed run=${msg.runId}`, err);
      }
      return;
    }

    case "event.append": {
      await appendEvent(msg.event);
      return;
    }

    case "agent.message": {
      await db.insert(schema.agentMessages).values({
        runId: msg.message.runId,
        stageId: msg.message.stageId,
        role: msg.message.role,
        content: msg.message.content as object,
        tokensIn: msg.message.tokensIn ?? null,
        tokensOut: msg.message.tokensOut ?? null,
        model: msg.message.model ?? null,
        costUsd: msg.message.costUsd?.toString() ?? null,
      });
      return;
    }

    case "gate.await": {
      const awaitingStatus = gateKindToAwaitingStatus(msg.gateKind);
      const run = await transitionStatus(msg.runId, awaitingStatus);
      await publish({ runId: msg.runId, message: { kind: "run.updated", run } });
      await publish({
        runId: msg.runId,
        message: {
          kind: "gate.awaiting",
          runId: msg.runId,
          gateKind: msg.gateKind,
          payload: msg.payload,
        },
      });
      return;
    }

    case "run.status":
      console.debug(`[ws] worker reported run.status run=${msg.runId} status=${msg.status}`);
      return;

    default: {
      const exhaustive: never = msg;
      void exhaustive;
      console.warn(`[ws] worker sent unhandled kind`);
      ws.close(4400, `unhandled_kind`);
      return;
    }
  }
}

function gateKindToAwaitingStatus(
  gateKind: GateKind,
): import("@yavin/protocol").RunStatus {
  switch (gateKind) {
    case "post_research":
      return "awaiting_research_approval";
    case "post_plan":
      return "awaiting_plan_approval";
    case "pre_pr":
      return "awaiting_pr_approval";
  }
}

function onClient(ws: WebSocket, caller: Caller): void {
  console.log(`[ws] client connected userId=${caller.userId} kind=${caller.kind}`);
  const entry: ClientEntry = { ws, caller, subscriptions: new Set<string>() };
  clientSubscribers.add(entry);

  let isAlive = true;
  ws.on("pong", () => {
    isAlive = true;
  });
  const interval = setInterval(() => {
    if (!isAlive) {
      console.log("[ws] client missed heartbeat — terminating");
      ws.terminate();
      return;
    }
    isAlive = false;
    try {
      ws.ping();
    } catch (err) {
      console.error("[ws] client ping failed", err);
    }
  }, HEARTBEAT_INTERVAL_MS);

  ws.on("message", (data) => {
    const msg = parseEnvelope<ClientToServer>(data);
    if (!msg) {
      ws.close(4400, "bad_message");
      return;
    }
    void handleClientMessage(entry, msg).catch((err) => {
      console.error(`[ws] client handler threw kind=${msg.kind}`, err);
    });
  });

  ws.once("close", (code, reason) => {
    clearInterval(interval);
    clientSubscribers.delete(entry);
    console.log(`[ws] client disconnected code=${code} reason=${reason.toString()}`);
  });
  ws.on("error", (err) => {
    console.error("[ws] client error", err);
  });
}

async function handleClientMessage(
  entry: ClientEntry,
  msg: ClientToServer,
): Promise<void> {
  switch (msg.kind) {
    case "subscribe": {
      const requested = msg.runIds ?? [];
      const owned = await filterOwnedRunIds(requested, entry.caller.userId);
      entry.subscriptions = new Set(owned);
      return;
    }

    case "gate.decide": {
      const allowed = await isRunOwnedBy(msg.runId, entry.caller.userId);
      if (!allowed) {
        console.warn(
          `[ws] client tried to decide gate on unowned run user=${entry.caller.userId} run=${msg.runId}`,
        );
        return;
      }
      const result = await recordGateDecision({
        runId: msg.runId,
        gateKind: msg.gateKind,
        decision: msg.decision,
        feedbackText: msg.feedback,
        decidedBy: entry.caller.userId,
      });
      if (!result) return;
      const workerWs = workerClaims.get(msg.runId);
      if (workerWs) {
        send(workerWs, {
          kind: "gate.decided",
          runId: msg.runId,
          gateKind: msg.gateKind,
          decision: msg.decision,
          feedback: msg.feedback,
        });
      }
      return;
    }

    case "run.cancel": {
      const allowed = await isRunOwnedBy(msg.runId, entry.caller.userId);
      if (!allowed) {
        console.warn(
          `[ws] client tried to cancel unowned run user=${entry.caller.userId} run=${msg.runId}`,
        );
        return;
      }
      try {
        const run = await transitionStatus(msg.runId, "cancelled");
        await publish({ runId: msg.runId, message: { kind: "run.updated", run } });
      } catch (err) {
        console.warn(`[ws] run.cancel failed run=${msg.runId}`, err);
        return;
      }
      const workerWs = workerClaims.get(msg.runId);
      if (workerWs) {
        send(workerWs, { kind: "run.cancel", runId: msg.runId });
      }
      return;
    }

    default: {
      const exhaustive: never = msg;
      void exhaustive;
      console.warn(`[ws] client sent unhandled kind`);
      entry.ws.close(4400, `unhandled_kind`);
      return;
    }
  }
}

// Re-export for callers that want to push run.start from REST.
export { workerClaims };

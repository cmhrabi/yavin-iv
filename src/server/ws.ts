import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ServerToWorker,
  ServerToClient,
  WorkerToServer,
  ClientToServer,
} from "@yavin/protocol";
import type { Caller } from "@/server/caller";
import { resolveCallerFromUpgrade, parseUpgradeUrl } from "@/server/ws-auth";
import { subscribe as subscribePubsub } from "@/server/pubsub";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;

interface ClientEntry {
  ws: WebSocket;
  subscriptions: Set<string>;
}

const clientSubscribers = new Set<ClientEntry>();

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
    // Only handle /ws; leave other upgrades (Next.js HMR) to their own listeners.
    if (url.pathname !== "/ws") return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      // Buffer messages that arrive while auth is being resolved — a client
      // can send `subscribe` immediately after the handshake completes, and
      // without this they'd be dropped before onClient attaches its handler.
      const buffered: WebSocket.RawData[] = [];
      const bufferHandler = (data: WebSocket.RawData) => buffered.push(data);
      ws.on("message", bufferHandler);
      void onUpgrade(ws, req, url, buffered, bufferHandler).catch((err) => {
        console.error("[ws] upgrade handler threw", err);
        try {
          ws.close(1011, "server_error");
        } catch {
          // socket already torn down — ignore
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
  // Replay anything that arrived during auth — order preserved.
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

function onWorker(ws: WebSocket, caller: Caller): void {
  console.log(`[ws] worker connected userId=${caller.userId} kind=${caller.kind}`);
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
    if (msg.kind === "pong") {
      lastPongAt = Date.now();
      return;
    }
    // All other WorkerToServer kinds are wired up in Todo 3.
    console.warn(`[ws] worker sent unhandled kind=${msg.kind}`);
    ws.close(4400, `unhandled_kind:${msg.kind}`);
  });

  ws.once("close", (code, reason) => {
    clearInterval(interval);
    console.log(`[ws] worker disconnected code=${code} reason=${reason.toString()}`);
  });
  ws.on("error", (err) => {
    console.error("[ws] worker error", err);
  });
}

function onClient(ws: WebSocket, caller: Caller): void {
  console.log(`[ws] client connected userId=${caller.userId} kind=${caller.kind}`);
  const entry: ClientEntry = { ws, subscriptions: new Set<string>() };
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
    if (msg.kind === "subscribe") {
      entry.subscriptions = new Set(msg.runIds ?? []);
      return;
    }
    // gate.decide and run.cancel land in Todo 3.
    console.warn(`[ws] client sent unhandled kind=${msg.kind}`);
    ws.close(4400, `unhandled_kind:${msg.kind}`);
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

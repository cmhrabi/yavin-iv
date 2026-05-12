import WebSocket from "ws";
import type {
  ServerToWorker,
  Run,
  WorkerToServer,
} from "@cmhrabi/yavin-protocol";

const token = process.env.YAVIN_API_KEY ?? process.env.WS_PROBE_TOKEN;
if (!token) {
  console.error("Set YAVIN_API_KEY to a valid yvn_… API key.");
  process.exit(2);
}

const port = process.env.PORT ?? "3000";
const host = process.env.WS_PROBE_HOST ?? "localhost";
const url = `ws://${host}:${port}/ws?role=worker&token=${encodeURIComponent(token)}`;

const ws = new WebSocket(url);
const activeRuns = new Set<string>();
const stageIdByRun = new Map<string, string>();

ws.on("open", () => {
  console.log("[stub-worker] connected");
});

ws.on("message", (data) => {
  let msg: ServerToWorker;
  try {
    msg = JSON.parse(data.toString()) as ServerToWorker;
  } catch (err) {
    console.error("[stub-worker] bad json", err);
    return;
  }
  void handle(msg).catch((err) => console.error("[stub-worker] handler threw", err));
});

ws.on("close", (code, reason) => {
  console.log(`[stub-worker] closed code=${code} reason=${reason.toString()}`);
  process.exit(0);
});

ws.on("error", (err) => {
  console.error("[stub-worker] error", err);
  process.exit(1);
});

function send(msg: WorkerToServer): void {
  ws.send(JSON.stringify(msg));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function handle(msg: ServerToWorker): Promise<void> {
  switch (msg.kind) {
    case "ping":
      send({ kind: "pong" });
      return;
    case "run.start":
      if (activeRuns.has(msg.run.id)) return;
      activeRuns.add(msg.run.id);
      await runResearch(msg.run);
      return;
    case "gate.decided":
      console.log(
        `[stub-worker] gate.decided run=${msg.runId} gate=${msg.gateKind} decision=${msg.decision}`,
      );
      activeRuns.delete(msg.runId);
      stageIdByRun.delete(msg.runId);
      if (activeRuns.size === 0) {
        // Close after a moment so logs flush.
        setTimeout(() => ws.close(1000, "done"), 100);
      }
      return;
    case "run.cancel":
      console.log(`[stub-worker] run.cancel run=${msg.runId}`);
      activeRuns.delete(msg.runId);
      stageIdByRun.delete(msg.runId);
      return;
  }
}

async function runResearch(run: Run): Promise<void> {
  console.log(`[stub-worker] starting research for run=${run.id} ticket=${run.ticketId}`);
  const stageId = `${run.id}:research`;
  stageIdByRun.set(run.id, stageId);

  send({
    kind: "stage.started",
    runId: run.id,
    stage: {
      id: stageId,
      runId: run.id,
      kind: "research",
      status: "running",
      attempt: 1,
      startedAt: new Date().toISOString(),
      endedAt: null,
      output: null,
      errorText: null,
    },
  });

  const beats: { kind: string; payload: unknown }[] = [
    { kind: "log", payload: { message: `Reading ticket ${run.ticketId}` } },
    { kind: "tool_call", payload: { name: "fetch_ticket", args: { url: run.ticketUrl } } },
    { kind: "tool_result", payload: { name: "fetch_ticket", ok: true, ms: 412 } },
    { kind: "tool_call", payload: { name: "grep", args: { pattern: run.ticketId, path: "src/" } } },
    { kind: "tool_result", payload: { name: "grep", matches: 3 } },
  ];

  for (const beat of beats) {
    send({
      kind: "event.append",
      event: { runId: run.id, stageId: null, kind: beat.kind, payload: beat.payload },
    });
    await sleep(300);
  }

  // Note: agent.message requires a real stage UUID in the DB, but the stub
  // doesn't know that id. The server uses (runId, kind) when upserting
  // stages, so for now we skip agent.message to avoid a stage_id mismatch.
  // The output below is what the UI renders.

  const output = {
    brief:
      `## Summary\n\nStub research brief for **${run.ticketTitle ?? run.ticketId}**.\n\n` +
      `### Approach\n\n- Read ticket\n- Skim relevant files\n- Draft a plan\n\n` +
      `### Next steps\n\nApprove to proceed to planning.`,
    citations: [{ url: run.ticketUrl, title: run.ticketId }],
  };

  send({
    kind: "stage.completed",
    runId: run.id,
    stage: {
      id: stageId,
      runId: run.id,
      kind: "research",
      status: "completed",
      attempt: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      output,
      errorText: null,
    },
  });

  send({
    kind: "gate.await",
    runId: run.id,
    gateKind: "post_research",
    payload: output,
  });

  console.log(`[stub-worker] research complete, awaiting gate for run=${run.id}`);
}

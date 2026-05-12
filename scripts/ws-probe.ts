import WebSocket from "ws";

const token = process.env.WS_PROBE_TOKEN ?? process.env.YAVIN_API_KEY;
if (!token) {
  console.error("Set WS_PROBE_TOKEN (or YAVIN_API_KEY) to a valid yvn_… API key.");
  process.exit(2);
}

const port = process.env.PORT ?? "3000";
const host = process.env.WS_PROBE_HOST ?? "localhost";
const url = `ws://${host}:${port}/ws?role=worker&token=${encodeURIComponent(token)}`;

const ws = new WebSocket(url);

const timeout = setTimeout(() => {
  console.error("probe: timed out after 5s waiting for server ping");
  ws.terminate();
  process.exit(1);
}, 5_000);

ws.on("open", () => {
  console.log("probe: connected, waiting for server ping…");
});

ws.on("message", (data) => {
  let parsed: { kind?: string };
  try {
    parsed = JSON.parse(data.toString());
  } catch (err) {
    console.error("probe: invalid JSON from server", err);
    clearTimeout(timeout);
    ws.terminate();
    process.exit(1);
  }
  if (parsed.kind === "ping") {
    ws.send(JSON.stringify({ kind: "pong" }));
    console.log("probe: ok (ping/pong round-trip)");
    clearTimeout(timeout);
    ws.close(1000, "probe_done");
    setTimeout(() => process.exit(0), 50);
    return;
  }
  console.error(`probe: unexpected kind=${parsed.kind}`);
  clearTimeout(timeout);
  ws.terminate();
  process.exit(1);
});

ws.on("close", (code, reason) => {
  console.log(`probe: closed code=${code} reason=${reason.toString()}`);
});

ws.on("error", (err) => {
  console.error("probe: error", err);
  clearTimeout(timeout);
  process.exit(1);
});

# Todo 2 — WebSocket server (worker + client channels)

Stand up `src/server/ws.ts` and `src/server/pubsub.ts`. The custom
`server.ts` shell from Phase 1 already has the attach point reserved.
Maps to §8 of [`../implementation-plan.md`](../implementation-plan.md).

Depends on: todo 1 (auth) — both channels authenticate via the shared
`getCaller` / `requireCaller` helpers. Workers always present a Bearer
key; browser clients normally ride on the Auth.js session cookie set on
the upgrade request, but a Bearer key works too (handy for `wscat`).

## Goal

A single `/ws` endpoint accepts two roles via `?role=worker|client`:

- **Worker** (rogue-one): authenticates, then exchanges
  `WorkerToServer` ↔ `ServerToWorker` envelopes (already typed in
  `@yavin/protocol`). For now, just echo + log — the run state machine
  lives in todo 3.
- **Client** (browser): authenticates, sends `subscribe`, receives
  `ServerToClient` events. Subscriptions are kept in-memory per socket.

Cross-process fan-out goes through Postgres `LISTEN/NOTIFY` on a single
channel `yavin_events`, so the same instance that wrote an event is not
required to be the one that pushes it to a subscribed client.

## Scope

- `src/server/pubsub.ts` — long-lived `postgres-js` listener connection
  (separate from the query pool), `publish(payload)` helper that wraps
  `pg_notify('yavin_events', json)`, and a typed event emitter that fans
  out to subscribers on the parsed payload.
- `src/server/ws.ts` — `attachWebSocketServer(httpServer)` that:
  - Resolves the caller via `getCaller(req)` from todo 1 (Bearer
    `?token=` for workers; session cookie or `?token=` for clients);
    rejects with 4401 close on null
  - Routes by `?role=worker|client`
  - Heartbeats every 30s, drops dead sockets after one missed pong
  - For clients, holds a `Set<runId>` per socket and forwards matching
    `pubsub` events
  - For workers, just logs incoming envelopes and acks — real handling is
    todo 3
- Wire into `server.ts` (replace the `// TODO` marker)
- Tiny dev tool: `scripts/ws-probe.ts` that opens a worker socket, sends
  a heartbeat, prints replies. Smoke test for both this and rogue-one's
  reconnect loop.

## Out of scope

- The actual run state machine, `run.start`, `gate.decided`, etc. — those
  are todo 3 once we have real runs to drive
- Reconnect + replay (`sinceSeq`) — Phase 4
- Backpressure metrics — log only for now

## Acceptance

- `pnpm dev`, then `tsx scripts/ws-probe.ts` connects, heartbeats, exits
  cleanly
- Wrong `?token=` → 4401 close frame
- Wrong `?role=` → 4400 close frame
- Two browser tabs subscribed to the same `runId`: a manual
  `select pg_notify('yavin_events', '{"runId":"...","kind":"event.appended","event":...}')`
  fires both tabs' handlers
- `pnpm typecheck`, `pnpm lint` clean

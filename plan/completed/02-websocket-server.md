# Todo 2 — WebSocket server (built)

What landed when this todo was implemented. Maps to §8 of
[`../implementation-plan.md`](../implementation-plan.md). The original
spec (Scope / Acceptance) lives in this file's git history; below is the
as-built snapshot.

## Outcome

A single `/ws` endpoint on the existing custom `server.ts`, mounted via
`attachWebSocketServer(httpServer)`. Auth, framing, and pubsub fan-out
are wired; the run state machine is not — every `WorkerToServer` /
`ClientToServer` kind that Todo 3 owns (`run.claim`, `event.append`,
`stage.*`, `gate.await`, `gate.decide`, `run.cancel`) deliberately closes
the socket with `4400 unhandled_kind:<kind>` so callers fail loudly until
Todo 3 wires them up.

Heartbeats use two different mechanisms by role:

- **Workers**: app-level `ServerToWorker {kind:"ping"}` and `WorkerToServer
  {kind:"pong"}` envelopes — the protocol already defines them. The server
  sends the first ping immediately on connect and every 30s after; if no
  `pong` arrives within 60s the socket is `.terminate()`d.
- **Clients**: WS protocol-level `ws.ping()` / `pong` frames every 30s,
  because `ServerToClient` has no ping envelope and browsers ride
  RFC 6455 ping/pong for free.

Cross-process fan-out goes through Postgres `LISTEN/NOTIFY` on channel
`yavin_events`. Any publisher writes JSON-encoded `{runId, message}`;
every yavin-iv process listens on a dedicated `postgres-js` connection
and forwards matching events to in-process client subscribers.

## Files added / changed

```
src/server/
├── ws.ts                                # attachWebSocketServer + onWorker/onClient
├── ws-auth.ts                           # resolveCallerFromUpgrade(IncomingMessage)
└── pubsub.ts                            # startPubsub / publish / subscribe / stopPubsub

scripts/
└── ws-probe.ts                          # worker smoke test (`tsx scripts/ws-probe.ts`)

server.ts                                # // TODO replaced with startPubsub + attach
package.json                             # + ws, + @types/ws (see "Packages")
```

`getCaller`/`requireCaller` in `src/server/caller.ts` were **not** reused
directly — they take a Fetch `Request`, and the WS upgrade handler only
has a Node `IncomingMessage`. A parallel resolver in `ws-auth.ts` shares
the same `Caller` shape but reads cookies and `?token=` from the raw
upgrade request. See "Auth resolution" below.

## Packages

Added to `dependencies`:

- `ws@^8.20.0` — WebSocket server. Mounted with `noServer: true` so the
  custom `server.ts` owns the `'upgrade'` event emitter.

Added to `devDependencies`:

- `@types/ws@^8.18.1`.

No new runtime deps for pubsub — the existing `postgres@^3.4.5` dep has
the `.listen()` / `.notify()` API we need; we just open a separate
`postgres(url, { max: 1 })` client so the long-lived LISTEN connection
doesn't share a slot with the query pool in `src/db/client.ts`.

## Auth resolution

`src/server/ws-auth.ts` exports:

```ts
export async function resolveCallerFromUpgrade(
  req: IncomingMessage,
): Promise<Caller | null>;
export function parseUpgradeUrl(req: IncomingMessage): URL;
```

Same precedence as `src/server/caller.ts` so a bad Bearer key never
falls through to a session cookie:

1. **Bearer** — `?token=<key>` query param, else `Authorization: Bearer
   <key>` header (handy for `wscat`). If present, `verifyApiKey(token)`;
   on miss return `null`.
2. **Session cookie** — Auth.js stores `sessionToken` in
   `authjs.session-token` (or `__Secure-authjs.session-token` when
   `AUTH_URL` starts with `https://` or `NODE_ENV === "production"`).
   The resolver parses the cookie inline, joins `sessions` → `users`,
   and requires `expires > now()`. Calling Auth.js's `auth()` from a
   custom-server upgrade context isn't supported — `auth()` depends on
   the Next.js request-context AsyncLocalStorage, which isn't set up
   here. Direct DB lookup is simpler and matches the v5 DB session
   strategy already in use.

## Upgrade routing and message buffering

`attachWebSocketServer(httpServer)` subscribes to `httpServer.on("upgrade",
…)`. Only `url.pathname === "/ws"` is handled; all other upgrades
(Next.js HMR) fall through to whichever listener Next attaches to the
same emitter, so HMR still works in dev.

For `/ws`, `wss.handleUpgrade()` accepts the handshake immediately so
that auth-failure clients receive a real WebSocket close frame
(`4401 unauthorized`) instead of an HTTP 401. **Subtle invariant**:
clients can send `subscribe` synchronously on `open`, and that message
will arrive at the server *during* the `await
resolveCallerFromUpgrade(req)` — i.e., before `onClient` has attached
its `message` handler. To avoid silently dropping that first message,
the handshake callback synchronously attaches a buffer handler:

```ts
wss.handleUpgrade(req, socket, head, (ws) => {
  const buffered: WebSocket.RawData[] = [];
  const bufferHandler = (data) => buffered.push(data);
  ws.on("message", bufferHandler);
  void onUpgrade(ws, req, url, buffered, bufferHandler).catch(/* … */);
});
```

After auth resolves, `onUpgrade` removes the buffer handler, calls
`onWorker` / `onClient` (which attach the real handler), and then
replays buffered messages via `ws.emit("message", data)` so order is
preserved. This was the only behavioural regression caught during
verification — it presents as "subscribe is ignored, no events ever
reach the client" and is silent. **Don't unwind the buffering** unless
you're moving auth fully pre-handshake.

## Close codes

| Code   | Reason                       | When |
| ------ | ---------------------------- | ---- |
| `4400` | `bad_role`                   | `?role` is missing or not `worker`/`client` |
| `4401` | `unauthorized`               | `resolveCallerFromUpgrade` returns `null` |
| `4400` | `bad_message`                | inbound JSON parse failure, or `kind` not a string |
| `4400` | `unhandled_kind:<kind>`      | valid `WorkerToServer` / `ClientToServer` envelope whose handler ships in Todo 3 |
| `1011` | `server_error`               | the auth resolver itself threw (caught by the upgrade-handler `.catch`) |
| `1000` / `1005` / `1006` | various      | normal / no-status / abnormal close from the peer |

`4400` is overloaded across "bad request" cases on purpose — the close
*reason* string carries the specifics. Clients should log both.

## Pubsub contract

`src/server/pubsub.ts`:

```ts
type PubsubEvent = { runId: string; message: ServerToClient };

startPubsub(): Promise<void>     // idempotent, opens the LISTEN connection
stopPubsub(): Promise<void>      // clears listeners, .end()s the LISTEN client
publish(event: PubsubEvent): Promise<void>
subscribe(fn: (e: PubsubEvent) => void): () => void   // returns unsubscribe
```

Publish uses the shared `db` pool (`db.execute(sql\`select
pg_notify('yavin_events', \${JSON.stringify(event)})\`)`), so writers
never block on the LISTEN connection. The listener parses payloads once
and fans out to all registered in-process subscribers.

Malformed payloads (parse failure, missing `runId`, missing `message`)
are logged and dropped. Listener exceptions are caught per-listener so
one bad subscriber can't stall the rest.

`startPubsub` is called from `server.ts` before `server.listen(...)` so
the LISTEN connection is up before the first WS client can subscribe.

## Worker channel

`src/server/ws.ts:onWorker`:

- Logs `[ws] worker connected userId=<uuid> kind=<user|apiKey>` on open.
- Sends `{kind: "ping"}` synchronously on connect (so the probe and
  rogue-one's smoke test round-trip in <100ms instead of waiting for the
  first 30s interval).
- Inbound message: `parseEnvelope<WorkerToServer>`. The *only* kind
  recognised in Todo 2 is `pong`, which bumps `lastPongAt`. Every other
  kind closes the socket with `4400 unhandled_kind:<kind>`.
- 30s heartbeat interval: if `Date.now() - lastPongAt > 60s`,
  `ws.terminate()`. Otherwise send another ping.

## Client channel

`src/server/ws.ts:onClient`:

- Adds an entry `{ws, subscriptions: Set<string>}` to a module-level
  `clientSubscribers` set on connect; removes on close.
- Heartbeat is WS protocol-level: 30s interval calls `ws.ping()`, and an
  `isAlive` flag flipped on the `pong` event. Two consecutive misses
  → `ws.terminate()`.
- Inbound message: `parseEnvelope<ClientToServer>`. Only `subscribe` is
  handled — `entry.subscriptions = new Set(msg.runIds ?? [])`,
  replacing the previous set wholesale. `gate.decide` and `run.cancel`
  ship in Todo 3 and close with `4400 unhandled_kind:<kind>` for now.
- The module-level pubsub subscriber callback (registered once in
  `attachWebSocketServer`) iterates `clientSubscribers` on every event
  and forwards `event.message` to any socket whose set contains
  `event.runId`. **Per-run authz is not enforced here** — Todo 3 will
  add it once `runs.created_by` carries real data. For now, any
  authenticated caller can subscribe to any `runId`.

## Idempotency / restart safety

- `attached = false` module flag guards `attachWebSocketServer` against
  double-attach (e.g. tsx watch quirks). Once `true`, subsequent calls
  are no-ops.
- `startPubsub` caches its promise; subsequent calls await the same
  promise. On failure the promise is cleared so the next call retries.
- `clientSubscribers` is fresh per Node process, which is fine —
  reconnects come from the client side and Phase 4 owns replay.

## scripts/ws-probe.ts

`pnpm tsx scripts/ws-probe.ts` with `WS_PROBE_TOKEN` (or `YAVIN_API_KEY`)
set to a real `yvn_…` key:

1. Opens `ws://localhost:${PORT ?? 3000}/ws?role=worker&token=<token>`.
2. On the first server `{kind:"ping"}` it replies `{kind:"pong"}`, logs
   `ok`, closes with `1000 probe_done`, and `process.exit(0)`.
3. Times out after 5s with exit 1.

Used both as a local smoke test and as the canonical reconnect-loop
target for rogue-one.

## Verification

```bash
pnpm install
pnpm typecheck    # clean
pnpm lint         # clean
pnpm dev          # in one terminal
```

In another terminal:

```bash
# Smoke test the worker channel end-to-end
WS_PROBE_TOKEN="yvn_<prefix>_<secret>" pnpm tsx scripts/ws-probe.ts
# → probe: ok (ping/pong round-trip)

# Close-code matrix
wscat -c "ws://localhost:3000/ws?role=worker&token=BADKEY"          # 4401 unauthorized
wscat -c "ws://localhost:3000/ws?role=bogus&token=$YAVIN_API_KEY"   # 4400 bad_role
```

Two-client pubsub fan-out (the spec's "two browser tabs" check —
exercised with two `client`-role WS connections using a Bearer key, no
browser required):

1. Open two `ws://localhost:3000/ws?role=client&token=…` sockets, send
   `{"kind":"subscribe","runIds":["<uuid>"]}` on each.
2. From psql:
   `select pg_notify('yavin_events',
     '{"runId":"<uuid>","message":{"kind":"event.appended","event":{…}}}');`
3. Both sockets receive the `event.appended` envelope.

## Out of scope (not built)

- The actual run state machine and every `WorkerToServer` /
  `ClientToServer` kind beyond `pong` / `subscribe` — Todo 3.
- Per-run authz on `subscribe` — Todo 3, after `runs.created_by` has
  real data.
- Reconnect + replay (`sinceSeq` is in the `ClientToServer.subscribe`
  type already, but ignored) — Phase 4.
- Backpressure (slow consumer detection / disconnect) — log only for
  now.
- Multi-instance fan-out *across* yavin-iv processes works by design via
  `LISTEN/NOTIFY`, but no multi-instance deploy has been tested.

## Notes for whoever picks this up next

- **Don't unwind the upgrade-time message buffering.** The
  `wss.handleUpgrade` callback synchronously attaches a buffer handler
  before `await resolveCallerFromUpgrade`. Removing it silently drops
  any `subscribe` (or worker `pong`) the client sends in the same tick
  as `open`. If you ever move the auth fully pre-handshake (rejecting
  with HTTP 401 before sending the 101 Switching Protocols), the buffer
  becomes redundant — but the trade-off is that auth failures no longer
  surface as `4401` close frames, and the acceptance criteria depend on
  that.
- **Cookie name** depends on `AUTH_URL` / `NODE_ENV` at *module load*.
  If you toggle environments without restarting the server, the
  resolver will look at the wrong cookie name. Restart on env change.
- **Don't `socket.destroy()` paths that aren't `/ws`.** Next.js attaches
  its HMR upgrade handler to the same `'upgrade'` emitter. Returning
  early (rather than destroying) is what keeps HMR working in dev.
- **The worker probe sends `pong` in response to a server `ping`.** The
  protocol's `ServerToWorker` defines `ping`; `WorkerToServer` defines
  `pong`. There's no worker-initiated heartbeat — don't add one without
  also updating `@yavin/protocol`.
- Todo 3 should call `pubsub.publish(...)` (not `pg_notify` directly)
  for any event it wants to fan out, so the JSON payload shape stays
  consistent and types track. The `db.execute` form is fine for ad-hoc
  manual checks from a REPL but isn't typed against `PubsubEvent`.
- The strict-reject behaviour for Todo-3 envelopes means rogue-one will
  fail the first time it tries `run.claim` until Todo 3 lands.
  Intentional — it's better than silently dropping work.

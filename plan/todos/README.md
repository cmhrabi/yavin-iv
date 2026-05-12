# Todos

Next features queued up, in suggested order. Each file scopes one cohesive
slice of work — small enough to land in a single PR, large enough to be
demoable. See [`../implementation-plan.md`](../implementation-plan.md) for
the master phase plan and [`../completed/`](../completed/) for what's
already in.

| # | Doc | Why now |
| - | --- | ------- |
| 3 | [`03-runs-api-and-db-wiring.md`](./03-runs-api-and-db-wiring.md) | Replaces `MOCK_RUNS` with real DB-backed runs and lights up Phase 2's research vertical end-to-end. `runs.created_by` is already a `uuid → users(id)` FK — copy `caller.userId` into it. The WS transport from todo 2 is ready — call `pubsub.publish({runId, message})` (not `pg_notify` directly), and remember that any new `WorkerToServer` / `ClientToServer` kind needs a handler in `src/server/ws.ts` or it'll be rejected with `4400 unhandled_kind:<kind>`. |

Done: [`../completed/01-api-key-auth.md`](../completed/01-api-key-auth.md),
[`../completed/02-websocket-server.md`](../completed/02-websocket-server.md).

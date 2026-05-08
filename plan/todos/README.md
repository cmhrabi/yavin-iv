# Todos

Next features queued up, in suggested order. Each file scopes one cohesive
slice of work — small enough to land in a single PR, large enough to be
demoable. See [`../implementation-plan.md`](../implementation-plan.md) for
the master phase plan and [`../completed/`](../completed/) for what's
already in.

| # | Doc | Why now |
| - | --- | ------- |
| 2 | [`02-websocket-server.md`](./02-websocket-server.md) | Required for rogue-one to connect. The custom `server.ts` already has the attach point reserved. Auth verifier is in place — call `verifyApiKey(rawKey)` from `src/server/api-keys.ts` against the `?token=` query param. |
| 3 | [`03-runs-api-and-db-wiring.md`](./03-runs-api-and-db-wiring.md) | Replaces `MOCK_RUNS` with real DB-backed runs and lights up Phase 2's research vertical end-to-end. `runs.created_by` is already a `uuid → users(id)` FK — copy `caller.userId` into it. |

Done: [`../completed/01-api-key-auth.md`](../completed/01-api-key-auth.md).

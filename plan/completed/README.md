# Completed

Build passes that have landed. Each file is a snapshot of what was actually
shipped, not what was originally planned — read these to understand the
current state of the repo before picking up a `todos/` item.

| Phase | Doc | Summary |
| ----- | --- | ------- |
| 1 | [`phase-1-foundations.md`](./phase-1-foundations.md) | Next.js + custom server scaffold, Postgres + Drizzle schema, `@yavin/protocol` package, dashboard UI on mock data. No auth, no WS, no real APIs. |
| 1.5 | [`01-api-key-auth.md`](./01-api-key-auth.md) | Auth.js v5 + GitHub OAuth + DB sessions for humans; user-owned `yvn_<prefix>_<secret>` Bearer keys for rogue-one. One `Caller` context, `verifyApiKey(rawKey)` ready for the WS upgrade handler. |
| 2 | [`02-websocket-server.md`](./02-websocket-server.md) | `/ws` endpoint with `worker` / `client` roles, `ws-auth.ts` resolver (Bearer or Auth.js cookie), Postgres `LISTEN/NOTIFY` pubsub on `yavin_events`. Strict-rejects Todo-3 envelopes with `4400 unhandled_kind:<kind>`. Upgrade-time message buffering so client `subscribe` isn't dropped during the auth await. |

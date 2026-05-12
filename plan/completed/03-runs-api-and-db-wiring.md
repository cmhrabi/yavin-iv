# Todo 3 — Runs API + DB wiring + research vertical (built)

What landed when this todo was implemented. Maps to Phase 2 of
[`../implementation-plan.md`](../implementation-plan.md). The original
spec (Scope / Acceptance) lives in this file's git history; below is the
as-built snapshot.

## Outcome

`MOCK_RUNS` is gone from the live data path. A signed-in user clicks
**New run** in the dashboard, the run is persisted as `pending`, a
connected stub worker (`scripts/stub-worker.ts`) is dispatched
`run.start`, it streams a scripted research stage, the run flips to
`awaiting_research_approval`, and the user's **Approve** click writes a
`gate_decisions` row and transitions the run to `planning` — all over
real DB rows + the pubsub fan-out from Todo 2.

Every `WorkerToServer` / `ClientToServer` kind that Todo 2 deferred is
now wired. The strict `4400 unhandled_kind:<kind>` fallback is kept as a
default branch in both `onWorker` and `onClient` so anything new still
fails loudly.

## Files added / changed

```
src/db/
├── schema.ts                              # + ticketTitle text column on runs
└── migrations/0001_add_ticket_title.sql   # generated

src/server/
├── runs.ts                                # createRun/getRun/listRuns/claimRun/
│                                          # transitionStatus/updateStage/
│                                          # filterOwnedRunIds/isRunOwnedBy
├── events.ts                              # appendEvent (per-run seq via advisory lock)
├── gates.ts                               # recordGateDecision
├── ws.ts                                  # full worker/client switch — replaces
│                                          # all the 4400 unhandled_kind branches
│                                          # from Todo 2 (except `pong`/`subscribe`)
└── runs.test.ts                           # vitest happy-path

src/app/api/runs/
├── route.ts                               # GET (list) + POST (create + dispatch)
├── [id]/route.ts                          # GET (snapshot) + PATCH (cancel)
└── [id]/gates/[kind]/route.ts             # POST (REST fallback for gate.decide)

src/app/(dashboard)/
├── page.tsx                               # server component → listRuns(userId)
└── runs/[id]/
    ├── page.tsx                           # server component → getRun(id, userId)
    └── run-detail-client.tsx              # uses useRunSubscription hook

src/components/
├── gate-bar.tsx                           # props: onApprove/onReject/onRegenerate
└── new-run-dialog.tsx                     # NewRunButton + dialog form

src/lib/
├── useRunSubscription.ts                  # WS hook for live run updates
└── mock-data.ts                           # header comment: no longer the live source

scripts/
└── stub-worker.ts                         # research-vertical demo worker

package.json                               # + vitest devDep, + test scripts
vitest.config.ts                           # node env, @/ + @yavin/protocol aliases
```

`mock-data.ts` is intentionally left in tree — nothing in the live
dashboard imports it, but the run-detail stage renderers (`plan` /
research output shapes) and any future storybook-style preview can keep
using it without being rewritten.

## Packages

Added to `devDependencies`:

- `vitest@^4.1.6` — node-environment unit tests. `pnpm test` /
  `pnpm test:watch` scripts added.

No new runtime deps. Everything else (`drizzle-orm`, `postgres`, `ws`,
`@yavin/protocol`) was already in.

## DB

One generated migration — `0001_add_ticket_title.sql` — adds:

```sql
ALTER TABLE "runs" ADD COLUMN "ticket_title" text;
```

Nullable for back-compat with any rows from earlier dev work. The REST
API treats it as required (zod `.min(1)`), and `Run.ticketTitle` in the
protocol is already optional, so no protocol bump was needed.

`runs.created_by` already had a `uuid → users(id)` FK from Phase 1 — the
REST handler copies `caller.userId` into it; no schema change required
to enforce per-user authz.

## Server services

### `src/server/runs.ts`

Pure DB layer (no WS, no pubsub). Every mutating function accepts an
optional `executor` so callers can compose them inside a single
transaction — drizzle's nested `.transaction()` on an existing `tx`
creates a savepoint, which is what `gates.recordGateDecision` relies on.

- `createRun(input, callerUserId)` — validates the repo exists, inserts
  the run as `pending`, inserts six `pending` stage rows
  (`STAGE_KINDS.map(...)`) in the same transaction. Returns the full
  `Run` + the inserted `Stage[]`.
- `getRun(runId, callerUserId)` — joins run + stages + events; enforces
  `created_by = callerUserId` and returns `null` on miss so cross-user
  access can't be distinguished from "doesn't exist".
- `listRuns(callerUserId)` — scoped to caller's runs, ordered by
  `createdAt desc`.
- `claimRun(runId)` — `SELECT ... FOR UPDATE`, checks `canTransition()`
  from `@yavin/protocol`, sets `status='researching'` + `currentStage='research'`.
- `transitionStatus(runId, next, executor?, patch?)` — `SELECT ... FOR
  UPDATE` + `canTransition()` check + update. Throws
  `InvalidTransitionError` so callers can surface a 409. The `patch`
  param lets gate-decision and worker handlers update `currentStage`
  alongside the status.
- `updateStage(runId, kind, patch, executor?)` — updates a stage row
  by `(runId, kind)`. **Worker-supplied stage IDs are ignored** — the
  server-allocated id from `createRun` is the source of truth, and
  workers identify stages by kind. This is why `stage.started` /
  `stage.completed` payloads pass `msg.stage.kind`, not `msg.stage.id`.
- `isRunOwnedBy(runId, callerUserId)` / `filterOwnedRunIds(runIds, ...)`
  — used by the WS `subscribe`, `gate.decide`, and `run.cancel`
  handlers for per-run authz without a separate query at fan-out time.

### `src/server/events.ts`

`appendEvent(input)`:

1. Open a transaction.
2. `select pg_advisory_xact_lock(hashtext(runId))` — serializes seq
   allocation per run. **Don't switch this back to `select max(seq)+1 …
   for update`** — Postgres rejects `FOR UPDATE` with aggregate functions
   (`FOR UPDATE is not allowed with aggregate functions`). The advisory
   lock is per-runId, transaction-scoped (auto-released on
   commit/rollback), and well under a millisecond.
3. `select coalesce(max(seq), 0) + 1` and insert.
4. Outside the transaction, `pubsub.publish({ runId, message:
   { kind: 'event.appended', event } })`.

Returns the inserted `Event`. The seq is cast `BigInt` for insert and
back to `Number` for the protocol type — the bigserial column means we
can't overflow JS's safe integer range until ~9e15 events per run.

### `src/server/gates.ts`

`recordGateDecision({ runId, gateKind, decision, feedbackText, decidedBy })`:

- `regenerate` → logs a warn and returns `null`. Follow-up todo owns the
  superseded-stage + retry semantics; the dialog still opens but its
  Submit button is a no-op for now.
- Looks up the gating stage by `(runId, GATE_TO_STAGE[gateKind])`,
  inserts a `gate_decisions` row, transitions the run:
  - `approved` + `post_research` → `planning`
  - `approved` + `post_plan` → `coding`
  - `approved` + `pre_pr` → `opening_pr`
  - `rejected` (any gate) → `cancelled`
- Publishes `run.updated` over pubsub on commit. The WS handler is
  responsible for routing `gate.decided` to the claiming worker — that's
  done in `onClient`'s `gate.decide` branch, not here, so the REST
  fallback (`POST /api/runs/[id]/gates/[kind]`) can share the same
  worker-routing path.

## WS handlers — `src/server/ws.ts`

Module-level state added on top of Todo 2's `clientSubscribers`:

```ts
const workerSockets = new Set<WorkerEntry>();              // connected workers
const workerClaims  = new Map<string, WebSocket>();        // runId → claiming socket
```

`workerSockets` is iterated by `getAvailableWorker()` to find a target
for `dispatchPendingRun()`. `workerClaims` is populated when a worker
sends `run.claim` (or when `dispatchPendingRun` pushes `run.start`) and
cleared on socket close. Both are per-process — single-instance only.
**Multi-instance worker fan-out is deferred**; first connected worker
wins.

### `onWorker` switch

| Kind | Handler |
| ---- | ------- |
| `pong` | bump `lastPongAt` (unchanged from Todo 2) |
| `run.claim` | `claimRun(runId)` → publish `run.updated` → `workerClaims.set(runId, ws)` → send `run.start { run, repoConfig, ticket }` |
| `stage.started` | `updateStage(runId, msg.stage.kind, { status:'running', startedAt: now })` → publish `stage.updated` |
| `stage.completed` | `updateStage(runId, kind, { status:'completed', endedAt: now, output })` → publish `stage.updated`. Does **not** auto-transition the run — the worker follows with `gate.await` or the next `stage.started`. |
| `stage.failed` | Look up the stage by `msg.stageId`, mark `failed`, transition run to `failed`, publish both updates. ⚠ See "Known limitations" — the worker doesn't currently know the server-allocated stage UUID, so this path will only fire if a worker is taught to read the stage id out of the snapshot first. |
| `event.append` | `appendEvent(msg.event)` (which itself publishes `event.appended`) |
| `agent.message` | Insert into `agent_messages`, no broadcast |
| `gate.await` | `transitionStatus(runId, awaiting_<gate>_approval)` → publish `run.updated` + `gate.awaiting` |
| `run.status` | Logged at debug, no DB write — informational only |
| default | `ws.close(4400, 'unhandled_kind')` (TypeScript `never` exhaustiveness check guards this at compile time) |

### `onClient` switch

| Kind | Handler |
| ---- | ------- |
| `subscribe` | `entry.subscriptions = new Set(await filterOwnedRunIds(msg.runIds ?? [], caller.userId))`. Unowned ids are dropped silently — REST already allows enumeration via `GET /api/runs`, so a 4400 here would add no security and just make legitimate clients harder to write. |
| `gate.decide` | Authz check (`isRunOwnedBy`), `recordGateDecision(...)`, then if `workerClaims.has(runId)` send `gate.decided` to that worker socket. |
| `run.cancel` | Authz check, `transitionStatus(runId, 'cancelled')`, publish `run.updated`, send `run.cancel` to the claiming worker if any. |
| default | `ws.close(4400, 'unhandled_kind')` |

### Pubsub fan-out authz

Todo 2 fanned out to anyone with the runId in their subscription set,
with the explicit "Todo 3 will tighten this once `runs.created_by` is
real" caveat. The tightening is implicit now: `subscribe` filters
`runIds` to `created_by = caller.userId` before populating the
subscription set, so the fan-out loop at `ws.ts:75-81` is automatically
authz-correct — no extra per-event query needed.

### `dispatchPendingRun`

Exported helper used by `POST /api/runs`. If a worker is connected,
`claimRun` transitions the new run `pending → researching`, publishes
`run.updated`, and sends `run.start` to the first available worker
socket. If no worker is connected, the run stays `pending` and waits for
the next `run.claim`. Call site is fire-and-forget — the REST handler
returns the created run synchronously and dispatch happens in the
background.

## REST API

All three routes go through `requireCaller` and never return data for a
run the caller doesn't own.

### `POST /api/runs`

```ts
body: {
  repoConfigId: uuid,
  ticketProvider: 'jira' | 'linear' | 'github',
  ticketId: string, ticketUrl: string, ticketTitle: string,
  instructions?: string,   // defaults to ''
}
→ 201 { run, stages }
→ 404 { error: 'repo_config_not_found' }
→ 400 { error: 'invalid_body' | 'invalid_json', issues? }
```

Side effect: fires `void dispatchPendingRun(run.id)` after the insert
commits.

### `GET /api/runs`

Returns `{ runs: Run[] }` scoped to the caller.

### `GET /api/runs/[id]`

Returns `{ run, stages, events }` or 404 (also covers cross-user
access — getRun returns null for both "missing" and "not yours").

### `PATCH /api/runs/[id]`

Body `{ status: 'cancelled' }`. Same code path as `run.cancel` over WS,
including the worker-routing branch. Returns 409
`{ error: 'invalid_transition' }` from terminal states.

### `POST /api/runs/[id]/gates/[kind]`

Body `{ decision: 'approved' | 'rejected' | 'regenerate', feedbackText? }`.
Returns `{ run }` on success, `202 { deferred: true }` for `regenerate`,
`404` for unowned/missing runs, `409` for invalid transitions.

## Dashboard

### Run list — `src/app/(dashboard)/page.tsx`

Server component. Calls `auth()`, `listRuns(session.user.id)`, and
`listRepoConfigs()` directly — same-process DB call, no `fetch('/api/runs')`
round-trip. Renders `<RunCard>`s and the new `<NewRunButton repos={...}>`.

`listRepoConfigs()` is inlined here because the dashboard is the only
caller for now; the form on `/repos` is still placeholder UI (deferred to
Phase 3). The new-run dialog uses whatever repos exist in the table —
seed via SQL for now.

### New run dialog — `src/components/new-run-dialog.tsx`

Client component owning the form. POSTs to `/api/runs` with
`credentials` ridden by the Auth.js session cookie. On success, calls
`router.refresh()` and closes the dialog. Disabled (with the button
greyed out) when no repos are configured.

The provider `<select>` defaults to the repo's first `ticketProviders`
entry; the form is *not* gated to a repo's configured providers (any of
jira/linear/github is selectable), because ticket lookup isn't wired
yet and a wrong provider here is harmless until Phase 3.

### Run detail — `src/app/(dashboard)/runs/[id]/{page,run-detail-client}.tsx`

Server component fetches `getRun(id, session.user.id)` → 404 on miss →
hands `{ run, stages, events }` to `RunDetailClient`. The client
component then opens a WS and merges live updates.

### `useRunSubscription` hook — `src/lib/useRunSubscription.ts`

```ts
useRunSubscription({ run, stages, events })
  : { run, stages, events, connected, send(msg: ClientToServer): boolean }
```

- Opens `ws[s]://${host}/ws?role=client` on mount. The Auth.js session
  cookie rides the upgrade handshake automatically (same-origin), so no
  bearer-token plumbing is needed for the browser client.
- On `open`: sends `{ kind: 'subscribe', runIds: [runId] }`.
- On `message`: switches `kind` and merges:
  - `run.updated` → replace `run`
  - `stage.updated` → replace matching stage by id
  - `event.appended` → append to `events`, dedup by `seq`
  - `gate.awaiting` → ignored (implicit via the next `run.updated`)
- On `close`: 1s backoff reconnect via `setTimeout`. The `closedRef`
  flag is set in the unmount cleanup so an in-flight reconnect is
  cancelled.
- **No reconnect-time replay.** Phase 4 owns `sinceSeq` — if the socket
  drops mid-research, events emitted during the gap are lost from the
  client view (the DB still has them; a page refresh re-hydrates).

The hook exposes `send` so the gate buttons can write directly to the
socket without re-hooking. `<GateBar>`'s `onApprove` / `onReject` props
are wired to `send({ kind:'gate.decide', ... })`.

### `GateBar` prop change — `src/components/gate-bar.tsx`

```ts
GateBar({ gateKind, onApprove?, onReject?, onRegenerate? })
```

Approve + Reject buttons call their handlers directly. The Regenerate
dialog still opens and collects feedback, but its Submit handler falls
back to `console.warn` if `onRegenerate` isn't passed — which is
currently always the case. Wiring a real handler is a follow-up.

## Stub worker — `scripts/stub-worker.ts`

`pnpm tsx scripts/stub-worker.ts` with `YAVIN_API_KEY=yvn_…`:

1. Connects to `ws://localhost:${PORT ?? 3000}/ws?role=worker&token=…`.
2. Responds to `ping` with `pong`.
3. On `run.start`:
   - `stage.started` for `research` (with a synthetic stage id — server
     ignores it and matches by kind)
   - Five `event.append`s with 300ms gaps (`log`, `tool_call`,
     `tool_result`, `tool_call`, `tool_result`)
   - `stage.completed` for `research` with a markdown brief +
     citations matching the `ResearchOutput` zod schema
   - `gate.await { gateKind: 'post_research', payload: output }`
4. On `gate.decided` (approve/reject) or `run.cancel`: clears state,
   exits 0 when no active runs remain.

**The stub does NOT send `agent.message`.** The protocol's
`AgentMessageInput.stageId` is required (non-null string), and the stub
doesn't know the server-allocated stage UUID — only the kind. Real
workers either need to learn stage ids from a snapshot subscribe or the
server needs to echo stage ids back in `run.start`. Deferred.

## Tests

### `pnpm test` — `src/server/runs.test.ts`

Single vitest spec, runs against the live `yavin_iv` Postgres (set
`DATABASE_URL` or `TEST_DATABASE_URL` to override). Each test:

1. Inserts a unique `users` row (`test_<rand>@example.com`) and
   `repo_configs` row.
2. Calls `createRun → listRuns → getRun (cross-user check) → claimRun →
   appendEvent ×2 → transitionStatus → recordGateDecision`.
3. Asserts seq=1, seq=2; final status=`planning`; gate_decisions row
   exists with the right `decided_by`.
4. `afterAll` deletes the inserted users/repos/runs (cascade cleans up
   stages/events/gate_decisions).

**Why not per-schema isolation?** The original plan called for
`create schema test_<rand>; migrate into it; drop schema cascade`. In
practice the existing `0000_plain_angel.sql` migration creates enum
types in `public` (`CREATE TYPE "public"."run_status"`) and `FOREIGN
KEY REFERENCES "public"."users"("id")`, so a sandboxed schema would
either collide on enum creation or have FKs pointing back at the wrong
table. Tagged inserts + cleanup is good enough for v0 and re-runs are
safe; a proper per-schema approach needs the migration to be made
schema-relative first.

### `vitest.config.ts`

Node environment, `@/` and `@yavin/protocol` resolve to source so tests
don't need the protocol package to be pre-built.

## Verification

```bash
docker compose up -d
pnpm install
pnpm db:migrate                  # applies 0001_add_ticket_title
pnpm typecheck                   # clean
pnpm lint                        # clean
pnpm test                        # 1/1 green
pnpm build                       # all routes register
```

End-to-end demo:

```bash
pnpm dev
# in another terminal:
YAVIN_API_KEY=yvn_<prefix>_<secret> pnpm tsx scripts/stub-worker.ts
# in browser: sign in via GitHub, click New run, watch research stream,
# click Approve, run flips to planning.
```

Seed a repo for the New-run dialog (the form on `/repos` is still
placeholder UI):

```sql
insert into repo_configs (name, repo_path, github_repo)
values ('yavin-iv', '/Users/calum/code/yavin-iv', 'kablamo/yavin-iv');
```

## Known limitations (Phase 3+)

- **`stage.failed` requires the worker to know the server stage UUID.**
  The handler looks up `stages.id = msg.stageId`, but workers only get
  stage kinds in `run.start`. Either teach `run.start` to include the
  stage list, or rewrite the handler to look up by (runId, currently
  running kind). Stub worker doesn't exercise this path.
- **`agent_messages.stageId` is non-null but workers don't know stage ids.**
  Same root cause; same fix.
- **First-connected worker wins.** Multi-worker dispatch (load
  balancing, repo affinity, concurrency limits per repo) is Phase 3.
- **No reconnect replay.** `sinceSeq` is in the protocol but ignored —
  Phase 4.
- **Regenerate is a no-op.** The dialog collects feedback and logs a
  warn. Implementing it needs the `superseded` stage status + a new
  attempt row; not blocked, just out of scope here.
- **Per-stage cost rollup** from `agent_messages.cost_usd` is unwired —
  `Run.costUsd` is always `undefined` in returned payloads.
- **Repo CRUD is still placeholder UI** on `/repos` — seed via SQL for
  now.
- **Filter chips on the dashboard are visual-only** — no URL state, no
  filtering applied. Deferred until there are enough rows to need it.

## Notes for whoever picks this up next

- **Stages match by `(runId, kind)`, not by worker-supplied UUID.** The
  worker passes a stage object in `stage.started` / `stage.completed`
  but only `msg.stage.kind` is read; the rest is ignored. This means
  workers don't need to mint UUIDs, but it also means the server is the
  only place that ever knows the real stage ids. See the
  `stage.failed` / `agent.message` notes above for the follow-up work.
- **Per-run seq allocation uses `pg_advisory_xact_lock(hashtext(runId))`.**
  Don't switch back to `SELECT max(seq) ... FOR UPDATE` — Postgres
  rejects `FOR UPDATE` with aggregate functions. The advisory lock is
  per-runId, transaction-scoped, and well under a millisecond.
- **`recordGateDecision` calls `transitionStatus(..., tx)` inside its
  own transaction.** Drizzle's nested `.transaction()` creates a
  savepoint — don't refactor `transitionStatus` to take a raw connection
  without preserving that.
- **`createRun` inserts six `pending` stage rows up front.** The UI's
  `StageTimeline` expects all six to exist regardless of where the run
  is — if you ever change this to insert-on-demand, the timeline
  becomes a list of one growing item.
- **`workerSockets` / `workerClaims` are per-process.** Multi-instance
  yavin-iv would pick different workers per request — fine for the
  WS-vs-REST routing (REST handlers reach into `workerClaims` for the
  same-process socket) but it won't reach a worker on another node.
  Postgres `LISTEN/NOTIFY` already gives us a cross-process channel —
  Phase 3 should add a `worker_claims` table or a NOTIFY-based dispatch
  protocol if multi-instance becomes a thing.
- **The Regenerate button is wired to nothing real.** Adding a handler
  needs the `stages.status = 'superseded'` transition + a new `attempt`
  row; the protocol type already supports `attempt: integer`.
- **`mock-data.ts` is still imported by `/repos` and `/settings` pages.**
  Removing it entirely is blocked on repo CRUD landing.

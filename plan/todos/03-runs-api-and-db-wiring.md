# Todo 3 — Real `/api/runs` + DB wiring + research vertical

Replace `MOCK_RUNS` with the real DB and light up the Phase 2 happy path:
a worker can claim a pending run, stream research events, and the
dashboard shows them live. Maps to §11 Phase 2 of
[`../implementation-plan.md`](../implementation-plan.md).

Depends on: todo 1 (auth), todo 2 (WS + pubsub).

## Goal

End-to-end demoable flow with a stub worker:

1. `POST /api/runs` creates a run, persists it as `pending`, broadcasts
   `run.start` to a connected worker
2. Stub worker emits `stage.started` → a few `event.append` → `stage.completed`
   for the `research` stage
3. Dashboard's run detail page hydrates from `GET /api/runs/:id`, then
   subscribes over WS and streams new events into the right pane
4. Gate 1 bar appears when status flips to `awaiting_research_approval`;
   clicking Approve sends `gate.decide` and persists a `gate_decisions`
   row

## Scope

- `src/server/runs.ts` — `createRun`, `getRun`, `listRuns`, `claimRun`,
  `transitionStatus(runId, next)`, all wrapped in transactions and using
  `canTransition()` from `@yavin/protocol`
- `src/server/events.ts` — `appendEvent` that allocates the next `seq` for
  the run (advisory lock or `select max(seq)+1 ... for update`), inserts
  the row, and `pubsub.publish`es it
- `src/server/gates.ts` — `recordGateDecision`, transitions the run to
  the next status, broadcasts `gate.decided` to the claiming worker
- Wire WS worker handlers from todo 2:
  - `run.claim` → claim a `pending` run for this socket, send `run.start`
  - `event.append` → `appendEvent`
  - `stage.started` / `stage.completed` / `stage.failed` → update `stages`,
    transition the run, broadcast `run.updated`
  - `gate.await` → transition to `awaiting_*_approval`, broadcast `gate.awaiting`
- Replace `MOCK_RUNS` consumers in:
  - `src/app/(dashboard)/page.tsx` (run list)
  - `src/app/(dashboard)/runs/[id]/page.tsx` (initial snapshot)
  - keep `mock-data.ts` for tests + storybook-style preview only
- `run-detail-client.tsx` opens a WS client connection, sends
  `subscribe` with the run id, merges incoming events into local state
- Stub worker `scripts/stub-worker.ts` that emits a scripted research
  stage so the demo works without rogue-one

## Out of scope

- Plan / code / review stages and their renderers (Phase 3)
- Concurrency enforcement (Phase 3)
- Repo config CRUD with encryption (Phase 3)
- Reconnect + replay (Phase 4)
- Real Jira/Linear/GitHub lookup — `POST /api/runs` accepts a hand-typed
  ticket payload for now

## Acceptance

- `pnpm dev` + `pnpm tsx scripts/stub-worker.ts` + browser at `/`:
  - Click "New run" → run appears in the list as `pending` then flips to
    `researching` within ~1s
  - Open the run → research brief renders, events stream in live
  - Click Approve on the gate bar → run advances; the `gate_decisions`
    row is recorded with `decided_by` = the signed-in user's id (or the
    API key's owning user when the call comes from a worker)
- `GET /api/runs/<id>` returns the run + its stages + events
- `pnpm typecheck`, `pnpm lint` clean; basic happy-path test in
  `src/server/runs.test.ts` using a per-test schema

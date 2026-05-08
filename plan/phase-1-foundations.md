# Phase 1 — Foundations (built)

What landed in the first build pass. Maps to §11 Phase 1 of
[`implementation-plan.md`](./implementation-plan.md), minus auth middleware
and the WebSocket server (deferred to Phase 1.5).

## Repo layout

```
yavin-iv/
├── packages/
│   └── protocol/                 # @yavin/protocol workspace package
│       └── src/{index,runStatus,messages,schemas}.ts
├── src/
│   ├── app/
│   │   ├── (dashboard)/{layout,page}.tsx
│   │   ├── (dashboard)/runs/[id]/{page,run-detail-client}.tsx
│   │   ├── (dashboard)/repos/page.tsx
│   │   ├── (dashboard)/settings/page.tsx
│   │   ├── api/health/route.ts
│   │   ├── globals.css           # Tailwind v4 + shadcn theme tokens
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                   # shadcn primitives
│   │   ├── nav.tsx
│   │   ├── run-card.tsx
│   │   ├── stage-timeline.tsx
│   │   ├── event-stream.tsx
│   │   ├── status-pill.tsx
│   │   └── gate-bar.tsx
│   ├── db/{schema,client}.ts + migrations/0000_plain_angel.sql
│   └── lib/{mock-data,format,utils}.ts
├── server.ts                     # custom Next.js entry (WS attach point reserved)
├── docker-compose.yml            # postgres:16-alpine
├── drizzle.config.ts
├── components.json               # shadcn config
└── package.json + pnpm-workspace.yaml
```

## Tech choices

| Layer            | Pick                                           |
| ---------------- | ---------------------------------------------- |
| Package manager  | pnpm 9.15.0 (via corepack) with workspaces     |
| Framework        | Next.js 15.1.3, App Router, custom `server.ts` |
| Language         | TypeScript 5.9 strict                          |
| Styling          | Tailwind v4 + shadcn/ui (New York / neutral)   |
| DB               | Postgres 16 (Docker), driver `postgres-js`     |
| ORM              | Drizzle 0.38 + drizzle-kit migrations          |
| Markdown         | react-markdown + remark-gfm                    |
| Validation       | zod (used in `@yavin/protocol`)                |
| Lint / format    | ESLint (`next/core-web-vitals`) + Prettier     |

## `@yavin/protocol`

Single source of truth for types shared with rogue-one. Currently consumed
only by the dashboard, but the package boundary means it can be extracted
to its own repo + private registry later without code churn.

- `runStatus.ts` — 14-state `RunStatus` union, `VALID_TRANSITIONS` map,
  `canTransition()`, `TERMINAL_STATUSES`, `AWAITING_GATE_STATUSES`.
- `messages.ts` — `Run`, `Stage`, `Event`, `RepoConfig`, `Ticket`, plus the
  four WebSocket envelope unions (`ServerToWorker`, `WorkerToServer`,
  `ServerToClient`, `ClientToServer`).
- `schemas.ts` — zod schemas for stage outputs (`ResearchOutput`,
  `PlanOutput`, `PlanReviewOutput`, `CodeOutput`, `CodeReviewOutput`,
  `PrOutput`). Intentionally loose; tighten as rogue-one stabilizes.

The Drizzle schema **reuses the protocol unions** (`RUN_STATUSES`,
`STAGE_KINDS`, etc.) to define `pgEnum`s, so DB and protocol cannot drift.

## Database

Eight tables, seven enums, fourteen indexes — all from §5 of the plan.

- `repo_configs`, `runs`, `stages`, `events`, `gate_decisions`,
  `agent_messages`, `api_keys`
- Enums: `run_status`, `stage_kind`, `stage_status`, `gate_kind`,
  `gate_decision`, `ticket_provider`, `agent_role`
- Indexes on `runs(repo_config_id)`, `runs(status)`, `stages(run_id)`,
  `events(run_id)`, `events(run_id, seq)`, `gate_decisions(run_id)`,
  `agent_messages(run_id)`
- JSONB for free-form payloads (`events.payload`, `stages.output`,
  `agent_messages.content`, `repo_configs.ticket_providers`)
- `events.id` is `bigserial`, `events.seq` is `bigint` per-run monotonic
  (the WS replay mechanism in Phase 4 keys off this)

Migration file: `src/db/migrations/0000_plain_angel.sql`. Applied cleanly
against a fresh `postgres:16-alpine` container.

## UI

Sidebar (Runs / Repos / Settings) + top header on every dashboard page.

- **`/`** — run list. Filter chips (visual-only for now), grid of
  `RunCard`s pulling from `MOCK_RUNS`. Five seeded runs cover `coding`,
  `awaiting_plan_approval`, `completed`, `failed`, `pending` so every
  status pill renders.
- **`/runs/[id]`** — three-pane layout exactly per §9 of the plan. Left:
  `StageTimeline` with the six stage rows + status icons. Center: stage
  detail (research = markdown brief with citations; plan = numbered step
  cards with file chips; other stages render output JSON). Right:
  `EventStream` with collapsible per-event JSON. Sticky `GateBar` at the
  bottom whenever the run is in an `awaiting_*_approval` state, with
  Approve / Reject / Regenerate-with-feedback buttons (the regenerate
  button opens a dialog with a textarea).
- **`/repos`** — table from `MOCK_REPOS` + non-functional Add Repo dialog.
- **`/settings`** — API keys table, default model fields, gate toggles
  (informational — server enforces all three regardless until Phase 4).

All data comes from `src/lib/mock-data.ts`. No DB queries yet.

## Custom server

`server.ts` boots Next.js in custom-server mode on `http.createServer`
so a `ws.Server` can attach to the same HTTP server in the next pass.
Currently a no-op shell with a `// TODO` marker where the WS server will
mount. `pnpm dev` runs `tsx watch server.ts`.

## Verification

Run from a clean state:

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm dev
```

Checked at the end of the build pass:

- `pnpm install` — succeeds, no peer warnings beyond shadcn's `radix-ui`
  add (handled with `.npmrc` `ignore-workspace-root-check=true`).
- `docker compose up -d` + `pnpm db:migrate` — 7 tables, 7 enums, 14
  indexes verified via `\dt`, `\dT`, and `pg_indexes`.
- `pnpm dev` — server logs `> yavin-iv ready on http://0.0.0.0:3000`.
- `GET /api/health` → `200 {"ok":true}`.
- `/`, `/repos`, `/settings`, `/runs/<mock-id>` — all 200; HTML contains
  expected ticket IDs, status labels, "Stages", "Events", and "Gate
  decision required" on the awaiting-plan-approval run.
- `pnpm typecheck` — clean.
- `pnpm lint` — clean.

## Out of scope (next phase)

- API key auth middleware (Bearer token on REST, query param on WS)
- `src/server/ws.ts` — WebSocket server with worker + client channels,
  authentication, subscription handling
- `src/server/pubsub.ts` — Postgres `LISTEN/NOTIFY` wrapper for cross-
  process event fan-out
- Real `POST /api/runs`, `GET /api/runs`, `GET /api/runs/:id` etc.
- Replacing `MOCK_*` fixtures with DB-backed queries
- Reconnection + event replay (`sinceSeq` per run)

## Notes for whoever picks this up next

- `.npmrc` has `ignore-workspace-root-check=true` so `pnpm dlx shadcn add`
  can install Radix deps into the root. If you switch shadcn to install
  into a sub-package later, drop that line.
- `next-env.d.ts` is regenerated by Next.js on every build/lint — don't
  hand-edit it; it's in the gitignore-aware Next.js workflow.
- The protocol package uses extensionless relative imports
  (`./runStatus` not `./runStatus.js`) and is **not** `"type": "module"`
  — this lets drizzle-kit's CJS loader resolve TS sources via the same
  path Next.js does. Don't add `"type": "module"` back without also
  swapping drizzle-kit's loading strategy.
- `MOCK_RUNS` deliberately includes one run per visually distinct UI
  state. If you add new states (e.g. `awaiting_human_intervention`),
  seed a mock run for it so the UI stays exercisable without a worker.

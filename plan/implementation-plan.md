yavin-iv — Implementation Plan
1. What yavin-iv is
The dashboard and source of truth for AI-driven SDLC runs. It owns the database, the UI, and the API. It does not spawn agents or touch git — that's rogue-one's job.
yavin-iv's responsibilities:

Persist runs, stages, events, gate decisions, and agent transcripts
Expose REST + WebSocket APIs for rogue-one to publish events and receive gate decisions
Render the dashboard UI for humans to monitor runs, approve/reject/regenerate at gates, and configure repos
Hold integration credentials (Jira, Linear, GitHub) and proxy lookups for rogue-one
Enforce concurrency limits and run lifecycle state

Anything CPU-heavy, agentic, or filesystem-touching belongs in rogue-one. yavin-iv stays a stateful web app.
2. Relationship to rogue-one
yavin-iv treats rogue-one as any number of untrusted-but-authenticated worker processes that connect over WebSocket. Multiple rogue-one processes can connect concurrently (one per machine, one per developer, etc.) — yavin-iv doesn't care, as long as they present a valid API key and respect the run-state-machine rules on the server.
Integration contract:

A separate npm package (@yavin/protocol) defines all message types, run state machine, and DTOs. Both repos depend on it as a versioned dependency.
Communication: REST for setup/queries, WebSocket for real-time events and gate decisions.
Auth: shared API key in Authorization: Bearer <key> header (REST) or ?token=<key> query param (WebSocket).

yavin-iv is the server of truth — rogue-one's local memory of a run is a cache. Every state transition, every event, every decision goes through yavin-iv and is persisted before being broadcast.
3. Tech stack
LayerChoiceRationaleFrameworkNext.js (App Router)Server components for the dashboard, route handlers for REST, single deployableLanguageTypeScriptType sharing with rogue-one via @yavin/protocolWebSocket serverws package, hosted in a custom Next.js server (server.ts)Next.js doesn't ship a built-in WS handler; running a custom server is the cleanest pathDBPostgres 16ACID, JSONB for event payloads, LISTEN/NOTIFY for cross-process pubsubORMDrizzle ORMType-safe, lightweight, excellent JSONB ergonomicsMigrationsdrizzle-kitGenerates SQL migrations from schemaUITailwind + shadcn/uiFast to build, looks decent without much design effortDiff renderingreact-diff-viewer-continuedGitHub-style diffs for the code review stageMarkdown renderingreact-markdown + remark-gfmPlans and research briefs render as markdownAuthSingle shared API key in env var; UI gates with same key in localStorageMatches small-team, local-first scopeLocal devDocker Compose for Postgres only; Next.js runs on hostFast HMR, no container rebuild loop
4. Repository layout
yavin-iv/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (dashboard)/
│   │   │   ├── page.tsx              # run list
│   │   │   ├── runs/[id]/page.tsx    # run detail
│   │   │   ├── repos/page.tsx        # repo configs
│   │   │   └── settings/page.tsx     # API key, defaults
│   │   ├── api/
│   │   │   ├── runs/route.ts         # POST create, GET list
│   │   │   ├── runs/[id]/route.ts    # GET detail, PATCH cancel
│   │   │   ├── runs/[id]/gates/[kind]/route.ts  # POST decision (REST fallback)
│   │   │   ├── repos/route.ts
│   │   │   └── tickets/lookup/route.ts  # proxy to Jira/Linear/GH
│   │   └── layout.tsx
│   ├── server/
│   │   ├── ws.ts                     # WebSocket server, pubsub, auth
│   │   ├── pubsub.ts                 # Postgres LISTEN/NOTIFY wrapper
│   │   ├── runs.ts                   # run lifecycle service
│   │   ├── gates.ts                  # gate decision service
│   │   └── integrations/             # Jira, Linear, GitHub Issues clients
│   ├── db/
│   │   ├── schema.ts                 # Drizzle schema
│   │   ├── client.ts
│   │   └── migrations/
│   └── components/                   # React components
├── server.ts                         # Custom Next.js server entry (for WS)
├── docker-compose.yml                # Postgres
├── drizzle.config.ts
└── package.json
5. Data model
All tables live in yavin-iv's database. rogue-one never touches Postgres directly.
ts// src/db/schema.ts (Drizzle, abbreviated)

runs {
  id: uuid PK
  repo_config_id: uuid FK
  ticket_provider: enum('jira','linear','github')
  ticket_id: text
  ticket_url: text
  instructions: text
  branch_name: text
  worktree_path: text          // reported by rogue-one after creation
  status: enum                 // see state machine in @yavin/protocol
  current_stage: enum nullable
  created_by: text             // API key label / user
  created_at: timestamptz
  updated_at: timestamptz
}

stages {
  id: uuid PK
  run_id: uuid FK
  kind: enum('research','plan','plan_review','code','code_review','pr')
  status: enum('pending','running','completed','failed','superseded')
  attempt: int                 // 1 on first try, 2 after auto-retry
  started_at, ended_at: timestamptz nullable
  output: jsonb                // shape varies by kind, validated against zod schemas
  error_text: text nullable
}

events {
  id: bigserial PK
  run_id: uuid FK (indexed)
  stage_id: uuid FK nullable
  seq: bigint                  // monotonic per run
  kind: text                   // 'tool_call', 'tool_result', 'message', 'log', etc.
  payload: jsonb
  created_at: timestamptz
}

gate_decisions {
  id: uuid PK
  run_id: uuid FK
  stage_id: uuid FK
  gate_kind: enum('post_research','post_plan','pre_pr')
  decision: enum('approved','rejected','regenerate')
  feedback_text: text nullable
  decided_by: text
  decided_at: timestamptz
}

agent_messages {
  id: uuid PK
  run_id: uuid FK (indexed)
  stage_id: uuid FK
  role: enum('user','assistant','system','tool')
  content: jsonb
  tokens_in, tokens_out: int nullable
  model: text nullable
  cost_usd: numeric(10,6) nullable
  created_at: timestamptz
}

repo_configs {
  id: uuid PK
  name: text                   // display name
  repo_path: text              // absolute path on the rogue-one host
  base_branch: text            // 'main' typically
  branch_prefix: text          // 'rogue-one/'
  concurrency_limit: int       // default 1
  ticket_providers: jsonb      // which providers are configured + creds (encrypted)
  github_repo: text            // 'owner/repo' for PR opening
  created_at, updated_at
}

api_keys {
  id: uuid PK
  label: text                  // 'laptop', 'desktop', 'ci'
  key_hash: text               // bcrypt
  created_at, last_used_at
}
Concurrency enforcement: when rogue-one requests a run start, yavin-iv checks count(active runs for repo_config_id) < concurrency_limit. If full, the run stays pending and is woken via NOTIFY when a slot frees.
6. The protocol package (@yavin/protocol)
This is the shared contract between yavin-iv and rogue-one. Published to a private npm registry, GitHub Packages, or just consumed via a git URL for v1.
ts// run state machine
export type RunStatus =
  | 'pending'
  | 'researching' | 'awaiting_research_approval'
  | 'planning' | 'reviewing_plan' | 'awaiting_plan_approval'
  | 'coding' | 'reviewing_code'
  | 'awaiting_pr_approval' | 'opening_pr'
  | 'completed' | 'failed' | 'cancelled' | 'awaiting_human_intervention';

export const VALID_TRANSITIONS: Record<RunStatus, RunStatus[]> = { /* ... */ };

// WebSocket envelope
export type ServerToWorker =
  | { kind: 'run.start'; run: Run; repoConfig: RepoConfig; ticket: Ticket }
  | { kind: 'gate.decided'; runId: string; gateKind: GateKind; decision: GateDecision; feedback?: string }
  | { kind: 'run.cancel'; runId: string };

export type WorkerToServer =
  | { kind: 'run.claim'; runId: string }                  // worker picks up a pending run
  | { kind: 'run.status'; runId: string; status: RunStatus }
  | { kind: 'stage.started'; runId: string; stage: Stage }
  | { kind: 'stage.completed'; runId: string; stage: Stage }
  | { kind: 'stage.failed'; runId: string; stageId: string; error: string }
  | { kind: 'event.append'; event: EventInput }
  | { kind: 'agent.message'; message: AgentMessageInput }
  | { kind: 'gate.await'; runId: string; gateKind: GateKind; payload: unknown };

export type ServerToClient =
  | { kind: 'run.snapshot'; run: Run; stages: Stage[]; events: Event[] }
  | { kind: 'run.updated'; run: Run }
  | { kind: 'event.appended'; event: Event }
  | { kind: 'gate.awaiting'; runId: string; gateKind: GateKind; payload: unknown };

export type ClientToServer =
  | { kind: 'subscribe'; runIds?: string[] }
  | { kind: 'gate.decide'; runId: string; gateKind: GateKind; decision: GateDecision; feedback?: string }
  | { kind: 'run.cancel'; runId: string };

// Stage output schemas (zod)
export const ResearchOutput = z.object({ /* ... */ });
export const PlanOutput = z.object({ /* ... */ });
// etc.
Both repos npm install @yavin/protocol. Version it with semver — breaking changes require coordinated deploys.
7. REST API
MethodPathPurposePOST/api/runsrogue-one or CLI creates a run. Returns runId, dispatches pending → researching if slot available.GET/api/runsList runs (filterable).GET/api/runs/:idFull run detail (run + stages + events).PATCH/api/runs/:idCancel.POST/api/runs/:id/gates/:kindSubmit gate decision. WebSocket-preferred but REST fallback for the CLI.GET/api/repos / POSTRepo config CRUD.POST/api/tickets/lookupBody: { url }. Detects provider, fetches ticket + related items. Used by rogue-one during research.GET/api/healthLiveness.
All REST routes require Authorization: Bearer <api_key>.
8. WebSocket server
Two channel types on a single endpoint (/ws), distinguished by a ?role=worker|client query param plus the API key:
Worker channel (rogue-one): authenticates, sends a run.claim for a pending run, then streams WorkerToServer messages. yavin-iv pushes gate.decided and run.cancel back. Backpressure: if Postgres writes lag, the worker socket buffers up to N messages then disconnects with a clear error — rogue-one is expected to reconnect and replay.
Client channel (browser dashboard): subscribes to runs, receives ServerToClient messages, pushes ClientToServer. One client connection can subscribe to multiple runs.
Implementation plan:

Custom server.ts boots Next.js in custom-server mode and attaches a ws.Server on the same HTTP server.
A pubsub.ts module wraps Postgres LISTEN/NOTIFY on a single channel yavin_events. When any worker writes an event, pg_notify('yavin_events', json_payload) fires (via Drizzle in a transaction).
WebSocket server listens to NOTIFY and fans out to subscribed client sockets. This means even if you scale to multiple yavin-iv instances later, every client sees every relevant event.

Reconnection + replay: every event has a monotonic seq per run. Clients send subscribe with the last seen seq per run; server replays missed events from events table before resuming the live stream. Workers similarly resume by querying the run's current state on reconnect.
9. Dashboard UI
Run list (/)
Card per run: title (ticket key + summary), repo, status pill, current stage, elapsed time, cost-so-far. Filter by repo, status, ticket provider.
Run detail (/runs/[id])
Three-pane layout:

Left — stage timeline. Six rows (research → plan → plan_review → code → code_review → pr), each with a status icon and elapsed time. Click a stage to jump.
Center — current stage detail. Research = markdown brief with citations. Plan = structured plan rendered as collapsible markdown. Plan review = side-by-side plan + critique with revision diff. Code = file tree of changes + per-file diff. Code review = inline comments on diff. PR = preview of the PR body.
Right — live event stream. Each event is a row with an icon (tool_call, tool_result, message, log) and a one-line summary; click to expand. New events auto-scroll unless the user has scrolled up.

Persistent gate-decision bar appears at the bottom whenever the run is in an awaiting_*_approval status. Shows the gate kind, the artifact under review, and three buttons: Approve, Reject (terminates the run), Regenerate with feedback (opens a textarea, submits the feedback, kicks the stage back to rogue-one for a new attempt).
Repos (/repos)
Form per repo: name, path on disk, base branch, branch prefix, concurrency limit, GitHub repo, ticket provider credentials. Test buttons that hit /api/tickets/lookup with a sample URL to verify creds.
Settings (/settings)
API key management (create labeled keys, revoke), default models, gate enable/disable toggles (kept on for MVP — UI exists but server enforces all three regardless until phase 4 polish lands).
10. Integrations module
src/server/integrations/ — one file per provider, all implementing:
tsinterface TicketProvider {
  matches(url: string): boolean;
  fetchTicket(url: string, creds: Creds): Promise<Ticket>;
  fetchRelated(ticketId: string, creds: Creds): Promise<RelatedItem[]>;
}
Implementations: jira.ts, linear.ts, githubIssues.ts. Credentials stored encrypted in repo_configs.ticket_providers (encrypted with a key from env var; AES-GCM). The /api/tickets/lookup route picks the right provider based on URL pattern and returns a normalized Ticket object that rogue-one consumes during research.
11. Build phases
Phase 1 — Foundations (week 1)

Next.js + custom server scaffold
Postgres + Drizzle + initial migrations
@yavin/protocol package skeleton, published to a private registry or git URL
API key auth middleware
Health check + minimal run-list page
WebSocket server accepting authenticated worker and client connections (no business logic yet)

Demoable: rogue-one (or wscat) can connect, send a heartbeat, get a heartbeat back. Dashboard loads and shows zero runs.
Phase 2 — Run + research vertical (week 2)

runs, stages, events, agent_messages tables wired up
POST /api/runs creates a run and broadcasts run.start over WS to a connected worker
Worker sends event.append, stage.started, stage.completed for the research stage; yavin-iv persists and rebroadcasts to clients
Run detail page renders the timeline, the research brief, and the live event stream
Gate 1 UI (Approve / Reject / Regenerate) wired to gate.decide over WS, persisting gate_decisions

Demoable: with a stub rogue-one that just emits fake events, you can drive a research stage end-to-end through the UI.
Phase 3 — Full pipeline UI (weeks 3-4)

All six stages with their respective renderers (plan, plan_review with critique trail, code with diff viewer, code_review with inline comments, pr preview)
Gate 2 and Gate 3 hooked up
Concurrency enforcement (pending queueing + NOTIFY when slots free)
Repo config CRUD with credential encryption
/api/tickets/lookup with all three providers

Demoable: with a real rogue-one running, you can take a Linear ticket from /rogue-one invocation through PR open, gating at all three points.
Phase 4 — Polish for daily use (week 5)

Run cancellation
Reconnection + event replay (clients track last-seen seq)
Cost surfacing per run and per stage
API key labels and rotation UI
Auto-retry surfacing (show attempt number, link previous attempt's events)
awaiting_human_intervention UI for the auto-retry-then-escalate flow

Demoable: the team uses it for real work without you needing to babysit it.
12. What yavin-iv does NOT do
These are explicitly rogue-one's job — yavin-iv should never grow code that does any of them:

Spawn Claude Code subagents
Touch the filesystem (read repos, create worktrees, write files)
Run git commands
Open GitHub PRs
Run tests or linters
Hold long-running agent processes

If you find yourself reaching for any of these in a yavin-iv PR, stop and ask whether it should be a new event/message type from rogue-one instead.
13. Open questions before phase 3

Multi-tenant later? Schema currently has no tenant column. Add one early if multi-team is on the horizon — retrofitting is painful.
Encryption key rotation? Credentials in repo_configs.ticket_providers are encrypted with ENCRYPTION_KEY. Document the rotation procedure (decrypt-with-old, re-encrypt-with-new) before storing real creds.
Plan output schema strictness. Strict zod schema makes the UI rendering reliable but means rogue-one's planner can't deviate. Recommendation: strict required fields + a free-form notes per step.
Event payload size. Tool calls with large outputs (e.g., a 2MB grep result) shouldn't bloat the events table. Recommendation: cap inline payload at 64KB and store overflow in a separate event_blobs table or object storage with a pointer.
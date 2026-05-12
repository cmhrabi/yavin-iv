// NOTE: no longer the live data source — dashboard reads runs from Postgres
// via `@/server/runs`. Kept in-tree for tests, storybook-style previews, and
// the run-detail mock fixtures that still exercise stage renderers.
import type {
  AgentMessage,
  Event,
  RepoConfig,
  Run,
  Stage,
} from "@yavin/protocol";

const REPO_ID_A = "repo-aaaaaaaa-1111-1111-1111-111111111111";
const REPO_ID_B = "repo-bbbbbbbb-2222-2222-2222-222222222222";

export const MOCK_REPOS: RepoConfig[] = [
  {
    id: REPO_ID_A,
    name: "yavin-iv",
    repoPath: "/Users/calum/code/yavin-iv",
    baseBranch: "main",
    branchPrefix: "rogue-one/",
    concurrencyLimit: 1,
    ticketProviders: ["linear", "github"],
    githubRepo: "kablamo/yavin-iv",
    createdAt: "2026-04-12T09:00:00Z",
    updatedAt: "2026-05-01T12:30:00Z",
  },
  {
    id: REPO_ID_B,
    name: "rogue-one",
    repoPath: "/Users/calum/code/rogue-one",
    baseBranch: "main",
    branchPrefix: "auto/",
    concurrencyLimit: 2,
    ticketProviders: ["jira"],
    githubRepo: "kablamo/rogue-one",
    createdAt: "2026-04-15T10:00:00Z",
    updatedAt: "2026-04-28T08:00:00Z",
  },
];

export const MOCK_RUNS: Run[] = [
  {
    id: "run-1111aaaa-0000-0000-0000-000000000001",
    repoConfigId: REPO_ID_A,
    ticketProvider: "linear",
    ticketId: "ENG-482",
    ticketUrl: "https://linear.app/kablamo/issue/ENG-482",
    ticketTitle: "Add concurrency limits to run scheduler",
    instructions: "Implement per-repo concurrency caps as described in the spec.",
    branchName: "rogue-one/eng-482-concurrency",
    worktreePath: "/Users/calum/code/yavin-iv-worktrees/eng-482",
    status: "coding",
    currentStage: "code",
    createdBy: "laptop",
    createdAt: "2026-05-07T08:12:00Z",
    updatedAt: "2026-05-07T09:55:00Z",
    costUsd: 1.84,
  },
  {
    id: "run-2222bbbb-0000-0000-0000-000000000002",
    repoConfigId: REPO_ID_A,
    ticketProvider: "linear",
    ticketId: "ENG-501",
    ticketUrl: "https://linear.app/kablamo/issue/ENG-501",
    ticketTitle: "WebSocket reconnection + replay",
    instructions: "Track lastSeenSeq per run on the client and replay missed events.",
    branchName: "rogue-one/eng-501-ws-replay",
    worktreePath: "/Users/calum/code/yavin-iv-worktrees/eng-501",
    status: "awaiting_plan_approval",
    currentStage: "plan",
    createdBy: "desktop",
    createdAt: "2026-05-07T07:30:00Z",
    updatedAt: "2026-05-07T08:42:00Z",
    costUsd: 0.42,
  },
  {
    id: "run-3333cccc-0000-0000-0000-000000000003",
    repoConfigId: REPO_ID_B,
    ticketProvider: "jira",
    ticketId: "PLAT-1207",
    ticketUrl: "https://kablamo.atlassian.net/browse/PLAT-1207",
    ticketTitle: "Worktree cleanup on cancel",
    instructions: "When a run is cancelled mid-flight, prune the worktree.",
    branchName: "auto/plat-1207-worktree-cleanup",
    worktreePath: null,
    status: "completed",
    currentStage: "pr",
    createdBy: "ci",
    createdAt: "2026-05-06T11:00:00Z",
    updatedAt: "2026-05-06T13:22:00Z",
    costUsd: 3.11,
  },
  {
    id: "run-4444dddd-0000-0000-0000-000000000004",
    repoConfigId: REPO_ID_B,
    ticketProvider: "jira",
    ticketId: "PLAT-1199",
    ticketUrl: "https://kablamo.atlassian.net/browse/PLAT-1199",
    ticketTitle: "Investigate flaky integration test",
    instructions: "test_run_lifecycle.spec.ts fails ~5% on CI.",
    branchName: "auto/plat-1199-flaky-test",
    worktreePath: null,
    status: "failed",
    currentStage: "code",
    createdBy: "laptop",
    createdAt: "2026-05-05T14:10:00Z",
    updatedAt: "2026-05-05T14:48:00Z",
    costUsd: 0.93,
  },
  {
    id: "run-5555eeee-0000-0000-0000-000000000005",
    repoConfigId: REPO_ID_A,
    ticketProvider: "github",
    ticketId: "yavin-iv#42",
    ticketUrl: "https://github.com/kablamo/yavin-iv/issues/42",
    ticketTitle: "Surface per-stage cost in run detail UI",
    instructions: "Show $/stage breakdown in the right pane.",
    branchName: null,
    worktreePath: null,
    status: "pending",
    currentStage: null,
    createdBy: "desktop",
    createdAt: "2026-05-07T09:58:00Z",
    updatedAt: "2026-05-07T09:58:00Z",
    costUsd: 0,
  },
];

const STAGE_KINDS = ["research", "plan", "plan_review", "code", "code_review", "pr"] as const;

export const MOCK_STAGES: Stage[] = MOCK_RUNS.flatMap((run) =>
  STAGE_KINDS.map<Stage>((kind, i) => {
    const stageId = `stage-${run.id.slice(4, 12)}-${kind}`;
    let status: Stage["status"] = "pending";
    let output: unknown = null;
    let startedAt: string | null = null;
    let endedAt: string | null = null;

    const currentIdx = run.currentStage ? STAGE_KINDS.indexOf(run.currentStage) : -1;

    if (currentIdx >= 0 && i < currentIdx) {
      status = "completed";
      startedAt = run.createdAt;
      endedAt = run.updatedAt;
    } else if (currentIdx >= 0 && i === currentIdx) {
      if (run.status === "failed") {
        status = "failed";
        startedAt = run.createdAt;
        endedAt = run.updatedAt;
      } else if (run.status === "completed") {
        status = "completed";
        startedAt = run.createdAt;
        endedAt = run.updatedAt;
      } else {
        status = "running";
        startedAt = run.updatedAt;
      }
    }

    if (kind === "research" && status === "completed") {
      output = {
        brief:
          "## Summary\n\nThe ticket asks for per-repo concurrency caps. The codebase already has " +
          "a `runs` table and a `repo_configs` table; the scheduler currently grants all incoming " +
          "runs a slot.\n\n### Approach\n\n- Read `concurrency_limit` from `repo_configs`\n- " +
          "When a worker requests `run.claim`, check `count(runs WHERE status IN ('researching',...) AND repo_config_id = X)`\n- " +
          "If full, leave the run `pending` and emit a `NOTIFY` when a slot frees.\n\n### Citations\n\n- `src/db/schema.ts`\n- `implementation-plan.md` §5",
        citations: [
          { url: "https://linear.app/kablamo/issue/ENG-482", title: "ENG-482" },
        ],
      };
    }
    if (kind === "plan" && (status === "completed" || status === "running")) {
      output = {
        summary: "Add concurrency enforcement at run.claim time using a Postgres advisory lock.",
        steps: [
          { title: "Read concurrency_limit from repo_configs", description: "Join in the runs query.", files: ["src/server/runs.ts"] },
          { title: "Reject claim when over-cap", description: "Return a typed error so rogue-one can back off.", files: ["src/server/ws.ts"] },
          { title: "NOTIFY when a slot frees", description: "Wire into the run status update path.", files: ["src/server/pubsub.ts"] },
        ],
      };
    }

    return {
      id: stageId,
      runId: run.id,
      kind,
      status,
      attempt: 1,
      startedAt,
      endedAt,
      output,
      errorText: status === "failed" ? "Tests failed: 3 of 47 specs in test_run_lifecycle.spec.ts" : null,
    };
  }),
);

export const MOCK_EVENTS: Event[] = MOCK_RUNS.flatMap((run, runIdx) => {
  const base = Date.parse(run.createdAt);
  return [
    { kind: "log", payload: { message: `Run ${run.ticketId} created by ${run.createdBy}` } },
    { kind: "tool_call", payload: { name: "fetch_ticket", args: { url: run.ticketUrl } } },
    { kind: "tool_result", payload: { name: "fetch_ticket", ok: true, ms: 412 } },
    { kind: "message", payload: { role: "assistant", text: "Reading repo and ticket context…" } },
    { kind: "tool_call", payload: { name: "grep", args: { pattern: "concurrency", path: "src/" } } },
    { kind: "tool_result", payload: { name: "grep", matches: 7 } },
    { kind: "message", payload: { role: "assistant", text: "Drafting research brief…" } },
  ].map<Event>((e, i) => ({
    id: `event-${runIdx}-${i}`,
    runId: run.id,
    stageId: MOCK_STAGES.find((s) => s.runId === run.id && s.kind === "research")?.id ?? null,
    seq: i + 1,
    kind: e.kind,
    payload: e.payload,
    createdAt: new Date(base + i * 60_000).toISOString(),
  }));
});

export const MOCK_AGENT_MESSAGES: AgentMessage[] = [];

export function findMockRun(id: string): Run | undefined {
  return MOCK_RUNS.find((r) => r.id === id);
}

export function stagesForRun(runId: string): Stage[] {
  return MOCK_STAGES.filter((s) => s.runId === runId);
}

export function eventsForRun(runId: string): Event[] {
  return MOCK_EVENTS.filter((e) => e.runId === runId);
}

export function repoForId(id: string): RepoConfig | undefined {
  return MOCK_REPOS.find((r) => r.id === id);
}

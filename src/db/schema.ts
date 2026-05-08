import {
  bigserial,
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  AGENT_ROLES,
  GATE_DECISIONS,
  GATE_KINDS,
  RUN_STATUSES,
  STAGE_KINDS,
  STAGE_STATUSES,
  TICKET_PROVIDERS,
} from "@yavin/protocol";

// Reuse the protocol unions as the source of truth for enums.
// `as [string, ...string[]]` satisfies pgEnum's tuple requirement without
// duplicating the values here.
export const runStatusEnum = pgEnum("run_status", RUN_STATUSES as unknown as [string, ...string[]]);
export const stageKindEnum = pgEnum("stage_kind", STAGE_KINDS as unknown as [string, ...string[]]);
export const stageStatusEnum = pgEnum("stage_status", STAGE_STATUSES as unknown as [string, ...string[]]);
export const gateKindEnum = pgEnum("gate_kind", GATE_KINDS as unknown as [string, ...string[]]);
export const gateDecisionEnum = pgEnum("gate_decision", GATE_DECISIONS as unknown as [string, ...string[]]);
export const ticketProviderEnum = pgEnum("ticket_provider", TICKET_PROVIDERS as unknown as [string, ...string[]]);
export const agentRoleEnum = pgEnum("agent_role", AGENT_ROLES as unknown as [string, ...string[]]);

export const repoConfigs = pgTable("repo_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  repoPath: text("repo_path").notNull(),
  baseBranch: text("base_branch").notNull().default("main"),
  branchPrefix: text("branch_prefix").notNull().default("rogue-one/"),
  concurrencyLimit: integer("concurrency_limit").notNull().default(1),
  // { providers: ['linear', 'github'], creds: { linear: <encrypted>, github: <encrypted> } }
  ticketProviders: jsonb("ticket_providers").notNull().default(sql`'{}'::jsonb`),
  githubRepo: text("github_repo").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoConfigId: uuid("repo_config_id")
      .notNull()
      .references(() => repoConfigs.id, { onDelete: "restrict" }),
    ticketProvider: ticketProviderEnum("ticket_provider").notNull(),
    ticketId: text("ticket_id").notNull(),
    ticketUrl: text("ticket_url").notNull(),
    instructions: text("instructions").notNull().default(""),
    branchName: text("branch_name"),
    worktreePath: text("worktree_path"),
    status: runStatusEnum("status").notNull().default("pending"),
    currentStage: stageKindEnum("current_stage"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("runs_repo_config_id_idx").on(t.repoConfigId),
    index("runs_status_idx").on(t.status),
  ],
);

export const stages = pgTable(
  "stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    kind: stageKindEnum("kind").notNull(),
    status: stageStatusEnum("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    output: jsonb("output"),
    errorText: text("error_text"),
  },
  (t) => [index("stages_run_id_idx").on(t.runId)],
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id").references(() => stages.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "bigint" }).notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_run_id_idx").on(t.runId),
    index("events_run_id_seq_idx").on(t.runId, t.seq),
  ],
);

export const gateDecisions = pgTable(
  "gate_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "cascade" }),
    gateKind: gateKindEnum("gate_kind").notNull(),
    decision: gateDecisionEnum("decision").notNull(),
    feedbackText: text("feedback_text"),
    decidedBy: text("decided_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gate_decisions_run_id_idx").on(t.runId)],
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "cascade" }),
    role: agentRoleEnum("role").notNull(),
    content: jsonb("content").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    model: text("model"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_messages_run_id_idx").on(t.runId)],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  keyHash: text("key_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

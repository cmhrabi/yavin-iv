import type { RunStatus } from "./runStatus";

// ---------- Domain types ----------

export const STAGE_KINDS = [
  "research",
  "plan",
  "plan_review",
  "code",
  "code_review",
  "pr",
] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const STAGE_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "superseded",
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const TICKET_PROVIDERS = ["jira", "linear", "github"] as const;
export type TicketProvider = (typeof TICKET_PROVIDERS)[number];

export const GATE_KINDS = ["post_research", "post_plan", "pre_pr"] as const;
export type GateKind = (typeof GATE_KINDS)[number];

export const GATE_DECISIONS = ["approved", "rejected", "regenerate"] as const;
export type GateDecision = (typeof GATE_DECISIONS)[number];

export const AGENT_ROLES = ["user", "assistant", "system", "tool"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export interface Run {
  id: string;
  repoConfigId: string;
  ticketProvider: TicketProvider;
  ticketId: string;
  ticketUrl: string;
  ticketTitle?: string;
  instructions: string;
  branchName: string | null;
  worktreePath: string | null;
  status: RunStatus;
  currentStage: StageKind | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  costUsd?: number;
}

export interface Stage {
  id: string;
  runId: string;
  kind: StageKind;
  status: StageStatus;
  attempt: number;
  startedAt: string | null;
  endedAt: string | null;
  output: unknown;
  errorText: string | null;
}

export interface Event {
  id: string;
  runId: string;
  stageId: string | null;
  seq: number;
  kind: string;
  payload: unknown;
  createdAt: string;
}

export interface EventInput {
  runId: string;
  stageId: string | null;
  kind: string;
  payload: unknown;
}

export interface AgentMessage {
  id: string;
  runId: string;
  stageId: string;
  role: AgentRole;
  content: unknown;
  tokensIn: number | null;
  tokensOut: number | null;
  model: string | null;
  costUsd: number | null;
  createdAt: string;
}

export interface AgentMessageInput {
  runId: string;
  stageId: string;
  role: AgentRole;
  content: unknown;
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
  costUsd?: number;
}

export interface RepoConfig {
  id: string;
  name: string;
  repoPath: string;
  baseBranch: string;
  branchPrefix: string;
  concurrencyLimit: number;
  ticketProviders: TicketProvider[];
  githubRepo: string;
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  provider: TicketProvider;
  id: string;
  url: string;
  title: string;
  body: string;
  labels?: string[];
  related?: RelatedItem[];
}

export interface RelatedItem {
  id: string;
  url: string;
  title: string;
  relation: string;
}

// ---------- WebSocket envelopes ----------

export type ServerToWorker =
  | { kind: "run.start"; run: Run; repoConfig: RepoConfig; ticket: Ticket }
  | {
      kind: "gate.decided";
      runId: string;
      gateKind: GateKind;
      decision: GateDecision;
      feedback?: string;
    }
  | { kind: "run.cancel"; runId: string }
  | { kind: "ping" };

export type WorkerToServer =
  | { kind: "run.claim"; runId: string }
  | { kind: "run.status"; runId: string; status: RunStatus }
  | { kind: "stage.started"; runId: string; stage: Stage }
  | { kind: "stage.completed"; runId: string; stage: Stage }
  | { kind: "stage.failed"; runId: string; stageId: string; error: string }
  | { kind: "event.append"; event: EventInput }
  | { kind: "agent.message"; message: AgentMessageInput }
  | { kind: "gate.await"; runId: string; gateKind: GateKind; payload: unknown }
  | { kind: "pong" };

export type ServerToClient =
  | { kind: "run.snapshot"; run: Run; stages: Stage[]; events: Event[] }
  | { kind: "run.updated"; run: Run }
  | { kind: "stage.updated"; stage: Stage }
  | { kind: "event.appended"; event: Event }
  | { kind: "gate.awaiting"; runId: string; gateKind: GateKind; payload: unknown };

export type ClientToServer =
  | { kind: "subscribe"; runIds?: string[]; sinceSeq?: Record<string, number> }
  | {
      kind: "gate.decide";
      runId: string;
      gateKind: GateKind;
      decision: GateDecision;
      feedback?: string;
    }
  | { kind: "run.cancel"; runId: string };

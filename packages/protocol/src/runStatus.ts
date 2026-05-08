// The full run lifecycle, mirrored in the Postgres `run_status` enum.
export const RUN_STATUSES = [
  "pending",
  "researching",
  "awaiting_research_approval",
  "planning",
  "reviewing_plan",
  "awaiting_plan_approval",
  "coding",
  "reviewing_code",
  "awaiting_pr_approval",
  "opening_pr",
  "completed",
  "failed",
  "cancelled",
  "awaiting_human_intervention",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

// Skeleton transition map. Tighten as the state machine stabilizes.
// Terminal states (completed/failed/cancelled) intentionally have no outgoing edges.
export const VALID_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  pending: ["researching", "cancelled", "failed"],
  researching: ["awaiting_research_approval", "failed", "cancelled"],
  awaiting_research_approval: ["planning", "researching", "cancelled", "failed"],
  planning: ["reviewing_plan", "failed", "cancelled"],
  reviewing_plan: ["awaiting_plan_approval", "planning", "failed", "cancelled"],
  awaiting_plan_approval: ["coding", "planning", "cancelled", "failed"],
  coding: ["reviewing_code", "failed", "cancelled", "awaiting_human_intervention"],
  reviewing_code: ["awaiting_pr_approval", "coding", "failed", "cancelled"],
  awaiting_pr_approval: ["opening_pr", "coding", "cancelled", "failed"],
  opening_pr: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["awaiting_human_intervention"],
  cancelled: [],
  awaiting_human_intervention: ["researching", "planning", "coding", "cancelled", "failed"],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "cancelled"];

export const AWAITING_GATE_STATUSES: readonly RunStatus[] = [
  "awaiting_research_approval",
  "awaiting_plan_approval",
  "awaiting_pr_approval",
];

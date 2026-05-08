import type { RunStatus } from "@yavin/protocol";
import { cn } from "@/lib/utils";

const styles: Record<RunStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  researching: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  awaiting_research_approval: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  planning: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  reviewing_plan: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  awaiting_plan_approval: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  coding: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  reviewing_code: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  awaiting_pr_approval: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  opening_pr: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  cancelled: "bg-muted text-muted-foreground",
  awaiting_human_intervention: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
};

const labels: Record<RunStatus, string> = {
  pending: "pending",
  researching: "researching",
  awaiting_research_approval: "awaiting research review",
  planning: "planning",
  reviewing_plan: "reviewing plan",
  awaiting_plan_approval: "awaiting plan review",
  coding: "coding",
  reviewing_code: "reviewing code",
  awaiting_pr_approval: "awaiting PR approval",
  opening_pr: "opening PR",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  awaiting_human_intervention: "needs human",
};

export function StatusPill({ status, className }: { status: RunStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        styles[status],
        className,
      )}
    >
      {labels[status]}
    </span>
  );
}

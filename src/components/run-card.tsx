import Link from "next/link";
import type { Run, RepoConfig } from "@cmhrabi/yavin-protocol";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusPill } from "@/components/status-pill";
import { elapsed, formatCost, relativeTime } from "@/lib/format";

const stageLabels: Record<NonNullable<Run["currentStage"]>, string> = {
  research: "Research",
  plan: "Plan",
  plan_review: "Plan review",
  code: "Code",
  code_review: "Code review",
  pr: "Pull request",
};

export function RunCard({ run, repo }: { run: Run; repo?: RepoConfig }) {
  return (
    <Link href={`/runs/${run.id}`} className="block">
      <Card className="hover:border-foreground/30 transition-colors">
        <CardHeader className="space-y-2 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="text-muted-foreground font-mono text-xs">
                {run.ticketId}
              </div>
              <div className="truncate text-sm font-medium">
                {run.ticketTitle ?? "Untitled"}
              </div>
            </div>
            <StatusPill status={run.status} />
          </div>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span>{repo?.name ?? "—"}</span>
            <span>{relativeTime(run.updatedAt)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>
              {run.currentStage ? stageLabels[run.currentStage] : "—"}
            </span>
            <span className="flex gap-2">
              <span>{elapsed(run.createdAt, run.updatedAt)}</span>
              <span>·</span>
              <span>{formatCost(run.costUsd)}</span>
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

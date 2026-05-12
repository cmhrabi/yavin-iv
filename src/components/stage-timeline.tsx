"use client";

import type { Stage, StageKind } from "@cmhrabi/yavin-protocol";
import { Check, Circle, Clock, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { elapsed } from "@/lib/format";

const stageOrder: { kind: StageKind; label: string }[] = [
  { kind: "research", label: "Research" },
  { kind: "plan", label: "Plan" },
  { kind: "plan_review", label: "Plan review" },
  { kind: "code", label: "Code" },
  { kind: "code_review", label: "Code review" },
  { kind: "pr", label: "Pull request" },
];

function StageIcon({ status }: { status: Stage["status"] }) {
  const cls = "size-4";
  if (status === "completed") return <Check className={cn(cls, "text-emerald-500")} />;
  if (status === "running") return <Loader2 className={cn(cls, "text-blue-500 animate-spin")} />;
  if (status === "failed") return <X className={cn(cls, "text-red-500")} />;
  if (status === "superseded") return <Circle className={cn(cls, "text-muted-foreground")} />;
  return <Clock className={cn(cls, "text-muted-foreground")} />;
}

export function StageTimeline({
  stages,
  selectedKind,
  onSelect,
}: {
  stages: Stage[];
  selectedKind: StageKind;
  onSelect: (kind: StageKind) => void;
}) {
  return (
    <ol className="flex flex-col">
      {stageOrder.map(({ kind, label }) => {
        const stage = stages.find((s) => s.kind === kind);
        const status = stage?.status ?? "pending";
        const selected = selectedKind === kind;
        return (
          <li key={kind}>
            <button
              type="button"
              onClick={() => onSelect(kind)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
            >
              <StageIcon status={status} />
              <span className="flex-1 truncate">{label}</span>
              {stage?.startedAt && (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {elapsed(stage.startedAt, stage.endedAt)}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Event, GateKind, RepoConfig, Run, Stage, StageKind } from "@yavin/protocol";
import { StatusPill } from "@/components/status-pill";
import { StageTimeline } from "@/components/stage-timeline";
import { EventStream } from "@/components/event-stream";
import { GateBar } from "@/components/gate-bar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { elapsed, formatCost } from "@/lib/format";
import { useRunSubscription } from "@/lib/useRunSubscription";

const GATE_FOR_STATUS: Partial<Record<Run["status"], GateKind>> = {
  awaiting_research_approval: "post_research",
  awaiting_plan_approval: "post_plan",
  awaiting_pr_approval: "pre_pr",
};

export function RunDetailClient({
  run: initialRun,
  repo,
  stages: initialStages,
  events: initialEvents,
}: {
  run: Run;
  repo: RepoConfig | null;
  stages: Stage[];
  events: Event[];
}) {
  const { run, stages, events, connected, send } = useRunSubscription({
    run: initialRun,
    stages: initialStages,
    events: initialEvents,
  });
  const [selected, setSelected] = useState<StageKind>(run.currentStage ?? "research");
  const stage = useMemo(() => stages.find((s) => s.kind === selected), [stages, selected]);
  const stageEvents = useMemo(
    () => events.filter((e) => !stage || e.stageId === stage.id || e.stageId === null),
    [events, stage],
  );
  const gate = GATE_FOR_STATUS[run.status];

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b px-6 py-4">
        <div className="text-muted-foreground flex items-center gap-2 font-mono text-xs">
          <span>{run.ticketId}</span>
          <span>·</span>
          <span>{repo?.name ?? "—"}</span>
          {run.branchName && (
            <>
              <span>·</span>
              <span>{run.branchName}</span>
            </>
          )}
          <span>·</span>
          <span className={connected ? "text-emerald-600" : "text-amber-600"}>
            {connected ? "live" : "offline"}
          </span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold">{run.ticketTitle ?? "Untitled"}</h1>
          <StatusPill status={run.status} />
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-3 text-xs">
          <span>elapsed {elapsed(run.createdAt, run.updatedAt)}</span>
          <span>cost {formatCost(run.costUsd)}</span>
          <span>by {run.createdBy.slice(0, 8)}</span>
          <a
            href={run.ticketUrl}
            target="_blank"
            rel="noreferrer"
            className="text-foreground/80 hover:text-foreground underline"
          >
            ticket ↗
          </a>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-12 divide-x">
        <aside className="col-span-3 overflow-y-auto p-3">
          <div className="text-muted-foreground px-3 pb-2 text-xs font-medium uppercase tracking-wider">
            Stages
          </div>
          <StageTimeline stages={stages} selectedKind={selected} onSelect={setSelected} />
        </aside>

        <section className="col-span-6 overflow-y-auto">
          <StageDetail stage={stage} />
        </section>

        <aside className="col-span-3 flex min-h-0 flex-col">
          <div className="text-muted-foreground border-b px-3 py-2 text-xs font-medium uppercase tracking-wider">
            Events
          </div>
          <div className="min-h-0 flex-1">
            <EventStream events={stageEvents} />
          </div>
        </aside>
      </div>

      {gate && (
        <GateBar
          gateKind={gate}
          onApprove={() =>
            send({ kind: "gate.decide", runId: run.id, gateKind: gate, decision: "approved" })
          }
          onReject={() =>
            send({ kind: "gate.decide", runId: run.id, gateKind: gate, decision: "rejected" })
          }
        />
      )}
    </div>
  );
}

function StageDetail({ stage }: { stage: Stage | undefined }) {
  if (!stage) {
    return (
      <div className="text-muted-foreground p-6 text-sm">Select a stage.</div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold capitalize">{stage.kind.replace("_", " ")}</h2>
        <Badge variant="outline" className="text-xs">
          attempt {stage.attempt}
        </Badge>
        <Badge variant="outline" className="text-xs capitalize">
          {stage.status}
        </Badge>
      </div>
      <Separator />
      <StageBody stage={stage} />
    </div>
  );
}

function StageBody({ stage }: { stage: Stage }) {
  if (stage.status === "pending") {
    return <p className="text-muted-foreground text-sm">Not started yet.</p>;
  }
  if (stage.status === "failed" && stage.errorText) {
    return (
      <pre className="bg-red-50 dark:bg-red-950/40 overflow-x-auto rounded-md p-3 text-xs text-red-700 dark:text-red-300">
        {stage.errorText}
      </pre>
    );
  }
  if (!stage.output) {
    return <p className="text-muted-foreground text-sm">In progress…</p>;
  }

  if (stage.kind === "research") {
    const out = stage.output as { brief: string; citations?: { url: string; title?: string }[] };
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{out.brief}</ReactMarkdown>
        {out.citations && out.citations.length > 0 && (
          <>
            <h3>Citations</h3>
            <ul>
              {out.citations.map((c) => (
                <li key={c.url}>
                  <a href={c.url}>{c.title ?? c.url}</a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  if (stage.kind === "plan") {
    const out = stage.output as {
      summary: string;
      steps: { title: string; description: string; files?: string[] }[];
    };
    return (
      <div className="space-y-4">
        <p className="text-sm">{out.summary}</p>
        <ol className="space-y-3">
          {out.steps.map((step, i) => (
            <li key={i} className="rounded-md border p-3">
              <div className="text-sm font-medium">
                {i + 1}. {step.title}
              </div>
              <p className="text-muted-foreground mt-1 text-sm">{step.description}</p>
              {step.files && step.files.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {step.files.map((f) => (
                    <Badge key={f} variant="secondary" className="font-mono text-[10px]">
                      {f}
                    </Badge>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <pre className="bg-muted/40 overflow-x-auto rounded-md p-3 text-xs">
      {JSON.stringify(stage.output, null, 2)}
    </pre>
  );
}

import { and, eq } from "drizzle-orm";
import type { GateDecision, GateKind, Run, RunStatus, StageKind } from "@cmhrabi/yavin-protocol";
import { db, schema } from "@/db/client";
import { publish } from "@/server/pubsub";
import { InvalidTransitionError, transitionStatus } from "@/server/runs";

const GATE_TO_STAGE: Record<GateKind, StageKind> = {
  post_research: "research",
  post_plan: "plan",
  pre_pr: "code_review",
};

export class GateStageNotFoundError extends Error {
  constructor(runId: string, gateKind: GateKind) {
    super(`stage not found for gate: run=${runId} gate=${gateKind}`);
  }
}

export class RegenerateNotSupportedError extends Error {
  constructor() {
    super("regenerate decision is not yet supported");
  }
}

function nextStatusForApproval(gateKind: GateKind): RunStatus {
  switch (gateKind) {
    case "post_research":
      return "planning";
    case "post_plan":
      return "coding";
    case "pre_pr":
      return "opening_pr";
  }
}

export interface RecordGateDecisionInput {
  runId: string;
  gateKind: GateKind;
  decision: GateDecision;
  feedbackText?: string;
  decidedBy: string;
}

export async function recordGateDecision(
  input: RecordGateDecisionInput,
): Promise<{ run: Run } | null> {
  if (input.decision === "regenerate") {
    console.warn(
      `[gates] regenerate decision deferred — no-op for run=${input.runId} gate=${input.gateKind}`,
    );
    return null;
  }

  const stageKind = GATE_TO_STAGE[input.gateKind];

  const run = await db.transaction(async (tx) => {
    const [stage] = await tx
      .select({ id: schema.stages.id })
      .from(schema.stages)
      .where(
        and(eq(schema.stages.runId, input.runId), eq(schema.stages.kind, stageKind)),
      )
      .limit(1);
    if (!stage) throw new GateStageNotFoundError(input.runId, input.gateKind);

    await tx.insert(schema.gateDecisions).values({
      runId: input.runId,
      stageId: stage.id,
      gateKind: input.gateKind,
      decision: input.decision,
      feedbackText: input.feedbackText ?? null,
      decidedBy: input.decidedBy,
    });

    const next: RunStatus =
      input.decision === "approved" ? nextStatusForApproval(input.gateKind) : "cancelled";

    try {
      return await transitionStatus(input.runId, next, tx);
    } catch (err) {
      if (err instanceof InvalidTransitionError) throw err;
      throw err;
    }
  });

  await publish({ runId: run.id, message: { kind: "run.updated", run } });
  return { run };
}

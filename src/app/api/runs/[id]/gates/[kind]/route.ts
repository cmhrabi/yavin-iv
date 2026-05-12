import { z } from "zod";
import {
  GATE_DECISIONS,
  GATE_KINDS,
  type GateDecision,
  type GateKind,
} from "@cmhrabi/yavin-protocol";
import { requireCaller } from "@/server/caller";
import { isRunOwnedBy, InvalidTransitionError } from "@/server/runs";
import {
  GateStageNotFoundError,
  recordGateDecision,
} from "@/server/gates";
import { workerClaims } from "@/server/ws";

const Body = z.object({
  decision: z.enum(GATE_DECISIONS as unknown as [string, ...string[]]),
  feedbackText: z.string().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; kind: string }> },
) {
  const caller = await requireCaller(req);
  if (caller instanceof Response) return caller;

  const { id, kind } = await ctx.params;
  if (!(GATE_KINDS as readonly string[]).includes(kind)) {
    return Response.json({ error: "invalid_gate_kind" }, { status: 400 });
  }
  const gateKind = kind as GateKind;

  const owned = await isRunOwnedBy(id, caller.userId);
  if (!owned) return new Response(null, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const decision = parsed.data.decision as GateDecision;

  try {
    const result = await recordGateDecision({
      runId: id,
      gateKind,
      decision,
      feedbackText: parsed.data.feedbackText,
      decidedBy: caller.userId,
    });
    if (!result) {
      return Response.json({ deferred: true }, { status: 202 });
    }
    const workerWs = workerClaims.get(id);
    if (workerWs && workerWs.readyState === workerWs.OPEN) {
      workerWs.send(
        JSON.stringify({
          kind: "gate.decided",
          runId: id,
          gateKind,
          decision,
          feedback: parsed.data.feedbackText,
        }),
      );
    }
    return Response.json({ run: result.run });
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return Response.json(
        { error: "invalid_transition", from: err.from, to: err.to },
        { status: 409 },
      );
    }
    if (err instanceof GateStageNotFoundError) {
      return Response.json({ error: "gate_stage_not_found" }, { status: 404 });
    }
    throw err;
  }
}

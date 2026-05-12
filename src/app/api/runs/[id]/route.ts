import { z } from "zod";
import { requireCaller } from "@/server/caller";
import { getRun, InvalidTransitionError, transitionStatus } from "@/server/runs";
import { publish } from "@/server/pubsub";
import { workerClaims } from "@/server/ws";

const PatchBody = z.object({
  status: z.literal("cancelled"),
});

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller(req);
  if (caller instanceof Response) return caller;
  const { id } = await ctx.params;
  const data = await getRun(id, caller.userId);
  if (!data) return new Response(null, { status: 404 });
  return Response.json(data);
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const caller = await requireCaller(req);
  if (caller instanceof Response) return caller;
  const { id } = await ctx.params;

  const existing = await getRun(id, caller.userId);
  if (!existing) return new Response(null, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const run = await transitionStatus(id, "cancelled");
    await publish({ runId: id, message: { kind: "run.updated", run } });
    const workerWs = workerClaims.get(id);
    if (workerWs && workerWs.readyState === workerWs.OPEN) {
      workerWs.send(JSON.stringify({ kind: "run.cancel", runId: id }));
    }
    return Response.json({ run });
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return Response.json(
        { error: "invalid_transition", from: err.from, to: err.to },
        { status: 409 },
      );
    }
    throw err;
  }
}

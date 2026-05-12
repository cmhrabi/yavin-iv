import { z } from "zod";
import { TICKET_PROVIDERS } from "@cmhrabi/yavin-protocol";
import { requireCaller } from "@/server/caller";
import {
  RepoConfigNotFoundError,
  createRun,
  listRuns,
} from "@/server/runs";
import { dispatchPendingRun } from "@/server/ws";

const CreateBody = z.object({
  repoConfigId: z.string().uuid(),
  ticketProvider: z.enum(TICKET_PROVIDERS as unknown as [string, ...string[]]),
  ticketId: z.string().trim().min(1),
  ticketUrl: z.string().trim().min(1),
  ticketTitle: z.string().trim().min(1),
  instructions: z.string().default(""),
});

export async function GET(req: Request) {
  const caller = await requireCaller(req);
  if (caller instanceof Response) return caller;
  const runs = await listRuns(caller.userId);
  return Response.json({ runs });
}

export async function POST(req: Request) {
  const caller = await requireCaller(req);
  if (caller instanceof Response) return caller;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const { run, stages } = await createRun(
      {
        repoConfigId: parsed.data.repoConfigId,
        ticketProvider: parsed.data.ticketProvider as (typeof TICKET_PROVIDERS)[number],
        ticketId: parsed.data.ticketId,
        ticketUrl: parsed.data.ticketUrl,
        ticketTitle: parsed.data.ticketTitle,
        instructions: parsed.data.instructions,
      },
      caller.userId,
    );

    // Fire-and-forget dispatch — if a worker is connected, this transitions
    // the run to `researching` and pushes `run.start`. If no worker is
    // available, the run stays `pending` and waits for `run.claim`.
    void dispatchPendingRun(run.id).catch((err) => {
      console.error(`[runs] dispatch failed run=${run.id}`, err);
    });

    return Response.json({ run, stages }, { status: 201 });
  } catch (err) {
    if (err instanceof RepoConfigNotFoundError) {
      return Response.json({ error: "repo_config_not_found" }, { status: 404 });
    }
    throw err;
  }
}

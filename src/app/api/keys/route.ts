import { z } from "zod";
import { requireCaller } from "@/server/caller";
import { createApiKey, listApiKeys } from "@/server/api-keys";

export async function GET(req: Request) {
  const caller = await requireCaller(req);
  if (caller instanceof Response) return caller;
  const keys = await listApiKeys(caller.userId);
  return Response.json({ keys });
}

const CreateBody = z.object({
  label: z.string().trim().min(1).max(64),
});

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
    const created = await createApiKey(caller.userId, parsed.data.label);
    return Response.json(created, { status: 201 });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      return Response.json({ error: "label_exists" }, { status: 409 });
    }
    throw err;
  }
}

import { requireCaller } from "@/server/caller";

export async function GET(req: Request) {
  const caller = await requireCaller(req);
  if (caller instanceof Response) return caller;
  return Response.json(caller);
}

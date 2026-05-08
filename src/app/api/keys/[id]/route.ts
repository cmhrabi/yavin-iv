import { requireCaller } from "@/server/caller";
import { revokeApiKey } from "@/server/api-keys";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await requireCaller(req);
  if (caller instanceof Response) return caller;

  const { id } = await params;
  const removed = await revokeApiKey(caller.userId, id);
  if (removed === 0) {
    // 404 (not 403) so we don't leak whether the key exists for someone else.
    return new Response(null, { status: 404 });
  }
  return new Response(null, { status: 204 });
}

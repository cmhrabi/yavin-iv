import { auth } from "@/server/auth";
import { verifyApiKey } from "@/server/api-keys";

export type Caller =
  | { kind: "user"; userId: string; email: string }
  | { kind: "apiKey"; userId: string; keyId: string; label: string };

function extractBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

export async function getCaller(req: Request): Promise<Caller | null> {
  const bearer = extractBearer(req);
  if (bearer) {
    const verified = await verifyApiKey(bearer);
    if (verified) {
      return {
        kind: "apiKey",
        userId: verified.userId,
        keyId: verified.keyId,
        label: verified.label,
      };
    }
    return null;
  }

  const session = await auth();
  if (session?.user?.id && session.user.email) {
    return { kind: "user", userId: session.user.id, email: session.user.email };
  }
  return null;
}

export async function requireCaller(req: Request): Promise<Caller | Response> {
  const caller = await getCaller(req);
  if (!caller) return new Response(null, { status: 401 });
  return caller;
}

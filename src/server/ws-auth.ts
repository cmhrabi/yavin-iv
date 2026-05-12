import type { IncomingMessage } from "node:http";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { verifyApiKey } from "@/server/api-keys";
import type { Caller } from "@/server/caller";

const SESSION_COOKIE_NAME =
  process.env.AUTH_URL?.startsWith("https://") || process.env.NODE_ENV === "production"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

function readCookie(rawCookieHeader: string | undefined, name: string): string | null {
  if (!rawCookieHeader) return null;
  for (const part of rawCookieHeader.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) === name) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

function parseUrl(req: IncomingMessage): URL {
  const host = req.headers.host ?? "localhost";
  return new URL(req.url ?? "/", `http://${host}`);
}

function extractBearer(req: IncomingMessage, url: URL): string | null {
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

export async function resolveCallerFromUpgrade(req: IncomingMessage): Promise<Caller | null> {
  const url = parseUrl(req);

  const token = extractBearer(req, url);
  if (token) {
    const verified = await verifyApiKey(token);
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

  const sessionToken = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  if (!sessionToken) return null;

  const [row] = await db
    .select({ userId: schema.users.id, email: schema.users.email })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.sessions.sessionToken, sessionToken),
        gt(schema.sessions.expires, new Date()),
      ),
    )
    .limit(1);

  if (!row || !row.email) return null;
  return { kind: "user", userId: row.userId, email: row.email };
}

export function parseUpgradeUrl(req: IncomingMessage): URL {
  return parseUrl(req);
}

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

const PREFIX_BYTES = 4; // 8 hex chars
const SECRET_BYTES = 24; // 32 url-safe base64 chars
const BCRYPT_COST = 10;

function generateSecretBase64Url(): string {
  return randomBytes(SECRET_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateApiKey(): { raw: string; prefix: string; secret: string } {
  const prefix = randomBytes(PREFIX_BYTES).toString("hex");
  const secret = generateSecretBase64Url();
  return { raw: `yvn_${prefix}_${secret}`, prefix, secret };
}

function parseRawKey(raw: string): { prefix: string; secret: string } | null {
  const parts = raw.split("_");
  if (parts.length !== 3) return null;
  const [scheme, prefix, secret] = parts;
  if (scheme !== "yvn" || prefix.length !== PREFIX_BYTES * 2 || secret.length === 0) {
    return null;
  }
  return { prefix, secret };
}

export interface ApiKeyRow {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function createApiKey(
  userId: string,
  label: string,
): Promise<{ id: string; label: string; key: string; keyPrefix: string }> {
  // Retry on prefix collision (vanishingly rare with 4B-bucket space).
  for (let attempt = 0; attempt < 3; attempt++) {
    const { raw, prefix, secret } = generateApiKey();
    const keyHash = await bcrypt.hash(secret, BCRYPT_COST);
    try {
      const [row] = await db
        .insert(schema.apiKeys)
        .values({ userId, label, keyPrefix: prefix, keyHash })
        .returning({ id: schema.apiKeys.id, label: schema.apiKeys.label });
      return { id: row.id, label: row.label, key: raw, keyPrefix: prefix };
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      // 23505 = unique_violation. Retry only if it's the prefix index — for
      // (userId,label) collisions surface to the caller.
      const message = String((err as Error)?.message ?? "");
      if (code === "23505" && message.includes("api_keys_key_prefix_idx")) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to mint API key after retries");
}

export async function listApiKeys(userId: string): Promise<ApiKeyRow[]> {
  const rows = await db
    .select({
      id: schema.apiKeys.id,
      label: schema.apiKeys.label,
      keyPrefix: schema.apiKeys.keyPrefix,
      createdAt: schema.apiKeys.createdAt,
      lastUsedAt: schema.apiKeys.lastUsedAt,
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.userId, userId));
  return rows;
}

export async function revokeApiKey(userId: string, keyId: string): Promise<number> {
  const deleted = await db
    .delete(schema.apiKeys)
    .where(and(eq(schema.apiKeys.userId, userId), eq(schema.apiKeys.id, keyId)))
    .returning({ id: schema.apiKeys.id });
  return deleted.length;
}

export interface VerifiedApiKey {
  userId: string;
  keyId: string;
  label: string;
}

export async function verifyApiKey(rawKey: string): Promise<VerifiedApiKey | null> {
  const parsed = parseRawKey(rawKey);
  if (!parsed) return null;

  const [row] = await db
    .select({
      id: schema.apiKeys.id,
      userId: schema.apiKeys.userId,
      label: schema.apiKeys.label,
      keyHash: schema.apiKeys.keyHash,
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.keyPrefix, parsed.prefix))
    .limit(1);

  if (!row) return null;

  const ok = await bcrypt.compare(parsed.secret, row.keyHash);
  if (!ok) return null;

  void db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, row.id))
    .catch(() => {
      // Best-effort; don't fail verification if the timestamp write fails.
    });

  return { userId: row.userId, keyId: row.id, label: row.label };
}

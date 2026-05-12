import postgres from "postgres";
import { sql } from "drizzle-orm";
import type { ServerToClient } from "@cmhrabi/yavin-protocol";
import { db } from "@/db/client";

const CHANNEL = "yavin_events";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://yavin:yavin@localhost:5432/yavin_iv";

export interface PubsubEvent {
  runId: string;
  message: ServerToClient;
}

type Listener = (event: PubsubEvent) => void;

const listeners = new Set<Listener>();

let listenClient: ReturnType<typeof postgres> | null = null;
let startPromise: Promise<void> | null = null;

function onPayload(raw: string): void {
  let parsed: PubsubEvent;
  try {
    parsed = JSON.parse(raw) as PubsubEvent;
  } catch (err) {
    console.error("[pubsub] failed to parse payload", err, raw.slice(0, 200));
    return;
  }
  if (!parsed || typeof parsed.runId !== "string" || !parsed.message) {
    console.error("[pubsub] dropping malformed payload", raw.slice(0, 200));
    return;
  }
  for (const fn of listeners) {
    try {
      fn(parsed);
    } catch (err) {
      console.error("[pubsub] listener threw", err);
    }
  }
}

export async function startPubsub(): Promise<void> {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    listenClient = postgres(connectionString, { max: 1 });
    await listenClient.listen(
      CHANNEL,
      onPayload,
      () => console.log(`[pubsub] listening on ${CHANNEL}`),
    );
  })();
  try {
    await startPromise;
  } catch (err) {
    startPromise = null;
    listenClient = null;
    throw err;
  }
}

export async function stopPubsub(): Promise<void> {
  listeners.clear();
  const client = listenClient;
  listenClient = null;
  startPromise = null;
  if (client) {
    await client.end({ timeout: 5 });
  }
}

export async function publish(event: PubsubEvent): Promise<void> {
  const payload = JSON.stringify(event);
  await db.execute(sql`select pg_notify(${CHANNEL}, ${payload})`);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

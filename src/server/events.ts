import { eq, sql } from "drizzle-orm";
import type { Event, EventInput } from "@cmhrabi/yavin-protocol";
import { db, schema } from "@/db/client";
import { publish } from "@/server/pubsub";

export async function appendEvent(input: EventInput): Promise<Event> {
  const event = await db.transaction(async (tx) => {
    // Serialize per-run seq allocation via an advisory transaction lock —
    // `select max ... for update` is invalid with aggregates, and we want
    // sub-millisecond locking without a separate counter table.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.runId}))`);
    const rows = (await tx.execute(
      sql`select coalesce(max(seq), 0) + 1 as next_seq from ${schema.events} where ${schema.events.runId} = ${input.runId}`,
    )) as unknown as Array<{ next_seq: string | number }>;
    const seqValue = Number(rows[0]?.next_seq ?? 1);
    const [row] = await tx
      .insert(schema.events)
      .values({
        runId: input.runId,
        stageId: input.stageId,
        seq: BigInt(seqValue),
        kind: input.kind,
        payload: input.payload ?? {},
      })
      .returning();
    return {
      id: row.id.toString(),
      runId: row.runId,
      stageId: row.stageId,
      seq: Number(row.seq),
      kind: row.kind,
      payload: row.payload,
      createdAt: row.createdAt.toISOString(),
    } satisfies Event;
  });

  await publish({
    runId: event.runId,
    message: { kind: "event.appended", event },
  });

  return event;
}

export async function listEventsForRun(runId: string): Promise<Event[]> {
  const rows = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.runId, runId));
  return rows.map((row) => ({
    id: row.id.toString(),
    runId: row.runId,
    stageId: row.stageId,
    seq: Number(row.seq),
    kind: row.kind,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  }));
}

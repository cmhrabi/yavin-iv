import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  canTransition,
  STAGE_KINDS,
  type Run,
  type RunStatus,
  type Stage,
  type StageKind,
  type StageStatus,
  type TicketProvider,
} from "@cmhrabi/yavin-protocol";
import { db, schema } from "@/db/client";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbExecutor = typeof db | Tx;

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: RunStatus,
    public readonly to: RunStatus,
  ) {
    super(`invalid run status transition: ${from} -> ${to}`);
  }
}

export class RepoConfigNotFoundError extends Error {
  constructor(public readonly repoConfigId: string) {
    super(`repo config not found: ${repoConfigId}`);
  }
}

type RunRow = typeof schema.runs.$inferSelect;
type StageRow = typeof schema.stages.$inferSelect;

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    repoConfigId: row.repoConfigId,
    ticketProvider: row.ticketProvider as TicketProvider,
    ticketId: row.ticketId,
    ticketUrl: row.ticketUrl,
    ticketTitle: row.ticketTitle ?? undefined,
    instructions: row.instructions,
    branchName: row.branchName,
    worktreePath: row.worktreePath,
    status: row.status as RunStatus,
    currentStage: (row.currentStage as StageKind | null) ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toStage(row: StageRow): Stage {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind as StageKind,
    status: row.status as StageStatus,
    attempt: row.attempt,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    output: row.output,
    errorText: row.errorText,
  };
}

export interface CreateRunInput {
  repoConfigId: string;
  ticketProvider: TicketProvider;
  ticketId: string;
  ticketUrl: string;
  ticketTitle: string;
  instructions: string;
}

export async function createRun(
  input: CreateRunInput,
  callerUserId: string,
): Promise<{ run: Run; stages: Stage[] }> {
  return db.transaction(async (tx) => {
    const [repo] = await tx
      .select({ id: schema.repoConfigs.id })
      .from(schema.repoConfigs)
      .where(eq(schema.repoConfigs.id, input.repoConfigId))
      .limit(1);
    if (!repo) throw new RepoConfigNotFoundError(input.repoConfigId);

    const [runRow] = await tx
      .insert(schema.runs)
      .values({
        repoConfigId: input.repoConfigId,
        ticketProvider: input.ticketProvider,
        ticketId: input.ticketId,
        ticketUrl: input.ticketUrl,
        ticketTitle: input.ticketTitle,
        instructions: input.instructions,
        status: "pending",
        createdBy: callerUserId,
      })
      .returning();

    const stageValues = STAGE_KINDS.map((kind) => ({
      runId: runRow.id,
      kind,
      status: "pending" as const,
    }));
    const stageRows = await tx.insert(schema.stages).values(stageValues).returning();

    return { run: toRun(runRow), stages: stageRows.map(toStage) };
  });
}

export async function getRun(
  runId: string,
  callerUserId: string,
): Promise<{
  run: Run;
  stages: Stage[];
  events: import("@cmhrabi/yavin-protocol").Event[];
} | null> {
  const [runRow] = await db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.id, runId), eq(schema.runs.createdBy, callerUserId)))
    .limit(1);
  if (!runRow) return null;

  const stageRows = await db
    .select()
    .from(schema.stages)
    .where(eq(schema.stages.runId, runId))
    .orderBy(asc(schema.stages.kind));

  const eventRows = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.runId, runId))
    .orderBy(asc(schema.events.seq));

  return {
    run: toRun(runRow),
    stages: stageRows.map(toStage),
    events: eventRows.map((e) => ({
      id: e.id.toString(),
      runId: e.runId,
      stageId: e.stageId,
      seq: Number(e.seq),
      kind: e.kind,
      payload: e.payload,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

export async function listRuns(callerUserId: string): Promise<Run[]> {
  const rows = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.createdBy, callerUserId))
    .orderBy(desc(schema.runs.createdAt));
  return rows.map(toRun);
}

export async function isRunOwnedBy(
  runId: string,
  callerUserId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.id, runId), eq(schema.runs.createdBy, callerUserId)))
    .limit(1);
  return !!row;
}

export async function filterOwnedRunIds(
  runIds: string[],
  callerUserId: string,
): Promise<string[]> {
  if (runIds.length === 0) return [];
  const rows = await db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(inArray(schema.runs.id, runIds), eq(schema.runs.createdBy, callerUserId)));
  return rows.map((r) => r.id);
}

export async function claimRun(
  runId: string,
  executor: DbExecutor = db,
): Promise<Run | null> {
  return (executor as typeof db).transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .for("update")
      .limit(1);
    if (!current) return null;
    if (!canTransition(current.status as RunStatus, "researching")) {
      throw new InvalidTransitionError(current.status as RunStatus, "researching");
    }
    const [updated] = await tx
      .update(schema.runs)
      .set({ status: "researching", currentStage: "research", updatedAt: new Date() })
      .where(eq(schema.runs.id, runId))
      .returning();
    return toRun(updated);
  });
}

export async function transitionStatus(
  runId: string,
  next: RunStatus,
  executor: DbExecutor = db,
  patch: Partial<{ currentStage: StageKind | null }> = {},
): Promise<Run> {
  return (executor as typeof db).transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .for("update")
      .limit(1);
    if (!current) throw new Error(`run not found: ${runId}`);
    const from = current.status as RunStatus;
    if (from === next) {
      return toRun(current);
    }
    if (!canTransition(from, next)) {
      throw new InvalidTransitionError(from, next);
    }
    const [updated] = await tx
      .update(schema.runs)
      .set({ status: next, updatedAt: new Date(), ...patch })
      .where(eq(schema.runs.id, runId))
      .returning();
    return toRun(updated);
  });
}

export interface StageUpdatePatch {
  status?: StageStatus;
  startedAt?: Date | null;
  endedAt?: Date | null;
  output?: unknown;
  errorText?: string | null;
}

export async function updateStage(
  runId: string,
  kind: StageKind,
  patch: StageUpdatePatch,
  executor: DbExecutor = db,
): Promise<Stage> {
  const set: Record<string, unknown> = {};
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.startedAt !== undefined) set.startedAt = patch.startedAt;
  if (patch.endedAt !== undefined) set.endedAt = patch.endedAt;
  if (patch.output !== undefined) set.output = patch.output;
  if (patch.errorText !== undefined) set.errorText = patch.errorText;

  const [updated] = await (executor as typeof db)
    .update(schema.stages)
    .set(set)
    .where(and(eq(schema.stages.runId, runId), eq(schema.stages.kind, kind)))
    .returning();
  if (!updated) throw new Error(`stage not found: run=${runId} kind=${kind}`);
  return toStage(updated);
}

export async function getStageByKind(
  runId: string,
  kind: StageKind,
  executor: DbExecutor = db,
): Promise<Stage | null> {
  const [row] = await (executor as typeof db)
    .select()
    .from(schema.stages)
    .where(and(eq(schema.stages.runId, runId), eq(schema.stages.kind, kind)))
    .limit(1);
  return row ? toStage(row) : null;
}

export async function getRunById(runId: string): Promise<Run | null> {
  const [row] = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
    .limit(1);
  return row ? toRun(row) : null;
}

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

// Integration test: uses the live `yavin_iv` DB (set DATABASE_URL to point
// elsewhere). Each test seeds its own user + repo and cleans up after.
// We avoid a per-schema sandbox because the existing migration creates
// enums in `public` and FK-references `public.users` — those would conflict
// or break with a separate test schema.

const createdRunIds: string[] = [];
const createdUserIds: string[] = [];
const createdRepoIds: string[] = [];

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgres://yavin:yavin@localhost:5432/yavin_iv";
  }
});

afterAll(async () => {
  const { db, schema } = await import("@/db/client");
  if (createdRunIds.length > 0) {
    await db.delete(schema.runs).where(inArray(schema.runs.id, createdRunIds));
  }
  if (createdRepoIds.length > 0) {
    await db
      .delete(schema.repoConfigs)
      .where(inArray(schema.repoConfigs.id, createdRepoIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  }
});

describe("runs service", () => {
  it("create → list → claim → events → gate decision", async () => {
    const { db, schema } = await import("@/db/client");
    const runs = await import("@/server/runs");
    const events = await import("@/server/events");
    const gates = await import("@/server/gates");

    const tag = `test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

    const [userRow] = await db
      .insert(schema.users)
      .values({ email: `${tag}@example.com`, name: "test user" })
      .returning();
    createdUserIds.push(userRow.id);

    const [repoRow] = await db
      .insert(schema.repoConfigs)
      .values({
        name: `repo-${tag}`,
        repoPath: `/tmp/${tag}`,
        githubRepo: `kablamo/${tag}`,
      })
      .returning();
    createdRepoIds.push(repoRow.id);

    // createRun
    const { run, stages } = await runs.createRun(
      {
        repoConfigId: repoRow.id,
        ticketProvider: "linear",
        ticketId: `TEST-${tag}`,
        ticketUrl: `https://example.com/${tag}`,
        ticketTitle: "Test ticket",
        instructions: "Be thorough.",
      },
      userRow.id,
    );
    createdRunIds.push(run.id);

    expect(run.status).toBe("pending");
    expect(run.ticketTitle).toBe("Test ticket");
    expect(stages).toHaveLength(6);
    expect(stages.every((s) => s.status === "pending")).toBe(true);

    // listRuns scoped to caller
    const listed = await runs.listRuns(userRow.id);
    expect(listed.some((r) => r.id === run.id)).toBe(true);

    // Cross-user isolation
    const [otherUser] = await db
      .insert(schema.users)
      .values({ email: `other-${tag}@example.com` })
      .returning();
    createdUserIds.push(otherUser.id);

    const otherList = await runs.listRuns(otherUser.id);
    expect(otherList.find((r) => r.id === run.id)).toBeUndefined();
    const otherGet = await runs.getRun(run.id, otherUser.id);
    expect(otherGet).toBeNull();

    // claimRun
    const claimed = await runs.claimRun(run.id);
    expect(claimed?.status).toBe("researching");
    expect(claimed?.currentStage).toBe("research");

    // appendEvent allocates seq
    const researchStage = stages.find((s) => s.kind === "research");
    const e1 = await events.appendEvent({
      runId: run.id,
      stageId: researchStage?.id ?? null,
      kind: "log",
      payload: { message: "first" },
    });
    const e2 = await events.appendEvent({
      runId: run.id,
      stageId: researchStage?.id ?? null,
      kind: "log",
      payload: { message: "second" },
    });
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);

    // Worker reports gate.await → transition to awaiting
    const awaiting = await runs.transitionStatus(run.id, "awaiting_research_approval");
    expect(awaiting.status).toBe("awaiting_research_approval");

    // recordGateDecision(approved, post_research) → planning
    const result = await gates.recordGateDecision({
      runId: run.id,
      gateKind: "post_research",
      decision: "approved",
      decidedBy: userRow.id,
    });
    expect(result?.run.status).toBe("planning");

    const decisions = await db
      .select()
      .from(schema.gateDecisions)
      .where(eq(schema.gateDecisions.runId, run.id));
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decidedBy).toBe(userRow.id);
    expect(decisions[0].decision).toBe("approved");
  });
});

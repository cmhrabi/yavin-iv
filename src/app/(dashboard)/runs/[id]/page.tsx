import { notFound, redirect } from "next/navigation";
import type { RepoConfig, TicketProvider } from "@cmhrabi/yavin-protocol";
import { eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { getRun } from "@/server/runs";
import { db, schema } from "@/db/client";
import { RunDetailClient } from "./run-detail-client";

async function loadRepo(repoConfigId: string): Promise<RepoConfig | null> {
  const [row] = await db
    .select()
    .from(schema.repoConfigs)
    .where(eq(schema.repoConfigs.id, repoConfigId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    repoPath: row.repoPath,
    baseBranch: row.baseBranch,
    branchPrefix: row.branchPrefix,
    concurrencyLimit: row.concurrencyLimit,
    ticketProviders: Array.isArray(row.ticketProviders)
      ? (row.ticketProviders as TicketProvider[])
      : [],
    githubRepo: row.githubRepo,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");

  const { id } = await params;
  const data = await getRun(id, session.user.id);
  if (!data) notFound();

  const repo = await loadRepo(data.run.repoConfigId);

  return (
    <RunDetailClient
      run={data.run}
      repo={repo}
      stages={data.stages}
      events={data.events}
    />
  );
}

import { redirect } from "next/navigation";
import type { RepoConfig, TicketProvider } from "@cmhrabi/yavin-protocol";
import { RunCard } from "@/components/run-card";
import { NewRunButton } from "@/components/new-run-dialog";
import { Button } from "@/components/ui/button";
import { auth } from "@/server/auth";
import { listRuns } from "@/server/runs";
import { db, schema } from "@/db/client";

const FILTERS = ["All", "Active", "Awaiting review", "Completed", "Failed"] as const;

async function listRepoConfigs(): Promise<RepoConfig[]> {
  const rows = await db.select().from(schema.repoConfigs);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    repoPath: r.repoPath,
    baseBranch: r.baseBranch,
    branchPrefix: r.branchPrefix,
    concurrencyLimit: r.concurrencyLimit,
    ticketProviders: Array.isArray(r.ticketProviders)
      ? (r.ticketProviders as TicketProvider[])
      : [],
    githubRepo: r.githubRepo,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export default async function RunsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");

  const [runs, repos] = await Promise.all([
    listRuns(session.user.id),
    listRepoConfigs(),
  ]);

  const reposById = new Map(repos.map((r) => [r.id, r]));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Runs</h1>
          <p className="text-muted-foreground text-sm">
            {runs.length} runs across {repos.length} repos
          </p>
        </div>
        <NewRunButton repos={repos} />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f, i) => (
          <Button
            key={f}
            variant={i === 0 ? "default" : "outline"}
            size="sm"
            className="rounded-full"
          >
            {f}
          </Button>
        ))}
      </div>

      {runs.length === 0 ? (
        <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
          No runs yet. Click <span className="font-medium">New run</span> to kick one off.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} repo={reposById.get(run.repoConfigId)} />
          ))}
        </div>
      )}
    </div>
  );
}

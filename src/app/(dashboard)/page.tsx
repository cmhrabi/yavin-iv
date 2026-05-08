import { RunCard } from "@/components/run-card";
import { Button } from "@/components/ui/button";
import { MOCK_RUNS, MOCK_REPOS, repoForId } from "@/lib/mock-data";

const FILTERS = ["All", "Active", "Awaiting review", "Completed", "Failed"] as const;

export default function RunsPage() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Runs</h1>
          <p className="text-muted-foreground text-sm">
            {MOCK_RUNS.length} runs across {MOCK_REPOS.length} repos
          </p>
        </div>
        <Button>New run</Button>
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {MOCK_RUNS.map((run) => (
          <RunCard key={run.id} run={run} repo={repoForId(run.repoConfigId)} />
        ))}
      </div>
    </div>
  );
}

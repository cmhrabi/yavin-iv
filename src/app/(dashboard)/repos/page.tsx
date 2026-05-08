import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MOCK_REPOS } from "@/lib/mock-data";
import { relativeTime } from "@/lib/format";

export default function ReposPage() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Repos</h1>
          <p className="text-muted-foreground text-sm">
            Configured repositories rogue-one can run against
          </p>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button>Add repo</Button>
          </DialogTrigger>
          <AddRepoDialog />
        </Dialog>
      </div>

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Path</th>
              <th className="px-4 py-2 font-medium">Base</th>
              <th className="px-4 py-2 font-medium">Concurrency</th>
              <th className="px-4 py-2 font-medium">Providers</th>
              <th className="px-4 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {MOCK_REPOS.map((r) => (
              <tr key={r.id} className="hover:bg-accent/40">
                <td className="px-4 py-2 font-medium">{r.name}</td>
                <td className="text-muted-foreground px-4 py-2 font-mono text-xs">
                  {r.repoPath}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{r.baseBranch}</td>
                <td className="px-4 py-2 tabular-nums">{r.concurrencyLimit}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {r.ticketProviders.map((p) => (
                      <Badge key={p} variant="secondary" className="text-[10px]">
                        {p}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="text-muted-foreground px-4 py-2 text-xs">
                  {relativeTime(r.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddRepoDialog() {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add repo</DialogTitle>
        <DialogDescription>
          Configure a new repository for rogue-one to operate on.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <Field label="Display name" placeholder="yavin-iv" />
        <Field label="Repo path" placeholder="/Users/you/code/your-repo" mono />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Base branch" placeholder="main" mono />
          <Field label="Branch prefix" placeholder="rogue-one/" mono />
        </div>
        <Field label="GitHub repo" placeholder="owner/repo" mono />
        <Field label="Concurrency limit" placeholder="1" />
      </div>
      <DialogFooter>
        <Button variant="outline">Cancel</Button>
        <Button>Add repo</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({
  label,
  placeholder,
  mono,
}: {
  label: string;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      <Input placeholder={placeholder} className={mono ? "font-mono text-xs" : undefined} />
    </label>
  );
}

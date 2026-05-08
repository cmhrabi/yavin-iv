import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { MOCK_API_KEYS } from "@/lib/mock-data";
import { relativeTime } from "@/lib/format";

export default function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm">
          API keys, model defaults, and gate enable/disable toggles
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">API keys</h2>
          <Button size="sm">New key</Button>
        </div>
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 font-medium">Label</th>
                <th className="px-4 py-2 font-medium">Key</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Last used</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {MOCK_API_KEYS.map((k) => (
                <tr key={k.id}>
                  <td className="px-4 py-2 font-medium">{k.label}</td>
                  <td className="px-4 py-2 font-mono text-xs">{k.prefix}</td>
                  <td className="text-muted-foreground px-4 py-2 text-xs">
                    {relativeTime(k.createdAt)}
                  </td>
                  <td className="text-muted-foreground px-4 py-2 text-xs">
                    {k.lastUsedAt ? relativeTime(k.lastUsedAt) : "never"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="ghost">
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Defaults</h2>
        <div className="grid max-w-md grid-cols-1 gap-3">
          <label className="space-y-1">
            <span className="text-xs font-medium">Default research model</span>
            <Input defaultValue="claude-sonnet-4-6" className="font-mono text-xs" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">Default coding model</span>
            <Input defaultValue="claude-opus-4-7" className="font-mono text-xs" />
          </label>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Gates</h2>
        <p className="text-muted-foreground text-xs">
          All three gates are enforced for the MVP regardless of the toggles below.
        </p>
        <ul className="space-y-2 text-sm">
          <li>Post-research gate: <span className="text-muted-foreground">enabled</span></li>
          <li>Post-plan gate: <span className="text-muted-foreground">enabled</span></li>
          <li>Pre-PR gate: <span className="text-muted-foreground">enabled</span></li>
        </ul>
      </section>
    </div>
  );
}

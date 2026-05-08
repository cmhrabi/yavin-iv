import { redirect } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/server/auth";
import { listApiKeys } from "@/server/api-keys";
import { ApiKeysSection } from "./_components/api-keys-section";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const keys = await listApiKeys(session.user.id);
  const initial = keys.map((k) => ({
    id: k.id,
    label: k.label,
    keyPrefix: k.keyPrefix,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
  }));

  return (
    <div className="max-w-3xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm">
          API keys, model defaults, and gate enable/disable toggles
        </p>
      </div>

      <ApiKeysSection initial={initial} />

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

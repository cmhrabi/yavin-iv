"use client";

import { useState, useTransition } from "react";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/lib/format";

export interface ApiKeyView {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

type Stage =
  | { kind: "idle" }
  | { kind: "form"; submitting: boolean; error: string | null }
  | { kind: "reveal"; raw: string; label: string };

export function ApiKeysSection({ initial }: { initial: ApiKeyView[] }) {
  const [keys, setKeys] = useState<ApiKeyView[]>(initial);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [label, setLabel] = useState("");
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  function openDialog() {
    setLabel("");
    setCopied(false);
    setStage({ kind: "form", submitting: false, error: null });
  }

  function closeDialog() {
    setStage({ kind: "idle" });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (stage.kind !== "form") return;
    setStage({ kind: "form", submitting: true, error: null });
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setStage({
          kind: "form",
          submitting: false,
          error: body?.error === "label_exists" ? "A key with that label already exists." : "Could not create key.",
        });
        return;
      }
      const created = (await res.json()) as {
        id: string;
        label: string;
        key: string;
        keyPrefix: string;
      };
      setKeys((prev) => [
        ...prev,
        {
          id: created.id,
          label: created.label,
          keyPrefix: created.keyPrefix,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
        },
      ]);
      setStage({ kind: "reveal", raw: created.key, label: created.label });
    } catch {
      setStage({ kind: "form", submitting: false, error: "Network error." });
    }
  }

  async function copyRaw() {
    if (stage.kind !== "reveal") return;
    try {
      await navigator.clipboard.writeText(stage.raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function revoke(id: string) {
    if (!confirm("Revoke this key? Any client using it will stop working.")) return;
    const previous = keys;
    setKeys((prev) => prev.filter((k) => k.id !== id));
    startTransition(async () => {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        setKeys(previous);
        alert("Could not revoke key. Please try again.");
      }
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">API keys</h2>
        <Button size="sm" onClick={openDialog}>
          New key
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Label</TableHead>
              <TableHead className="px-4">Key</TableHead>
              <TableHead className="px-4">Created</TableHead>
              <TableHead className="px-4">Last used</TableHead>
              <TableHead className="px-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground px-4 py-6 text-center text-xs">
                  No keys yet. Click <span className="font-medium">New key</span> to mint one.
                </TableCell>
              </TableRow>
            ) : (
              keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="px-4 font-medium">{k.label}</TableCell>
                  <TableCell className="px-4 font-mono text-xs">yvn_{k.keyPrefix}_…</TableCell>
                  <TableCell className="text-muted-foreground px-4 text-xs">
                    {relativeTime(k.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground px-4 text-xs">
                    {k.lastUsedAt ? relativeTime(k.lastUsedAt) : "never"}
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => revoke(k.id)}
                      aria-label={`Revoke ${k.label}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={stage.kind !== "idle"}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent showCloseButton={stage.kind !== "reveal"}>
          {stage.kind === "form" && (
            <form onSubmit={handleCreate} className="space-y-4">
              <DialogHeader>
                <DialogTitle>New API key</DialogTitle>
                <DialogDescription>
                  Pick a label that helps you remember which machine or workflow uses this key.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="api-key-label">Label</Label>
                <Input
                  id="api-key-label"
                  autoFocus
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="laptop"
                  maxLength={64}
                  required
                />
                {stage.error ? (
                  <p className="text-destructive text-xs">{stage.error}</p>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDialog}
                  disabled={stage.submitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={stage.submitting || label.trim().length === 0}>
                  {stage.submitting ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          )}

          {stage.kind === "reveal" && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>Copy your key</DialogTitle>
                <DialogDescription>
                  This is the only time we&apos;ll show <span className="font-mono">{stage.label}</span>&apos;s
                  full key. Save it somewhere safe.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={stage.raw}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" size="sm" onClick={copyRaw}>
                  <Copy className="size-4" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-destructive text-xs font-semibold">
                You will not see this key again.
              </p>
              <DialogFooter>
                <Button type="button" onClick={closeDialog}>
                  I&apos;ve saved it
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

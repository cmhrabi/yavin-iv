"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RepoConfig, TicketProvider } from "@yavin/protocol";
import { TICKET_PROVIDERS } from "@yavin/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function NewRunButton({ repos }: { repos: RepoConfig[] }) {
  const [open, setOpen] = useState(false);
  const disabled = repos.length === 0;
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled}>
        New run
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <NewRunDialog repos={repos} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewRunDialog({
  repos,
  onClose,
}: {
  repos: RepoConfig[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    repoConfigId: repos[0]?.id ?? "",
    ticketProvider: (repos[0]?.ticketProviders[0] ??
      TICKET_PROVIDERS[0]) as TicketProvider,
    ticketId: "",
    ticketUrl: "",
    ticketTitle: "",
    instructions: "",
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `request failed (${res.status})`);
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>New run</DialogTitle>
        <DialogDescription>
          Kick off rogue-one against a configured repo and ticket.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium">Repo</span>
          <select
            value={form.repoConfigId}
            onChange={(e) => update("repoConfigId", e.target.value)}
            className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
            required
          >
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Ticket provider</span>
          <select
            value={form.ticketProvider}
            onChange={(e) => update("ticketProvider", e.target.value as TicketProvider)}
            className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
          >
            {TICKET_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Ticket ID</span>
            <Input
              value={form.ticketId}
              onChange={(e) => update("ticketId", e.target.value)}
              placeholder="ENG-482"
              className="font-mono text-xs"
              required
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Ticket URL</span>
            <Input
              value={form.ticketUrl}
              onChange={(e) => update("ticketUrl", e.target.value)}
              placeholder="https://…"
              className="font-mono text-xs"
              required
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Ticket title</span>
          <Input
            value={form.ticketTitle}
            onChange={(e) => update("ticketTitle", e.target.value)}
            placeholder="Short ticket summary"
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Instructions</span>
          <Textarea
            value={form.instructions}
            onChange={(e) => update("instructions", e.target.value)}
            rows={4}
            placeholder="Anything else rogue-one should know."
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create run"}
        </Button>
      </DialogFooter>
    </form>
  );
}

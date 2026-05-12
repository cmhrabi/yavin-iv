"use client";

import { useState } from "react";
import type { GateKind } from "@yavin/protocol";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const labels: Record<GateKind, string> = {
  post_research: "Approve research brief",
  post_plan: "Approve plan",
  pre_pr: "Approve PR",
};

export interface GateBarProps {
  gateKind: GateKind;
  onApprove?: () => void;
  onReject?: () => void;
  onRegenerate?: (feedback: string) => void;
}

export function GateBar({ gateKind, onApprove, onReject, onRegenerate }: GateBarProps) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  function submitRegenerate() {
    if (onRegenerate) onRegenerate(feedback);
    else console.warn("[gate-bar] regenerate not yet wired", { gateKind, feedback });
    setOpen(false);
    setFeedback("");
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-950/40 sticky bottom-0 flex items-center justify-between gap-3 border-t px-6 py-3">
      <div className="text-sm">
        <span className="font-medium">Gate decision required:</span>{" "}
        <span className="text-muted-foreground">{labels[gateKind]}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onReject}>
          Reject
        </Button>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Regenerate with feedback
        </Button>
        <Button size="sm" onClick={onApprove}>
          Approve
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate with feedback</DialogTitle>
            <DialogDescription>
              Tell rogue-one what to change. The current stage will be marked
              superseded and a new attempt will start.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={6}
            placeholder="What should be different?"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitRegenerate}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { Event } from "@yavin/protocol";
import { ChevronRight, Hammer, MessageSquare, ScrollText, Wrench } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";

const ICONS: Record<string, typeof Hammer> = {
  tool_call: Wrench,
  tool_result: Hammer,
  message: MessageSquare,
  log: ScrollText,
};

function summary(e: Event): string {
  const p = e.payload as Record<string, unknown> | null;
  if (!p) return e.kind;
  if (e.kind === "tool_call" && typeof p.name === "string") return `tool: ${p.name}`;
  if (e.kind === "tool_result" && typeof p.name === "string")
    return `result: ${p.name}${p.ok === false ? " (failed)" : ""}`;
  if (e.kind === "message" && typeof p.text === "string") return p.text;
  if (e.kind === "log" && typeof p.message === "string") return p.message;
  return e.kind;
}

export function EventStream({ events }: { events: Event[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <ScrollArea className="h-full">
      <ol className="flex flex-col">
        {events.map((e) => {
          const Icon = ICONS[e.kind] ?? ScrollText;
          const isExpanded = expanded === e.id;
          return (
            <li key={e.id} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : e.id)}
                className="hover:bg-accent/40 flex w-full items-start gap-2 px-3 py-2 text-left text-xs"
              >
                <ChevronRight
                  className={cn(
                    "text-muted-foreground mt-0.5 size-3 shrink-0 transition-transform",
                    isExpanded && "rotate-90",
                  )}
                />
                <Icon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{summary(e)}</div>
                  <div className="text-muted-foreground mt-0.5 text-[10px]">
                    #{e.seq} · {relativeTime(e.createdAt)}
                  </div>
                </div>
              </button>
              {isExpanded && (
                <pre className="bg-muted/40 overflow-x-auto px-3 pb-3 pt-0 text-[10px] leading-relaxed">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              )}
            </li>
          );
        })}
      </ol>
    </ScrollArea>
  );
}

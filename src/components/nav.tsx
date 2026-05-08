"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, GitBranch, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Runs", icon: Activity, match: (p: string) => p === "/" || p.startsWith("/runs") },
  { href: "/repos", label: "Repos", icon: GitBranch, match: (p: string) => p.startsWith("/repos") },
  { href: "/settings", label: "Settings", icon: Settings, match: (p: string) => p.startsWith("/settings") },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-3">
      {items.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

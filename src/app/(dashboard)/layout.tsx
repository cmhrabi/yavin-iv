import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { UserMenu } from "@/components/user-menu";
import { auth } from "@/server/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/api/auth/signin");
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="bg-sidebar text-sidebar-foreground w-56 shrink-0 border-r">
        <div className="flex h-14 items-center border-b px-4">
          <span className="font-mono text-sm font-semibold tracking-tight">
            yavin-iv
          </span>
        </div>
        <Nav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
          <span className="text-muted-foreground text-sm">
            Dashboard for AI-driven SDLC runs
          </span>
          <UserMenu email={session.user.email} />
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

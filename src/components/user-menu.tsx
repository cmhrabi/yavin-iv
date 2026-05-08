import { signOut } from "@/server/auth";
import { Button } from "@/components/ui/button";

export function UserMenu({ email }: { email: string }) {
  const initial = email.slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <div className="bg-muted text-muted-foreground flex size-7 items-center justify-center rounded-full text-xs font-medium">
        {initial}
      </div>
      <span className="text-muted-foreground font-mono text-xs">{email}</span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/api/auth/signin" });
        }}
      >
        <Button type="submit" variant="outline" size="sm">
          Sign out
        </Button>
      </form>
    </div>
  );
}

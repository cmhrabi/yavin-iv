import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db, schema } from "@/db/client";

function parseAllowedEmails(): Set<string> {
  const raw = process.env.AUTH_ALLOWED_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "database" },
  callbacks: {
    signIn({ user }) {
      const allowed = parseAllowedEmails();
      if (allowed.size === 0) return true;
      const email = user.email?.toLowerCase();
      return !!email && allowed.has(email);
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});

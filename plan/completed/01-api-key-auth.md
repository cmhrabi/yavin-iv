# Todo 1 — Auth.js + user-owned API keys (built)

What landed when this todo was implemented. Maps to §3 (Auth) and §7 (REST
API) of [`../implementation-plan.md`](../implementation-plan.md). The
original spec lives in this file's git history and in
[`phase-1-foundations.md`](./phase-1-foundations.md)'s "out of scope" list.

## Outcome

Two flows mapped onto one `Caller` context:

```ts
type Caller =
  | { kind: "user";   userId: string; email: string }
  | { kind: "apiKey"; userId: string; keyId: string; label: string };
```

- **Browser → dashboard**: Auth.js v5 session cookies, GitHub OAuth, DB
  session strategy, allowlist gate via `AUTH_ALLOWED_EMAILS`.
- **rogue-one → dashboard**: `Authorization: Bearer yvn_<prefix>_<secret>`
  on REST. The same `verifyApiKey(rawKey)` helper is what todo 2's WS
  upgrade handler will call against `?token=...`.

`/api/health` stays public; `/api/whoami` is the smoke test for both flows.

## Files added / changed

```
src/
├── db/
│   ├── schema.ts                            # mutated: see "DB shape" below
│   └── migrations/0000_plain_angel.sql      # squashed (Phase 1 had not shipped real data)
├── server/                                  # new directory
│   ├── auth.ts                              # NextAuth({adapter, providers, callbacks})
│   ├── api-keys.ts                          # generate / create / list / revoke / verify
│   └── caller.ts                            # Caller union, getCaller, requireCaller
├── types/
│   └── next-auth.d.ts                       # adds id to Session.user
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts      # exports { GET, POST } = handlers
│   │   ├── whoami/route.ts                  # smoke test for both flows
│   │   └── keys/
│   │       ├── route.ts                     # GET (list) + POST (mint)
│   │       └── [id]/route.ts                # DELETE (404 on miss, not 403)
│   └── (dashboard)/
│       ├── layout.tsx                       # async, gates the whole route group
│       └── settings/
│           ├── page.tsx                     # async server component, real Drizzle query
│           └── _components/
│               └── api-keys-section.tsx     # client: table + new-key dialog + revoke
├── components/
│   └── user-menu.tsx                        # avatar + email + signOut server action
└── lib/
    └── mock-data.ts                         # dropped MOCK_API_KEYS + MockApiKey
.env.example                                 # see "Env" below
package.json                                 # see "Packages" below
```

## Packages

Added to `dependencies`:

- `next-auth@5.0.0-beta.25` — App Router-native v5.
- `@auth/drizzle-adapter@^1.7.4` — resolved to 1.11.2.
- `bcryptjs@^2.4.3` — pure JS, no postinstall compile in Docker. Perf
  cost vs native `bcrypt` is irrelevant at our key count.
- `@radix-ui/react-label@^2.1.1` — peer for the new shadcn `<Label>`.

Added to `devDependencies`:

- `@types/bcryptjs@^2.4.6`.

Added shadcn primitives via `pnpm dlx shadcn@latest add label table` —
created `src/components/ui/{label,table}.tsx`. The existing
`.npmrc ignore-workspace-root-check=true` lets shadcn install Radix peers
at the workspace root, same pattern as Phase 1.

`sonner` was deliberately skipped — the "copy this key now" flow lives
inside the modal that owns the key, so a toast on top of an open dialog
would just be noise.

## DB shape

Auth.js tables follow the `@auth/drizzle-adapter` Postgres shape, but with
**snake_case column args** and **camelCase TS keys** to match the rest of
the schema. The adapter references columns by their TS property name
(`accountsTable.userId`, `sessionsTable.sessionToken`), so the renamed SQL
columns are invisible to Auth.js. `AdapterAccountType` is imported from
`next-auth/adapters` (which re-exports from `@auth/core/adapters`), which
avoids adding `@auth/core` as a direct dep.

New tables:

- `users` — `id uuid pk default gen_random_uuid()`, `name text`,
  `email text unique`, `email_verified timestamptz`, `image text`.
- `accounts` — composite pk `(provider, provider_account_id)`,
  `user_id uuid → users(id) on delete cascade`, plus the OAuth fields
  the adapter expects.
- `sessions` — `session_token text pk`, `user_id uuid → users(id)
  on delete cascade`, `expires timestamptz not null`.
- `verification_tokens` — composite pk `(identifier, token)`,
  `expires timestamptz not null`.

Mutated tables:

- `api_keys`:
  - `user_id uuid not null references users(id) on delete cascade` (new)
  - `key_prefix text not null` — 8 hex chars in plaintext, **unique
    indexed** for O(1) verifier lookup
  - Unique index on `(user_id, label)` — a user can't have two keys
    called "laptop"
  - `key_hash` now stores bcrypt of the **secret half only**
- `runs.created_by` — `text` → `uuid not null references users(id) on
  delete restrict`.
- `gate_decisions.decided_by` — same change.

The original `0000_plain_angel.sql` was deleted and regenerated via
`pnpm drizzle-kit generate --name plain_angel` against the new schema.
Safe because Phase 1 had not shipped against any real DB. **Don't squash
again** once a non-dev environment has applied this migration.

## API key format

```
yvn_<8-hex-prefix>_<32-char-base64url-secret>
```

- `yvn_` is a constant scheme tag. The prefix is unique-indexed plaintext;
  the verifier `SELECT`s on it (O(1)) and then runs **one** `bcrypt.compare`
  on the secret. ~80ms per verify at cost factor 10.
- `last_used_at` is updated fire-and-forget — the verifier doesn't `await`
  the write so REST/WS auth can't be slowed by a slow timestamp UPDATE.
- Prefix collision retry on `23505` against `api_keys_key_prefix_idx`,
  capped at 3 attempts (4-billion-bucket space — the retry exists for
  paranoia, not realism).

`verifyApiKey(rawKey)` is the **only** signature the WS upgrade handler in
todo 2 should consume — it takes a string, not a `Request`, so the WS
handler can pass `?token=` straight in.

## Routes

All under `src/app/api/` and follow the `health/route.ts` style.

| Method   | Path                | Auth             | Notes |
| -------- | ------------------- | ---------------- | ----- |
| `GET`    | `/api/health`       | none             | unchanged from Phase 1 |
| `GET`    | `/api/whoami`       | required         | returns the `Caller` JSON; smoke test for both flows |
| `GET`    | `/api/keys`         | required         | lists current caller's keys; never returns `keyHash` or raw key |
| `POST`   | `/api/keys`         | required         | body `{ label }` (zod, 1-64 chars); returns `{ id, label, key, keyPrefix }` once |
| `DELETE` | `/api/keys/[id]`    | required         | scoped to `caller.userId`; **returns 404, not 403, on miss** to avoid leaking key existence |
| `GET/POST` | `/api/auth/*`     | (Auth.js)        | NextAuth handlers — sign-in, callback, sign-out |

`POST /api/keys` returns 409 with `{"error":"label_exists"}` when the
`(user_id, label)` unique constraint trips, so the dialog can show a
friendly error.

## Caller resolution

`src/server/caller.ts`:

1. If `Authorization: Bearer ...` is present → `verifyApiKey(token)`. On
   match return `{kind:"apiKey",...}`. **On no match return `null`** —
   we don't fall through to session lookup, because a user who pasted a
   bad key shouldn't accidentally succeed via cookie.
2. Else `auth()` (which reads cookies via `next/headers`, no `req`
   needed). On hit return `{kind:"user", userId, email}`.
3. Else `null`.

`requireCaller(req)` returns `Response(null, {status: 401})` for handlers
to early-return — typed as `Caller | Response`, so handlers do
`if (caller instanceof Response) return caller`.

## Sign-in / sign-out flow

- `(dashboard)/layout.tsx` is async: `const session = await auth(); if
  (!session?.user?.email) redirect("/api/auth/signin")`. Gates the whole
  route group in one place.
- `/api/auth/*`, `/api/health`, `/api/whoami`, `/api/keys/*` are outside
  the group and stay reachable.
- The header replaces Phase 1's hardcoded `<Badge>key: laptop</Badge>`
  with `<UserMenu>` — initial circle + email + a "Sign out" button. The
  button is wrapped in a server-action `<form>` calling `signOut` from
  `@/server/auth`, the v5-recommended pattern (no `SessionProvider`
  needed).
- Sign-in uses Auth.js's default `/api/auth/signin` page. No custom page
  in v1.
- `signIn` callback enforces `AUTH_ALLOWED_EMAILS`. Empty list = open
  (local dev default); rejected emails get the Auth.js default
  access-denied page.

## Settings page

`/settings` is now a server component:

- Top of file: `auth()` redirect-on-null (belt-and-braces with the layout
  gate).
- Loads keys directly via Drizzle (`listApiKeys(userId)`), serializes
  `Date` → ISO string, hands to a client `<ApiKeysSection initial={...}>`.
- Client component owns:
  - Shadcn `<Table>` for rows. Empty state if the user has no keys yet.
  - "New key" → `<Dialog>` with `<Label>` + `<Input>` + Create button.
  - On submit → `POST /api/keys` → swap dialog body to a read-only input
    showing the raw key, copy button, and a bold red "you will not see
    this again" notice. Dialog stays open until explicit "I've saved it".
    The close (×) button is hidden during the reveal stage to discourage
    accidental dismissal.
  - Trash icon per row → `confirm()` → `DELETE /api/keys/:id` with
    `useTransition` + optimistic remove + rollback on non-`ok` (404 is
    treated as success — the key was already gone).
- "Defaults" and "Gates" sections stay informational, unchanged from
  Phase 1.

`MOCK_API_KEYS` and the `MockApiKey` interface were deleted from
`src/lib/mock-data.ts` (verified no other consumers via `grep -r`).

## Env

`.env.example` shuffled:

- Removed `API_KEY=change-me` (replaced with a `# Removed:` comment
  pointing to per-user keys minted in `/settings`).
- Added `AUTH_SECRET=` (with `# openssl rand -base64 32` hint).
- Added `AUTH_URL=http://localhost:3000`.
- Added commented `AUTH_TRUST_HOST=true` (set behind a proxy in prod).
- Added `GITHUB_CLIENT_ID=` and `GITHUB_CLIENT_SECRET=`.
- Added `AUTH_ALLOWED_EMAILS=` (comment: empty = open, comma-separated
  otherwise; first email is the implicit bootstrap admin).

## Verification

```bash
docker compose down -v && docker compose up -d   # fresh DB
pnpm install
pnpm db:migrate
pnpm typecheck && pnpm lint                       # both clean
pnpm dev
```

Browser checks:

- `open http://localhost:3000` → bounces to `/api/auth/signin`.
- Sign in with allowlisted GitHub account → lands on `/`.
- `/settings` → "New key" → label `laptop` → modal shows raw
  `yvn_<prefix>_<secret>` once → copy → "I've saved it" dismisses.
- List shows the row with `keyPrefix` only. Refresh — raw key gone.
- Trash icon → confirm → row disappears (optimistic).

REST checks:

```bash
KEY="yvn_<prefix>_<secret>"

curl -i http://localhost:3000/api/health                              # 200
curl -i http://localhost:3000/api/whoami                              # 401
curl -i -H "Authorization: Bearer $KEY" \
  http://localhost:3000/api/whoami                                    # {"kind":"apiKey",...}
curl -i --cookie "authjs.session-token=…" \
  http://localhost:3000/api/whoami                                    # {"kind":"user",...}

curl -i -X DELETE -H "Authorization: Bearer $USER_A_KEY" \
  http://localhost:3000/api/keys/$USER_B_KEY_ID                       # 404 (no leak)
```

After hitting `/api/whoami` with a Bearer key, re-`GET /api/keys` and
confirm `lastUsedAt` is non-null (the fire-and-forget UPDATE).

## Out of scope (not built)

- Rate limiting.
- Per-key scopes / per-user roles — every user + key is full-access.
- Audit log of key use beyond `last_used_at`.
- "Regenerate this key" button — revoke + mint a new one is the rotation
  path.
- Multi-tenant isolation — every signed-in user still sees every run.
  That's the §13 "multi-tenant later?" question, not this todo.
- WS auth wiring — todo 2 calls `verifyApiKey` from
  `src/server/api-keys.ts`. The function deliberately takes a string, not
  a `Request`.

## Notes for whoever picks this up next

- **Don't add Auth.js middleware.** v5 middleware runs on Edge by default
  and can't reach the DB session via postgres-js. Layout-level gating is
  the v5-recommended pattern. The custom `server.ts` already runs
  `app.getRequestHandler()` so all `/api/auth/*` routes work unmodified.
- **No `runtime = "edge"` exports anywhere.** DB session strategy +
  postgres-js requires Node.
- The `apiKeys.user_id → users(id) on delete cascade` plus
  `created_by/decided_by → users(id) on delete restrict` means **deleting
  a user fails** as long as they have any runs or gate decisions. That's
  intentional — block the delete rather than NULL-out attribution. If a
  soft delete becomes necessary later, prefer a `users.disabled_at` flag
  plus a session sweep over an actual row delete.
- `next-auth/adapters` re-exports from `@auth/core/adapters` — use it
  whenever you need adapter types in the schema or elsewhere. Don't add
  `@auth/core` as a direct dep; we already get a transitive copy.
- Server action sign-out (`<form action={async () => { "use server";
  await signOut(...) }}>`) is what `<UserMenu>` uses. Don't switch to
  `next-auth/react`'s `signOut()` — it requires `<SessionProvider>`,
  which we don't have, and the server action keeps everything inside
  the component tree.
- `lastUsedAt` fire-and-forget: the swallowed `.catch(() => {})` is
  deliberate. If the DB rejects the UPDATE we still want auth to
  succeed. Don't add `await` here without a very good reason — it puts
  every authenticated request behind a write.

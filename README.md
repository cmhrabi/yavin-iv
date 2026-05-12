# yavin-iv

Dashboard and source of truth for AI-driven SDLC runs. See
[`plan/implementation-plan.md`](./plan/implementation-plan.md) for the full design,
and [`plan/`](./plan/) for per-phase build notes.

## Develop

```bash
pnpm install
cp .env.example .env
docker compose up -d            # start Postgres
pnpm db:migrate                 # apply schema
pnpm dev                        # http://localhost:3000
```

## Useful scripts

| Command            | What it does                                   |
| ------------------ | ---------------------------------------------- |
| `pnpm dev`         | Custom server + Next.js (HMR)                  |
| `pnpm build`       | Production build                               |
| `pnpm start`       | Run the production server                      |
| `pnpm lint`        | Next.js / ESLint                               |
| `pnpm typecheck`   | TypeScript check across the workspace          |
| `pnpm db:generate` | Generate a new Drizzle migration               |
| `pnpm db:migrate`  | Apply pending migrations                       |
| `pnpm db:push`     | Push schema directly (fast iteration only)     |
| `pnpm db:studio`   | Open Drizzle Studio                            |

## Layout

- `src/app/` — Next.js App Router (dashboard pages + REST routes)
- `src/components/` — UI components (shadcn primitives in `ui/`)
- `src/db/` — Drizzle schema, client, migrations
- `src/lib/` — utilities and (for now) mock data
- `packages/protocol/` — `@cmhrabi/yavin-protocol` shared types between yavin-iv and rogue-one (see [`INTEGRATION.md`](./INTEGRATION.md))
- `server.ts` — custom Next.js entry (the WebSocket server attaches here in the next phase)

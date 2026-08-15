# Smart Monitoring System — Website

>A web frontend and companion bot for the Smart Monitoring System (sensor dashboard, history, control, and Telegram integrations).

## Key Features
- Responsive UI built with React + TypeScript and Vite
- Real-time/near-real-time sensor dashboard and history views
- Telegram bot integration for alerts and remote control
- Supabase for data persistence and migrations included
- Tailwind + Radix UI components for polished UI primitives

## Tech Stack
- Frontend: React (TSX), TypeScript, Vite
- UI: Tailwind CSS, Radix UI components, Recharts (charts)
- State & Routing: @tanstack/react-query, @tanstack/react-router
- Backend & DB: Supabase (Postgres), migrations in `supabase/migrations`
- Bot: Node (TypeScript) Telegram bot under `src/bot/`
- Deployment: Cloudflare Workers (wrangler) is used for deploy script

## Repo Structure (important paths)
- `src/` — application source
  - `entry-client.tsx`, `entry-server.tsx` — Vite/SSR entry points
  - `router.tsx`, `routeTree.gen.ts` — routing
  - `routes/` — page routes and API endpoints (e.g. `api.sensor-reading.ts`, `api.telegram.webhook.ts`)
  - `components/` — UI components and app-level components (e.g. `AppShell.tsx`, `SensorCard.tsx`)
  - `bot/` — bot-specific code: `telegram-bot.ts`, `telegram-webhook-service.ts`
  - `lib/` — helper functions (`telegram.functions.ts`, `whatsapp.functions.ts`, `utils.ts`)
- `supabase/` — Supabase config and SQL migrations
- `public/` — static assets
- `package.json` — scripts and dependencies
- `bun.lockb`, `bunfig.toml` — Bun support files (optional)

## Prerequisites
- Node.js (recommended v18+) or Bun (if you prefer Bun CLI)
- npm, yarn, or bun available locally
- Supabase project & credentials (for local development or connecting to a remote DB)
- Cloudflare account + `wrangler` configured if using `npm run deploy`

## Environment variables
Create a `.env` or use your environment manager with the following (examples):

- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — keys for Supabase
- `TELEGRAM_BOT_TOKEN` — Telegram bot token (if running bot)
- `WRANGLER_*` — Cloudflare/wrangler-specific variables if deploying

Store secrets securely; do not commit `.env` to source control.

## Common Scripts
Run these from the project root.

- Install dependencies:

  - npm: `npm install`
  - bun: `bun install`

- Start dev server (frontend):

  `npm run dev`

- Build (production):

  `npm run build`

- Preview production build locally:

  `npm run preview`

- Bot development (build + start):

  `npm run bot:dev`

- Deploy (uses `wrangler` per `package.json`):

  `npm run deploy`

- Lint / format:

  `npm run lint`
  `npm run format`

## Supabase
- The `supabase/` directory contains `config.toml` and SQL migrations.
- To run migrations locally, use the Supabase CLI or your normal DB migration workflow.

## Telegram Bot
- Bot source is in `src/bot/` and compiled with `tsc -p tsconfig.bot.json` (see `bot:build` script).
- `npm run bot:dev` will build and start the bot using `node dist-bot/bot/telegram-bot.js`.

## Notes & Tips
- This project contains Bun lock files and `bunfig.toml`; Bun can be used but `package.json` scripts are standard npm-compatible.
- The app uses Cloudflare tooling (`wrangler`) for deployment — ensure `wrangler` is authenticated and configured.
- UI primitives live under `src/components/ui/` and are composed by higher-level components in `src/components/app/`.

## Contributing
- Create a branch, test locally, and open a PR describing your change.

## License
Specify a license for the project (e.g., MIT). Add `LICENSE` to the repository.

---
If you want, I can also:
- Add a sample `.env.example` with required variables
- Add a short local dev checklist and commands for Supabase emulation
- Create CI/CD pipeline (GitHub Actions) for build + deploy

If you'd like any of those, tell me which and I'll add them.

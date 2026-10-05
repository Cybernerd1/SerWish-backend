# SerWish backend

Node 20+ / Express / Socket.IO API for the SerWish customer and partner apps.
Postgres + PostGIS on Supabase (database only). Firebase for sign-in and push.

> Read [SECURITY.md](SECURITY.md) first: there are owner actions (password rotation) to do.

## Run locally

```bash
cp .env.example .env    # fill in Supabase + Firebase values
npm install
npm run dev             # http://localhost:5000/health
```

The server checks `.env` at boot and stops with a clear message if something is missing.

## Database

Migrations live in `supabase/migrations/` and run in file-name order:

| File | What it does |
| --- | --- |
| `001`-`003` | Retired v1 files, now no-ops |
| `20261001000000_v2_reset_legacy.sql` | Drops the v1 schema **only if v1 tables exist** (test data only, owner approved) |
| `20261001000100_v2_baseline.sql` | The v2 schema, rules, RPCs and lockdown |
| `20261002000000_v2_bookings.sql` | Dispatcher, partner moves, completion, cancellation, idempotent booking |
| `20261003000000_v2_reschedule.sql` | Reschedule a booking (releases an assigned partner) |

Apply to Supabase with the CLI (`supabase link` then `supabase db push`), or paste the four v2
files into the SQL editor in order. Load demo data with `supabase/seed.sql` (dev/test only: it
adds 7 fake approved partners around Sector 56, Gurugram).

Check the schema on any empty PostGIS database:

```bash
DATABASE_URL=postgres://... npm run db:check   # migrations + seed twice + rule checks
```

## Tests

```bash
npm test                                # unit tests (no database needed)
bash scripts/integration-env.sh         # Docker: PostGIS + PostgREST + full API tests
bash scripts/integration-env.sh down
npm run lint && npm run format:check
```

App contract tests: start `scripts/e2e-server.mjs` (real API, fake sign-in tokens, never deploy it)
and run `serwishapp/__tests__/e2e` against it; see the header of that test file.

CI (`ci/github-actions-ci.yml`; move it to `.github/workflows/ci.yml`) runs lint, unit tests, the database checks and the integration
tests on every push.

## API

- Contract: [docs/openapi.yaml](docs/openapi.yaml) (`x-status: live` vs `phase-3`)
- Realtime: [docs/realtime.md](docs/realtime.md)
- Envelope: `{ success, message, data?, meta? }` / `{ success: false, code, message, errors? }`

## Layout

```
src/
  index.js            process entry: env check, Firebase, HTTP + sockets, graceful shutdown
  app.js              Express app factory (used by tests)
  config/             env (zod), firebase, supabase, constants
  middleware/         auth, errors, rate limits, validation
  routes/             HTTP routes + input schemas
  controllers/        request -> repo -> DTO
  repos/              all database access (service role; always scoped to the caller)
  services/           pricing, dispatcher loop, notifications, realtime emit helpers
  socket/             Socket.IO auth, crash-safe handlers, presence, booking rooms
  utils/              logger, errors, response helpers, DTO mappers, validators
supabase/             migrations, seed, SQL rule checks, legacy v1 files
tests/                vitest unit + integration tests
```

## How a booking flows

1. App calls `POST /bookings/estimate`, shows the bill, then `POST /bookings` with an `Idempotency-Key`.
2. The dispatcher (every 2 s, plus right after each change) offers the job to one partner at a time:
   preferred partner first, then nearest, then best rated, within 5 km. Each offer lasts 45 s
   (`job:offer` on the partner's socket; `GET /job-offers` as a fallback).
3. Decline or expiry moves to the next partner. Nobody within the matching timeout (5 min) ends it
   as `no_providers`. Scheduled jobs start dispatching 60 minutes before the slot.
4. The partner accepts, then `start-trip`, `arrive`, `start`, and `complete` after receiving the
   full amount in cash or UPI. Each step reaches the customer as `booking:updated` and a notification.
5. The customer may rate once. Cancel is allowed until work starts; a partner dropping out sends the
   job back to the dispatcher.

The matching rules run inside the database function `dispatch_tick()` under an advisory lock, so
two API instances never double-offer.

## Owner decisions in force

5 km matching radius, 45 s job offers, no platform fee, no cancellation fee, no wallet, and the
partner completes a job only after confirming payment. The completion OTP is waiting on a decision
(`/bookings/:id/otp` answers 501). All are environment settings
(see `.env.example`) except the wallet, which is removed.

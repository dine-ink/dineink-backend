# DineInk backend

The API behind every DineInk surface: the owner web app, the POS, the customer
QR ordering page, and the internal operations console. Express 5 + Prisma 7 on
Postgres, TypeScript throughout.

One deployable, two audiences. `/api/*` serves a caller who owns exactly one
restaurant and is guarded accordingly; `/api/internal/*` serves DineInk
employees with their own authentication, their own permission model, and its own
error handling. They share services, never authorization.

## Requirements

- Node **>= 22** (`engines` enforces it)
- Postgres 14+

## Getting started

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL and JWT_SECRET
npx prisma migrate deploy     # apply migrations to your database
npx prisma generate           # emit the client into generated/prisma
npm run dev                   # http://localhost:5500
```

`src/config/secrets.ts` refuses to boot if required secrets are missing — a
process that goes green and only fails when someone tries to sign in is worse
than one that will not start.

To create the first internal Super Admin (prints a generated password once):

```bash
npx tsx scripts/seed-internal-rbac.ts
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API with reload on change |
| `npm run build` | `prisma generate` then `tsc` into `dist/` |
| `npm start` | Run the built server |
| `npm test` | Unit tests (fast, no database) |
| `npm run test:integration` | Integration tests — **hits the configured database** |
| `npm run worker` | Background job worker (separate process) |
| `npm run prisma:migrate` | Create + apply a migration in development |
| `npm run prisma:deploy` | Apply pending migrations (deployment) |
| `npm run prisma:studio` | Browse the database |
| `npm run seed` | Seed demo data |

## Layout

```
src/
  index.ts          Express app: helmet, CORS, rate limit, routes, error handler
  server.ts         Entry point — dotenv, secret check, listen
  worker.ts         Background job worker entry point
  routes/index.ts   The API surface as a table; mounts every module
  shared/           Cross-cutting: ApiError, the zod validation toolkit, paging
  middleware/       auth, authorize, validate, routeParams, rateLimit, errors
  config/           prisma, cors, mailer, openai, secrets, whatsapp
  modules/<name>/   One folder per feature — see below
  jobs/             Durable job queue + handlers (Postgres-backed, no broker)
  utils/            Date ranges, units, email normalisation
  seed/             Demo-data generators
prisma/             schema.prisma, migrations, seed
scripts/            One-off migrations and ops scripts; scripts/sql for DBA grants
docs/reports/       Historical audit and phase reports
```

### Module convention

Every feature is a folder under `src/modules/` and every file in it carries the
feature's name as a prefix:

```
modules/budget/
  budget.routes.ts       Paths, guards, validation — the contract, readable alone
  budget.controller.ts   HTTP in, HTTP out. No business logic.
  budget.service.ts      Business logic and every database call.
  budget.validation.ts   zod schemas for this module's request bodies
  budget.types.ts        Types shared inside the module
  budget.*.test.ts       Co-located tests
```

Requests flow **routes → controller → service**, never sideways. When a module
outgrows one service file it splits within the same convention rather than
breaking it — `finance.formulas.ts`, `finance.ratios.ts`,
`finance.statements.service.ts`. Add a module by creating the folder and adding
one row to the table in `src/routes/index.ts`.

## Validation and errors

Request validation uses the zod toolkit in `src/shared/validate.ts`, declared at
the route so the contract sits next to the path:

```ts
router.post("/login", authRateLimiter, validateBody(loginSchema), login);
```

A zod object strips unknown keys, which is also what stops a request body
reaching `prisma.update()` with fields the endpoint never meant to accept.

Every numeric route parameter (`:id`, `:restaurantId`, …) is validated centrally
by `guardIdParams` in `src/middleware/routeParams.ts`, applied to every module by
`src/routes/index.ts`. A module cannot opt out.

Errors are one type — `ApiError` from `src/shared/apiError.ts` — carrying a
status, a stable `code` the frontends branch on, and a human-readable message.
`src/middleware/errorHandler.ts` translates it once. Unexpected failures return a
correlation id and never leak Prisma query text or column names.

## Authentication

**Restaurant apps** (`/api/*`): JWT bearer tokens. `authMiddleware` verifies the
token; `requireOwnRestaurant` / `requireOwnBranch` enforce tenant isolation where
the URL carries the id. Where it does not, the controller takes `restaurantId`
from the JWT — never from the body — and the service verifies the row belongs to
the caller before writing.

Sign-in is protected on two axes, because they stop different attacks:

- `authRateLimiter` — per IP. Stops one host hammering the endpoint, and is the
  only defence against password *spraying* across many accounts.
- The per-account lockout in `modules/auth/auth.lockout.ts` — **20 failed
  attempts within one hour latches the account**. It cannot then be opened by
  password at all, only by an email-verified password reset
  (`/auth/forgot-password` → `/auth/reset-password`). This is what stops a
  distributed attack on one known account, which the IP limiter cannot see.

**Internal console** (`/api/internal/*`): separate secret, 12-hour sessions
stored as rows so access can be cut immediately, optional TOTP, and a five-strike
timed lockout. See `modules/internal/auth/`.

## Testing

```bash
npm test                  # unit tests — no database, ~1.5s
npm run test:integration  # hits the configured database
```

Tests live next to what they test. `*.integration.test.ts` is excluded from the
default run by `vitest.config.ts`.

## Known limitations

- Rate limits are in-memory and therefore per instance: two instances give an
  attacker twice the budget. A shared store (Redis) is the fix once the API runs
  more than a couple of instances.
- The restaurant-side password policy is six characters, weaker than the
  internal console's ten-plus-classes. Raising it needs a migration path for
  existing owners.

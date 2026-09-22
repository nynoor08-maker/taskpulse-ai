# TaskPulse AI

Autonomous voice negotiation and vendor dispatch for local service businesses.

## Stack

- Next.js App Router + TypeScript
- Supabase Auth / Postgres / RLS
- Vapi multi-agent squads (Triage → Negotiator → Closing) — **canonical dispatch path**
- Twilio SMS, Stripe Checkout, Sentry, Upstash rate limits (required in production)

## Setup

1. Copy `.env.local.example` to `.env.local` and fill production values (never commit secrets).
2. Apply `schema.sql` in the Supabase SQL editor (profiles trigger, RLS, telephony vault helpers).
3. Install and run:

```bash
npm install
npm run dev
```

## Launch checklist

```bash
cp .env.local.example .env.local   # fill real secrets
npm run db:apply-schema            # needs SUPABASE_ACCESS_TOKEN+SUPABASE_PROJECT_REF or DATABASE_URL
npm run check:launch               # env, webhooks, squad markers, RLS, Upstash, Sentry
# or both:
npm run setup:launch

npm run build
npm run test:smoke                 # code markers; set SMOKE_E2E_ALLOW=true for DB fixture flow
```

Live call / load scripts require explicit opt-in flags — see `.env.local.example`.

**Do not** set `ALLOW_SINGLE_ASSISTANT_DISPATCH=true` in production. `/api/dispatch-call` returns 410 unless that flag is set for legacy eval.

## Canonical dispatch

| Entry | Mechanism |
| --- | --- |
| `POST /api/tasks` | Session create + `placeVendorSquadCall` (dashboard) |
| `POST /api/v1/tasks` | API key create + squad |
| `POST /api/dispatch-squad` | Dial existing task via squad |
| `POST /api/v1/tasks/inbound-dispatch` | Inbound intake + squad |
| Vapi webhook retry | Next vendor via `placeVendorSquadCall` |

## Key surfaces

| Path | Purpose |
| --- | --- |
| `/` | Marketing landing |
| `/login` | Magic-link auth |
| `/dashboard` | Create jobs, track status, Stripe pay |
| `/vendor` | Vendor workspace + accept-jobs toggle |
| `/vendor/quote?taskId=` | Fallback quote form after missed calls |
| `/admin` | Operations monitor + dispatch pause |
| `/api/health` | Dependency probes (Upstash required when `NODE_ENV=production`) |

Set `NEXT_PUBLIC_APP_URL` to the deployment origin so tool callbacks, Stripe redirects, and SMS links stay environment-correct.

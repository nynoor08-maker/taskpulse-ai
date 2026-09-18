# TaskPulse AI

Autonomous voice negotiation and vendor dispatch for local service businesses.

## Stack

- Next.js App Router + TypeScript
- Supabase Auth / Postgres / RLS
- Vapi multi-agent squads (Triage → Negotiator → Closing)
- Twilio SMS, Stripe Checkout, Sentry, optional Upstash rate limits

## Setup

1. Copy `.env.local.example` to `.env.local` and fill in production values.
2. Apply `schema.sql` to your Supabase project (includes profile bootstrap trigger and RLS).
3. Install and run:

```bash
npm install
npm run dev
```

## Launch checks

```bash
npm run check:launch   # env, webhook verification markers, RLS readiness
npm run build
npm run test:agent-eval
```

Live call / load scripts require explicit opt-in env flags — see `.env.local.example`.

## Key surfaces

| Path | Purpose |
| --- | --- |
| `/` | Marketing landing |
| `/login` | Magic-link auth |
| `/dashboard` | Customer completed tasks + Stripe pay |
| `/vendor` | Vendor workspace |
| `/vendor/quote?taskId=` | Fallback quote form after missed calls |
| `/admin` | Operations monitor + dispatch pause |
| `/api/v1/tasks` | API task create + dispatch |
| `/api/v1/tasks/inbound-dispatch` | Vapi inbound intake |
| `/api/dispatch-squad` | Squad outbound dial |
| `/api/webhooks/vapi` | Call completion, vendor pool retry, SMS |

Set `NEXT_PUBLIC_APP_URL` to the deployment origin so tool callbacks, Stripe redirects, and SMS links stay environment-correct.

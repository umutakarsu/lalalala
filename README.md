# Scout

**The recruiting OS that wires into your stack.**

A connection layer for Berlin tech, in recruiting mode. A recruiter posts a job,
an agent shortlists candidates from your own user-graph (LinkedIn CSV imports —
**never scraped**), and warm intros flow through **bridges** who get paid 15% of
the success fee when the candidate is placed.

> The moat is the **n8n integrations**, not the AI. Every customer ATS/HRIS
> workflow you wire up is a switching cost.

## Stack

- **Next.js (App Router)** — UI + synchronous route handlers (job CRUD, profile
  edit, pipeline view).
- **Supabase Postgres** — data, auth, RLS, full-text matching RPCs.
- **n8n** — async / scheduled / integration workflows (shortlist agent, consent
  expiry, Stripe payouts, Calendly hooks, ATS later).
- **Anthropic Claude** (via n8n) — agent reranker + intro-message drafter.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the stack split and
**[n8n/README.md](./n8n/README.md)** for the workflows.

## Quick start

```bash
npm install
cp .env.example .env.local      # fill in Supabase / Anthropic / n8n values
```

Apply the database migrations to your Supabase project (in order):

```bash
# via Supabase CLI
supabase db push
# or paste supabase/migrations/0001_scout_base.sql then 0002_recruiting.sql
# into the Supabase SQL editor
```

Run the app:

```bash
npm run dev      # http://localhost:3000
npm run build    # production build (typechecked)
```

Key routes:

- `/` — landing
- `/recruiter` — pipeline kanban
- `/recruiter/jobs/new` — post a job (→ `POST /api/jobs` → fires the n8n shortlist)

## The shortlist loop

1. Recruiter posts a job → `POST /api/jobs` persists it and fires
   `N8N_WEBHOOK_URL_NEW_JOB`.
2. The **New Job Shortlist** workflow runs `match_profiles` + `find_bridges`,
   reranks with Claude, drafts a warm intro per candidate, and writes `intros`
   rows with `status = 'suggested'`.
3. The recruiter gets a "shortlist ready" email; suggestions appear in the
   pipeline's first column.

## Pricing model (encoded in the schema)

| Field | Default |
| --- | --- |
| `jobs.success_fee_eur` | ≈ **18%** of first-year gross comp |
| `placements.bridge_fee_eur` | **15%** of the success fee |
| `placements.replacement_guarantee_until` | `started_at + 90 days` (50% refund if the candidate leaves inside the window) |

## Trust-preserving UX rules (enforced in code)

- **The bridge never sees a "recruiting intro."** It looks like a normal Scout
  intro request; job context is hidden until they accept. The agent's draft is
  explicitly forbidden from mentioning a fee or a job posting.
- **Clients see redacted candidate cards** (role / years / current-company
  descriptor) until the candidate accepts the intro. `candidate_profiles` is
  never exposed without live consent.
- **Candidate consent is rolling 90 days**, auto-prompted to renew, and
  hard-deleted on expiry (workflow #1 + `consent_events`).

## Berlin / legal notes (do this before invoicing or onboarding — not code)

- **Personalvermittlung (recruiting placement) does _not_ require an AÜG
  license.** **Arbeitnehmerüberlassung (labor leasing) does.** Get a 30-minute
  legal opinion confirming you're doing placement, not leasing, before invoicing
  your first client.
- A **GDPR DPA (Auftragsverarbeitungsvertrag) template** is needed before client
  onboarding.
- A public landing page requires a **Datenschutzerklärung** and an **Impressum**
  (linked but stubbed at `/datenschutz` and `/impressum`).
- **VAT:** register at the **€22k/yr Kleinunternehmer** threshold.

> These are operational/legal tasks, intentionally _not_ coded around. Track
> them as launch blockers.

## Environment variables

See [`.env.example`](./.env.example). Server-only secrets (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `N8N_WEBHOOK_URL_NEW_JOB`) plus
the public Supabase URL/anon key for the browser + SSR auth client.

## Out of scope (MVP)

Client portal, Stripe integration, public job board, bridge nurture drip, ATS
integrations. The schema and stack split are built to absorb them later.

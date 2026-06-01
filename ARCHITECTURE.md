# Scout — Architecture

> **The recruiting OS that wires into your stack.** A connection layer for
> Berlin tech: a recruiter posts a role, an agent shortlists candidates from the
> user-graph (LinkedIn CSV imports, never scraped), and warm intros flow through
> bridges who get paid 15% of the success fee when the candidate is placed.

## Stack split — who owns what

The hard rule: **Next.js owns synchronous request/response; n8n owns
everything async, scheduled, or integration-shaped.** They never share a
runtime — they talk over webhooks and the Postgres database.

| Layer | Responsibility | Examples |
| --- | --- | --- |
| **Next.js (App Router)** | UI + sync route handlers | job CRUD, profile edit, pipeline view, `POST /api/jobs` |
| **Supabase Postgres** | Data, auth, RLS, RPCs | the user-graph, recruiting tables, `match_profiles`, `find_bridges` |
| **n8n** | Async / scheduled / integrations | shortlist agent, consent expiry, Stripe payouts, Calendly hooks, ATS later |
| **Anthropic Claude (via n8n)** | Agent reranker + intro drafter | inside the `new-job-shortlist` workflow |

Why this split:

- **Latency.** The LLM rerank + draft is slow and best-effort. Putting it behind
  a webhook means creating a job returns instantly; the shortlist lands moments
  later. `POST /api/jobs` persists the job, then fires-and-(soft)-forgets to n8n
  (`lib/n8n.ts`); a failed/absent webhook never fails the user's request.
- **Integrations are the moat.** Calendly, Stripe, Resend, and every customer
  ATS are workflow nodes, not bespoke server code. Each one added is a switching
  cost. Keep them in n8n.
- **Trust boundary.** The agent needs to read across the whole graph and write
  `intros`. It does that with the **service role** (RLS bypass) from inside n8n,
  never from the browser.

## Request flow — "post a job"

```
 Recruiter ── form ──▶ POST /api/jobs (Next route handler)
                         │  1. validate
                         │  2. INSERT jobs  (admin/service-role client)
                         │  3. success_fee_eur ← 18% of top-of-band (if unset)
                         │  4. fire N8N_WEBHOOK_URL_NEW_JOB  (≤5s, failure-tolerant)
                         ▼
                   201 { job, shortlist }      n8n: New Job Shortlist
                                                 match_profiles + find_bridges
                                                 → Claude rerank/draft
                                                 → INSERT intros (status=suggested)
                                                 → email recruiter
                                                       │
 Recruiter ◀── pipeline kanban (/recruiter) ◀── reads placements / intros
```

## Data model (see `supabase/migrations/`)

`0001_scout_base.sql` — the connection layer:

- **profiles** (`id = auth.users.id`) with a weighted `search_text` tsvector
  GENERATED column (A: headline+interests+can_intro_to, B: title+company,
  C: bio, D: name+location) + GIN index.
- **external_contacts** — ghost nodes imported from LinkedIn CSV (never scraped).
- **connections** — directed edges, `tie_strength` 0–1, exactly one target
  (profile *or* external contact).
- **intros** — requester → bridge → target, with `job_id`, `status`,
  `draft_message`, `relevance_score`. Visible to all three parties under RLS.
- **intro_messages** — the thread.
- RPCs: `match_profiles(goal_text, exclude_id, count)` (websearch_to_tsquery +
  `ts_rank_cd`) and `find_bridges(target_id, requester_id, count)` (2-hop warm
  path, scored by the product of tie strengths).

`0002_recruiting.sql` — recruiting mode:

- **clients, jobs, candidate_profiles, placements, invoices, consent_events**.
- **candidate_profiles is the GDPR firewall** — RLS lets only the candidate read
  their own row. Clients never read it directly; redacted cards are assembled
  server-side and gated on `consent_to_share_with_clients`.
- **Pricing is encoded in the schema** via defaults + a `placements` trigger:
  `success_fee_eur` ≈ 18% of first-year gross comp, `bridge_fee_eur` = 15% of the
  success fee, `replacement_guarantee_until` = `started_at + 90 days`.

### RLS in one line
Own-row read/write for users; `intros` visible to all three parties; the
**service role bypasses every policy** — that is the only way the agent and the
n8n workflows write. There are deliberately no "agent" policies.

## Supabase clients (`lib/supabase/`)

- `client.ts` — browser, anon key, RLS-bound. Client Components.
- `server.ts` — request-cookie-bound, RLS as the signed-in user. Server
  Components / Server Actions / route handlers acting *as the user*.
- `admin.ts` — **service role, RLS bypass, server-only.** Agent + trusted
  recruiter ops. Never import into client code.

## How to add the remaining n8n flows

All four workflows follow the same MCP build path documented in `n8n/README.md`:

```
get_sdk_reference → get_suggested_nodes → search_nodes → get_node_types
  → write SDK code → validate_workflow → create_workflow_from_code
```

Reuse the three shared credentials (`Scout Supabase Postgres`, `Anthropic`,
`Scout SMTP`). The pattern for each:

1. **consent-expiry** — `scheduleTrigger` (cron `0 9 * * *`) → Postgres SELECT
   the 7-day renewal window → SMTP renewal → log `consent_events`. Second branch
   hard-deletes expired consent. *Adds:* nothing new — `consent_events` and the
   partial index on `candidate_profiles(consent_expires_at)` already exist.
2. **placement-paid-bridge-payout** — Stripe `invoice.paid` webhook → Postgres
   lookup `placements`+`invoices` → email the bridge their `bridge_fee_eur` →
   UPDATE `placements.bridge_fee_paid_at`.
3. **calendly-intro-booked** — Calendly webhook → match `intros` by attendee
   emails → advance `placements.status` to `intro_call_booked`.
4. **ATS integrations** (later) — per-customer webhooks/polling that sync jobs
   and placement stages outward. This is the moat; treat each as a first-class
   workflow, not glue.

To add a new sync surface instead, add a route handler under `app/api/*` and (if
it kicks off async work) a thin fire-and-forget helper in `lib/n8n.ts`.

## What's intentionally out of scope (MVP)

Client portal, Stripe integration, public job board, bridge nurture drip, and
ATS integrations are deferred. The schema and the stack split are built to
absorb them without migration churn.

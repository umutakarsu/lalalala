# Scout — n8n workflows

n8n owns everything async, scheduled, or integration-shaped. Next.js owns
synchronous request/response. The boundary is always a **webhook or a row in
Postgres** — never a shared runtime.

> Brand reminder: **n8n integrations are the moat, not the AI.** Every customer
> ATS/HRIS workflow you wire up here is a switching cost.

## How these workflows are built

Workflows are authored with the **n8n MCP Workflow SDK tools**, not hand-drawn
in the canvas and not imported from the `.ts` files directly. The `.ts` files in
`workflows/` are the reviewable source of truth; the canonical build path is:

```
get_sdk_reference → get_suggested_nodes → search_nodes → get_node_types
  → (write SDK code) → validate_workflow → create_workflow_from_code / update_workflow
```

## Shared credentials (create once in n8n, reuse across workflows)

| Credential name            | Type         | Points at                                            |
| -------------------------- | ------------ | ---------------------------------------------------- |
| `Scout Supabase Postgres`  | Postgres     | Supabase DB host `db.<ref>.supabase.co`, db password |
| `Anthropic`                | Anthropic    | `ANTHROPIC_API_KEY`                                  |
| `Scout SMTP`               | SMTP         | Resend / Postmark / SES transactional sender         |

The Postgres credential connects as a privileged DB user, which is how the agent
"writes via the service role / bypasses RLS" (see `ARCHITECTURE.md`).

---

## #2 · New Job Shortlist  ✅ built (`workflows/new-job-shortlist.workflow.ts`)

Live workflow id: **`bGT2PkJOgssFRLyq`**. This is the most valuable flow.

```
New Job Webhook (POST /webhook/new-job-shortlist)   ← fired by POST /api/jobs
  → Normalize Payload (Set)            body.* → job_id, goal_text, requester_id, count
  → Fetch Shortlist (Postgres)          match_profiles($1,$2,$3) + lateral find_bridges
  → Bundle Candidates (Aggregate)       N rows → 1 item { candidates: [...] }
  → Rerank & Draft Intros (AI Agent)    Claude Sonnet + structured output parser
  → Build Intro Rows (Code)             join agent results ↔ candidates, drop hallucinations
  → Write Suggested Intros (Postgres)   INSERT intros, status = 'suggested'
  → Notify Recruiter (Email, once)      "shortlist ready"
```

Payload contract (`lib/n8n.ts → NewJobShortlistPayload`):

```json
{ "job_id": "uuid", "goal_text": "title + stack + must-haves + pitch", "requester_id": "uuid|null", "count": 10 }
```

**Verify locally before going live** (no external services hit — pins the
trigger, Postgres, Claude, and email nodes; runs Normalize/Aggregate/Code for
real):

```
test_workflow(workflowId, pinData) → get_execution(..., nodeNames:["Build Intro Rows"])
```

A passing run produces one `intros` row per shortlisted candidate, with
`bridge_id` left null when no warm path exists, and any candidate the model
invents (id not in the shortlist) dropped.

**Go live:** attach the three credentials above to the matching nodes, set the
`Notify Recruiter` from/to addresses, then `publish_workflow`. Put the resulting
webhook URL in `N8N_WEBHOOK_URL_NEW_JOB`.

### Trust-preserving note encoded in the prompt
The agent's system message forbids the draft from reading like recruiting: no
fee, no job posting — just a genuine "you two should talk" note the bridge can
forward. Job context stays hidden from the bridge until they accept (enforced in
the UI, not the draft).

---

## Remaining workflows (stubs — build with the same MCP flow)

### #1 · consent-expiry  (daily 9am cron)
`scheduleTrigger (cron 0 9 * * *)` → `Postgres` SELECT candidate_profiles where
`consent_to_share_with_clients = true AND consent_expires_at BETWEEN now() AND
now() + interval '7 days'` → `Email` renewal via SMTP → `Postgres` INSERT
`consent_events (event_type='renewal_emailed')`. A second branch hard-deletes /
revokes rows already past `consent_expires_at` and logs `event_type='expired'`.

### #3 · placement-paid-bridge-payout  (Stripe webhook)
`Webhook (invoice.paid)` → `Postgres` lookup `placements` join `invoices` by
`invoice_id` → `Email` the bridge their `bridge_fee_eur` payout → `Postgres`
UPDATE `placements SET bridge_fee_paid_at = now()`.

### #4 · calendly-intro-booked  (Calendly webhook)
`Webhook` → normalize attendee emails → `Postgres` find the `intros` row by
requester/target/bridge emails → advance the related `placements.status` to
`intro_call_booked`.

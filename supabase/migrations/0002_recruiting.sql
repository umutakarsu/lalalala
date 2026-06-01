-- ════════════════════════════════════════════════════════════════════════
-- Scout — 0002 recruiting mode
--
-- Clients, jobs, candidates (GDPR-gated), the placement pipeline, invoices,
-- and the pricing model encoded as defaults + a trigger:
--   success_fee_eur  ≈ 18% of first-year gross comp   (set at job creation)
--   bridge_fee_eur   = 15% of success_fee_eur          (placement trigger)
--   replacement_guarantee_until = started_at + 90 days (placement trigger)
--
-- candidate_profiles is GDPR-critical: it is NEVER exposed to clients without
-- a live consent_to_share_with_clients flag. RLS keeps it owner-only; the
-- redacted-card / consent logic lives in the application + service role.
-- ════════════════════════════════════════════════════════════════════════

-- ── enums ───────────────────────────────────────────────────────────────
create type remote_policy          as enum ('onsite', 'hybrid', 'remote');
create type job_status             as enum ('open', 'paused', 'filled');
create type job_visibility         as enum ('public', 'private');
create type candidate_availability as enum ('open', 'passive', 'closed');

create type comp_band as enum (
  'under_60k', 'band_60_80k', 'band_80_100k', 'band_100_130k',
  'band_130_160k', 'band_160_200k', 'over_200k'
);

-- The placement lifecycle, in order, plus the terminal drop/refund states.
create type placement_status as enum (
  'suggested', 'bridge_asked', 'bridge_accepted', 'candidate_pitched',
  'interested', 'intro_call_booked', 'interviewing', 'offer_extended',
  'accepted', 'started', 'invoiced', 'paid',
  'dropped', 'refunded'
);

-- ── clients ───────────────────────────────────────────────────────────────
create table public.clients (
  id                        uuid primary key default gen_random_uuid(),
  company_name              text not null,
  domain                    text,
  primary_contact_profile_id uuid references public.profiles (id) on delete set null,
  billing_email             text,
  legal_entity              text,
  vat_id                    text,
  created_at                timestamptz not null default now()
);

-- ── jobs ────────────────────────────────────────────────────────────────
create table public.jobs (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients (id) on delete cascade,
  title          text not null,
  seniority      text,
  stack          text[] not null default '{}',
  must_haves     text[] not null default '{}',
  nice_to_haves  text[] not null default '{}',
  salary_min_eur int,
  salary_max_eur int,
  equity_min     numeric,
  equity_max     numeric,
  remote_policy  remote_policy not null default 'hybrid',
  location_pref  text,
  pitch          text,                 -- markdown
  status         job_status not null default 'open',
  success_fee_eur numeric,             -- default ≈ 18% of first-year gross comp, set by app
  visibility     job_visibility not null default 'private',
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index jobs_client_idx on public.jobs (client_id);
create index jobs_status_idx on public.jobs (status);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- now that jobs exists, wire the intros.job_id FK from 0001
alter table public.intros
  add constraint intros_job_fk foreign key (job_id)
  references public.jobs (id) on delete set null;

-- ── candidate_profiles  [GDPR-critical] ──────────────────────────────────
-- Points at either an internal profile OR an imported external_contact.
create table public.candidate_profiles (
  id                            uuid primary key default gen_random_uuid(),
  profile_id                    uuid references public.profiles (id) on delete cascade,
  external_contact_id           uuid references public.external_contacts (id) on delete cascade,
  availability                  candidate_availability not null default 'passive',
  comp_floor_eur                int,
  notice_days                   int,
  target_role_types             text[] not null default '{}',
  consent_to_share_with_clients boolean not null default false,
  consent_expires_at            timestamptz,
  recruiter_notes               text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint candidate_one_source check ((profile_id is not null) <> (external_contact_id is not null))
);

create index candidate_profiles_profile_idx  on public.candidate_profiles (profile_id);
create index candidate_profiles_external_idx on public.candidate_profiles (external_contact_id);
-- supports the daily consent-expiry workflow (7-day renewal window scan)
create index candidate_profiles_consent_idx  on public.candidate_profiles (consent_expires_at)
  where consent_to_share_with_clients = true;

create trigger candidate_profiles_set_updated_at
  before update on public.candidate_profiles
  for each row execute function public.set_updated_at();

-- ── invoices ──────────────────────────────────────────────────────────────
create table public.invoices (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  placement_id uuid not null,        -- FK added after placements exists
  amount_eur   numeric not null,
  vat_eur      numeric not null default 0,
  issued_at    timestamptz not null default now(),
  paid_at      timestamptz,
  pdf_url      text,
  created_at   timestamptz not null default now()
);

-- ── placements (the pipeline) ─────────────────────────────────────────────
create table public.placements (
  id                          uuid primary key default gen_random_uuid(),
  job_id                      uuid not null references public.jobs (id) on delete cascade,
  candidate_id                uuid not null references public.candidate_profiles (id) on delete cascade,
  bridge_profile_id           uuid references public.profiles (id) on delete set null,
  status                      placement_status not null default 'suggested',
  success_fee_eur             numeric,
  bridge_fee_eur              numeric,
  invoice_id                  uuid references public.invoices (id) on delete set null,
  started_at                  timestamptz,
  replacement_guarantee_until timestamptz,
  bridge_fee_paid_at          timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (job_id, candidate_id)
);

create index placements_job_idx    on public.placements (job_id);
create index placements_cand_idx   on public.placements (candidate_id);
create index placements_status_idx on public.placements (status);
create index placements_bridge_idx on public.placements (bridge_profile_id);

create trigger placements_set_updated_at
  before update on public.placements
  for each row execute function public.set_updated_at();

-- close the invoices.placement_id FK now that placements exists
alter table public.invoices
  add constraint invoices_placement_fk foreign key (placement_id)
  references public.placements (id) on delete cascade;

create index invoices_placement_idx on public.invoices (placement_id);
create index invoices_client_idx    on public.invoices (client_id);

-- ── pricing defaults trigger ──────────────────────────────────────────────
create or replace function public.set_placement_defaults()
returns trigger
language plpgsql
as $$
begin
  -- inherit the success fee from the job if not explicitly set
  if new.success_fee_eur is null then
    select j.success_fee_eur into new.success_fee_eur
    from public.jobs j where j.id = new.job_id;
  end if;

  -- bridge earns 15% of the success fee
  if new.bridge_fee_eur is null and new.success_fee_eur is not null then
    new.bridge_fee_eur := round(new.success_fee_eur * 0.15, 2);
  end if;

  -- 90-day replacement guarantee window opens on start date
  if new.started_at is not null and new.replacement_guarantee_until is null then
    new.replacement_guarantee_until := new.started_at + interval '90 days';
  end if;

  return new;
end;
$$;

create trigger placements_set_defaults
  before insert or update on public.placements
  for each row execute function public.set_placement_defaults();

-- ── consent_events (audit trail for the rolling 90-day consent) ───────────
-- Written by the consent-expiry workflow (granted / renewal_emailed / renewed
-- / expired / revoked / hard_deleted).
create table public.consent_events (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.candidate_profiles (id) on delete cascade,
  event_type   text not null,
  occurred_at  timestamptz not null default now(),
  meta         jsonb not null default '{}'
);

create index consent_events_candidate_idx on public.consent_events (candidate_id);

-- ── additions to profiles ─────────────────────────────────────────────────
alter table public.profiles
  add column available_for_roles text[] not null default '{}',
  add column comp_signal         comp_band,
  add column right_to_work_eu    boolean,
  add column consent_marketing   boolean not null default false;

-- ════════════════════════════════════════════════════════════════════════
-- RLS  (service_role bypasses all of these — recruiter/agent ops run there)
-- ════════════════════════════════════════════════════════════════════════

alter table public.clients            enable row level security;
alter table public.jobs               enable row level security;
alter table public.candidate_profiles enable row level security;
alter table public.placements         enable row level security;
alter table public.invoices           enable row level security;
alter table public.consent_events     enable row level security;

-- clients / placements / invoices / consent_events: no anon/authenticated
-- policies → service-role-only. (Client portal gets scoped, redacted access
-- later via dedicated views + policies; see ARCHITECTURE.md.)

-- jobs: public listings are readable; the creator manages their own rows.
create policy jobs_select_public_or_own on public.jobs
  for select using (visibility = 'public' or auth.uid() = created_by);
create policy jobs_write_own on public.jobs
  for all using (auth.uid() = created_by) with check (auth.uid() = created_by);

-- candidate_profiles: the candidate sees/edits ONLY their own record.
-- Clients never read this table directly — consent-gated redacted cards are
-- assembled server-side. This is the GDPR firewall.
create policy candidate_profiles_select_self on public.candidate_profiles
  for select using (profile_id = auth.uid());
create policy candidate_profiles_update_self on public.candidate_profiles
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

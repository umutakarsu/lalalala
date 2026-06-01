-- ════════════════════════════════════════════════════════════════════════
-- Scout — 0001 base schema (the connection layer)
--
-- The user-graph: profiles, ghost nodes imported from LinkedIn CSV
-- (external_contacts, never scraped), the connections between them, and the
-- warm intros that flow across bridges.
--
-- RLS model: own-row read/write. Intros are visible to all three parties
-- (requester, bridge, target). The shortlist agent writes via the service
-- role, which bypasses RLS entirely — so there are no "agent" policies here.
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── enums ───────────────────────────────────────────────────────────────
create type connection_source as enum ('linkedin_csv', 'manual', 'intro');
create type intro_status as enum (
  'suggested',   -- written by the shortlist agent, not yet acted on
  'requested',   -- requester asked the bridge to make the intro
  'accepted',    -- bridge agreed
  'declined',    -- bridge declined
  'sent',        -- intro message delivered to target
  'completed',   -- intro led to a conversation
  'expired'
);

-- ── shared trigger: keep updated_at fresh ───────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── profiles ─────────────────────────────────────────────────────────────
-- id == auth.users.id. search_text is a weighted tsvector generated column:
--   A: headline + interests + can_intro_to   (what you offer / who you know)
--   B: current_title + current_company        (where you are now)
--   C: bio                                     (the long tail)
--   D: name + location                         (identity)
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  full_name       text,
  headline        text,
  bio             text,
  interests       text[]      not null default '{}',
  can_intro_to    text[]      not null default '{}',
  current_company text,
  current_title   text,
  location        text,
  calendly_url    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  search_text     tsvector generated always as (
      setweight(to_tsvector('english',
        coalesce(headline, '') || ' ' ||
        coalesce(array_to_string(interests, ' '), '') || ' ' ||
        coalesce(array_to_string(can_intro_to, ' '), '')), 'A') ||
      setweight(to_tsvector('english',
        coalesce(current_title, '') || ' ' ||
        coalesce(current_company, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(bio, '')), 'C') ||
      setweight(to_tsvector('english',
        coalesce(full_name, '') || ' ' ||
        coalesce(location, '')), 'D')
  ) stored
);

create index profiles_search_text_idx on public.profiles using gin (search_text);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── external_contacts (ghost nodes from CSV import) ──────────────────────
create table public.external_contacts (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  company      text,
  title        text,
  linkedin_url text,
  source       connection_source not null default 'linkedin_csv',
  created_at   timestamptz not null default now()
);

create index external_contacts_owner_idx on public.external_contacts (owner_id);

-- ── connections ──────────────────────────────────────────────────────────
-- Exactly one of to_profile_id / to_external_id is set.
create table public.connections (
  id             uuid primary key default gen_random_uuid(),
  from_profile_id uuid not null references public.profiles (id) on delete cascade,
  to_profile_id  uuid references public.profiles (id) on delete cascade,
  to_external_id uuid references public.external_contacts (id) on delete cascade,
  tie_strength   real not null default 0.5 check (tie_strength >= 0 and tie_strength <= 1),
  source         connection_source not null default 'manual',
  created_at     timestamptz not null default now(),
  constraint connections_one_target check ((to_profile_id is not null) <> (to_external_id is not null))
);

create index connections_from_idx     on public.connections (from_profile_id);
create index connections_to_prof_idx  on public.connections (to_profile_id);
create index connections_to_ext_idx   on public.connections (to_external_id);

-- ── intros ───────────────────────────────────────────────────────────────
-- job_id is added as a real FK in 0002 once the jobs table exists.
-- Exactly one of target_profile_id / target_external_id is set.
create table public.intros (
  id                uuid primary key default gen_random_uuid(),
  requester_id      uuid not null references public.profiles (id) on delete cascade,
  bridge_id         uuid references public.profiles (id) on delete set null,
  target_profile_id uuid references public.profiles (id) on delete cascade,
  target_external_id uuid references public.external_contacts (id) on delete cascade,
  job_id            uuid,
  status            intro_status not null default 'suggested',
  goal              text,
  context           text,
  draft_message     text,
  relevance_score   real,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint intros_one_target check ((target_profile_id is not null) <> (target_external_id is not null))
);

create index intros_requester_idx on public.intros (requester_id);
create index intros_bridge_idx    on public.intros (bridge_id);
create index intros_target_idx    on public.intros (target_profile_id);
create index intros_job_idx       on public.intros (job_id);

create trigger intros_set_updated_at
  before update on public.intros
  for each row execute function public.set_updated_at();

-- ── intro_messages ─────────────────────────────────────────────────────────
create table public.intro_messages (
  id         uuid primary key default gen_random_uuid(),
  intro_id   uuid not null references public.intros (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index intro_messages_intro_idx on public.intro_messages (intro_id);

-- ════════════════════════════════════════════════════════════════════════
-- RLS
-- service_role bypasses every policy below — the shortlist agent and other
-- n8n workflows use it. anon/authenticated are constrained to their own rows.
-- ════════════════════════════════════════════════════════════════════════

alter table public.profiles          enable row level security;
alter table public.external_contacts enable row level security;
alter table public.connections       enable row level security;
alter table public.intros            enable row level security;
alter table public.intro_messages    enable row level security;

-- profiles: own row only (cross-profile discovery happens server-side via the
-- service role / match_profiles, never by opening the table to all readers).
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- external_contacts: owner only
create policy external_contacts_all_own on public.external_contacts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- connections: the owner (from side) manages; the to-profile can read
create policy connections_all_own on public.connections
  for all using (auth.uid() = from_profile_id) with check (auth.uid() = from_profile_id);
create policy connections_select_target on public.connections
  for select using (auth.uid() = to_profile_id);

-- intros: visible to all three parties; only the requester may create one
create policy intros_select_parties on public.intros
  for select using (auth.uid() in (requester_id, bridge_id, target_profile_id));
create policy intros_insert_requester on public.intros
  for insert with check (auth.uid() = requester_id);
create policy intros_update_parties on public.intros
  for update using (auth.uid() in (requester_id, bridge_id, target_profile_id))
  with check (auth.uid() in (requester_id, bridge_id, target_profile_id));

-- intro_messages: readable/writable by parties to the parent intro
create policy intro_messages_select_parties on public.intro_messages
  for select using (exists (
    select 1 from public.intros i
    where i.id = intro_id
      and auth.uid() in (i.requester_id, i.bridge_id, i.target_profile_id)
  ));
create policy intro_messages_insert_parties on public.intro_messages
  for insert with check (
    auth.uid() = sender_id and exists (
      select 1 from public.intros i
      where i.id = intro_id
        and auth.uid() in (i.requester_id, i.bridge_id, i.target_profile_id)
    )
  );

-- ════════════════════════════════════════════════════════════════════════
-- RPCs
-- ════════════════════════════════════════════════════════════════════════

-- match_profiles — top N profiles for a free-text goal, ranked with
-- ts_rank_cd over the weighted search_text. websearch_to_tsquery lets the
-- caller pass natural language ("senior rust engineer fintech berlin").
-- SECURITY DEFINER so the agent (and recruiter server code) can rank across
-- the whole graph; only non-sensitive columns are returned.
create or replace function public.match_profiles(
  goal_text   text,
  exclude_id  uuid default null,
  match_count int  default 10
)
returns table (
  id              uuid,
  full_name       text,
  headline        text,
  current_title   text,
  current_company text,
  location        text,
  rank            real
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.headline, p.current_title, p.current_company, p.location,
         ts_rank_cd(p.search_text, websearch_to_tsquery('english', goal_text)) as rank
  from public.profiles p
  where p.search_text @@ websearch_to_tsquery('english', goal_text)
    and (exclude_id is null or p.id <> exclude_id)
  order by rank desc
  limit greatest(coalesce(match_count, 10), 1);
$$;

-- find_bridges — 2-hop warm-path finder. Given a target profile, return the
-- people who know the target AND are known by the requester (requester →
-- bridge → target), scored by the product of the two tie strengths.
create or replace function public.find_bridges(
  target_id    uuid,
  requester_id uuid,
  match_count  int default 3
)
returns table (
  bridge_id        uuid,
  bridge_name      text,
  tie_to_target    real,
  tie_to_requester real,
  bridge_score     real
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id                                  as bridge_id,
         b.full_name                           as bridge_name,
         ct.tie_strength                        as tie_to_target,
         cr.tie_strength                        as tie_to_requester,
         (ct.tie_strength * cr.tie_strength)    as bridge_score
  from public.connections ct
  join public.profiles b
    on b.id = ct.from_profile_id
  join public.connections cr
    on cr.from_profile_id = requester_id
   and cr.to_profile_id = b.id
  where ct.to_profile_id = target_id
    and b.id <> requester_id
  order by bridge_score desc
  limit greatest(coalesce(match_count, 3), 1);
$$;

grant execute on function public.match_profiles(text, uuid, int) to anon, authenticated, service_role;
grant execute on function public.find_bridges(uuid, uuid, int)   to anon, authenticated, service_role;

-- 0001_init.sql — content_agency_mvp schema bootstrap
-- Date: 2026-05-01 (Day 2)
-- Decisions referenced: D-001 (multi-tenant by brand_id), D-008 (app-level AES, ciphertext as text)
--
-- Tables (all in `public` schema):
--   brands               — identity + lifecycle
--   brand_configs        — creative + technical config (1:1 with brands)
--   post_queue           — pipeline state per planned post
--   post_results         — publish outcomes (1:1 with post_queue, after publish)
--   analytics_snapshots  — time-series engagement samples per post
--
-- RLS: enabled on every table (defense-in-depth). MVP service uses the secret/service_role key
-- and bypasses RLS by design. Policies will be added when/if any anon-key surface is exposed.
--
-- Conventions:
--   - UUID PKs (gen_random_uuid()), no auto-increment ints.
--   - Every table: created_at, updated_at, archived_at (soft-delete).
--   - Encrypted secrets: TEXT storing base64(iv ‖ ciphertext ‖ tag) per D-008.

-- ─────────────────────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger helper
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- brands
-- ─────────────────────────────────────────────────────────────────────────────
create table public.brands (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name            text not null,
  status          text not null default 'onboarding'
                    check (status in ('onboarding', 'active', 'paused', 'churned')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create index brands_status_idx on public.brands(status) where archived_at is null;

create trigger brands_set_updated_at
  before update on public.brands
  for each row execute function public.set_updated_at();

comment on table public.brands is 'One row per client brand. Lifecycle: onboarding → active → paused/churned.';

-- ─────────────────────────────────────────────────────────────────────────────
-- brand_configs (1:1 with brands)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.brand_configs (
  brand_id            uuid primary key references public.brands(id) on delete cascade,

  -- Creative parameters (mirrored from per-brand Notion)
  voice               text not null,                          -- voice/tone description (markdown)
  pillars             jsonb not null default '[]'::jsonb,     -- ["education","behind_the_scenes",...]
  banned_words        jsonb not null default '[]'::jsonb,     -- ["click here","limited time",...]
  target_audience     text not null,                          -- audience description (markdown)
  hashtag_strategy    jsonb not null default '{}'::jsonb,     -- {"core": [...], "rotate": [...]}

  -- Platform identifiers
  ig_business_account_id  text,                               -- numeric IG biz account id (string for safety)
  ig_username             text,                               -- @handle, no '@'
  fb_page_id              text,                               -- backing FB page id

  -- Encrypted credentials (per D-008: base64 of iv‖ciphertext‖authTag, AES-256-GCM)
  ig_token_encrypted      text,                               -- IG long-lived token
  notion_token_encrypted  text,                               -- Notion integration token
  ga_token_encrypted      text,                               -- GA4 access token (post-MVP)

  -- Notion linkage (pointer-only; secrets above)
  notion_brand_db_id      text,                               -- per-brand Notion content queue DB
  notion_strategy_page_id text,                               -- voice/pillars/etc. source page

  -- Publish routing
  publish_account_label   text not null default 'main'        -- which IG account label in Publisher A6
                            check (publish_account_label in ('main','secondary')),

  -- Pipeline knobs (per-brand overrides; null = use defaults)
  posts_per_week          int not null default 5 check (posts_per_week between 0 and 21),
  posts_per_day_max       int not null default 2 check (posts_per_day_max between 0 and 5),
  client_approval_required boolean not null default false,    -- per D-006, normally false

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz
);

create trigger brand_configs_set_updated_at
  before update on public.brand_configs
  for each row execute function public.set_updated_at();

comment on table public.brand_configs is 'Creative + technical config per brand. 1:1 with brands. Secrets stored AES-256-GCM (D-008).';

-- ─────────────────────────────────────────────────────────────────────────────
-- post_queue
-- ─────────────────────────────────────────────────────────────────────────────
create table public.post_queue (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references public.brands(id) on delete cascade,

  -- Idempotency: prevents double-enqueue from upstream retries
  idempotency_key     text not null,

  -- Pipeline status (linear progression)
  status              text not null default 'pending'
                        check (status in (
                          'pending',
                          'strategist','writer','editor','spanish_editor','qg','designer',
                          'ready','scheduled','publishing','published',
                          'failed','rejected','archived'
                        )),
  status_reason       text,                                 -- last failure/rejection cause

  -- Content payload (each agent appends its slice; full JSON envelope per pipeline contract)
  payload             jsonb not null default '{}'::jsonb,

  -- Scheduling
  scheduled_for       timestamptz,                          -- when Publisher A6 should pick it up
  published_at        timestamptz,                          -- mirror of post_results.published_at for fast listing

  -- Run metadata
  attempt_count       int not null default 0 check (attempt_count >= 0),
  last_error          text,
  last_error_at       timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,

  unique (brand_id, idempotency_key)
);

create index post_queue_brand_status_idx
  on public.post_queue(brand_id, status)
  where archived_at is null;

create index post_queue_scheduled_for_idx
  on public.post_queue(scheduled_for)
  where status = 'scheduled' and archived_at is null;

create index post_queue_status_active_idx
  on public.post_queue(status)
  where archived_at is null;

create trigger post_queue_set_updated_at
  before update on public.post_queue
  for each row execute function public.set_updated_at();

comment on table public.post_queue is 'One row per planned post. Linear status progression through pipeline → publish.';

-- ─────────────────────────────────────────────────────────────────────────────
-- post_results
-- ─────────────────────────────────────────────────────────────────────────────
create table public.post_results (
  id                  uuid primary key default gen_random_uuid(),
  post_queue_id       uuid not null unique references public.post_queue(id) on delete cascade,
  brand_id            uuid not null references public.brands(id) on delete cascade,

  -- Publish outcome
  ig_media_id         text,                                  -- IG media id from Graph API
  ig_permalink        text,                                  -- public URL
  published_at        timestamptz,
  publish_error       text,                                  -- if non-null, publish failed
  publish_attempt_count int not null default 1,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index post_results_brand_published_idx
  on public.post_results(brand_id, published_at desc nulls last);

create trigger post_results_set_updated_at
  before update on public.post_results
  for each row execute function public.set_updated_at();

comment on table public.post_results is 'Publish outcomes. 1:1 with post_queue (after publish step).';

-- ─────────────────────────────────────────────────────────────────────────────
-- analytics_snapshots
-- ─────────────────────────────────────────────────────────────────────────────
create table public.analytics_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  post_result_id      uuid not null references public.post_results(id) on delete cascade,
  brand_id            uuid not null references public.brands(id) on delete cascade,

  snapshot_at         timestamptz not null default now(),

  -- IG engagement metrics (all nullable — not every metric is always available)
  reach               int,
  impressions         int,
  likes               int,
  comments            int,
  saves               int,
  shares              int,
  profile_visits      int,
  follows             int,

  raw                 jsonb,                                  -- full Graph API response for forensics

  created_at          timestamptz not null default now()
);

create index analytics_snapshots_brand_snap_idx
  on public.analytics_snapshots(brand_id, snapshot_at desc);

create index analytics_snapshots_post_snap_idx
  on public.analytics_snapshots(post_result_id, snapshot_at desc);

comment on table public.analytics_snapshots is 'Time-series engagement samples per post. Multiple rows per post over time.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — enable everywhere; service_role bypasses. Policies added later if needed.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.brands              enable row level security;
alter table public.brand_configs       enable row level security;
alter table public.post_queue          enable row level security;
alter table public.post_results        enable row level security;
alter table public.analytics_snapshots enable row level security;

-- 0002_brand_identity_jsonb.sql
-- Date: 2026-05-01 (Day 2)
-- Decision: D-009 — collapse fixed creative columns into a single jsonb mirror of Notion.
-- Decision: D-010 — Postgres holds a synced cache; Notion remains the human-editable source of truth.
--
-- Discovery that drove this: Hashtag's brand identity is composed of 9 separate Notion
-- databases (Brand Themes, Pillars, Image Strategy Rules, Blueprints, Content Recipes,
-- CTA Bank, Hook Bank, Lexicon, Photo Config), all keyed by a `Client` select field.
-- A handful of typed columns can never model that without ALTER TABLE every time the
-- creative team adds a new dimension. jsonb removes that friction permanently.
--
-- Safe to run: 0 rows in brand_configs at time of migration.

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the typed creative columns
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.brand_configs
  drop column voice,
  drop column pillars,
  drop column banned_words,
  drop column target_audience,
  drop column hashtag_strategy;

-- ─────────────────────────────────────────────────────────────────────────────
-- Add brand_identity jsonb (passive mirror of Notion)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.brand_configs
  add column brand_identity jsonb not null default '{}'::jsonb,
  add column brand_identity_synced_at timestamptz,    -- last successful Notion → Postgres sync
  add column brand_identity_source text not null default 'notion'
    check (brand_identity_source in ('notion', 'manual'));

comment on column public.brand_configs.brand_identity is
  'Passive mirror of the brand''s Notion identity (9 DBs serialized into one JSON envelope). Humans NEVER edit this directly — always edit via Notion. Synced by the brand-identity sync job (D-010).';

comment on column public.brand_configs.brand_identity_synced_at is
  'Timestamp of the last successful Notion → Postgres sync. NULL = never synced.';

comment on column public.brand_configs.brand_identity_source is
  'Where brand_identity is sourced from. ''notion'' for synced brands (default), ''manual'' for brands without a Notion workspace (rare).';

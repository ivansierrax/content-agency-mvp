-- 0003 — Notion client-filter column for brand_identity sync
--
-- Each brand has a single 'Client' select option in the shared Hashtag-agency
-- Notion DBs (Pillars / Recipes / CTA Bank / etc.). The sync queries each DB
-- with `filter: { property: "Client", select: { equals: <this value> } }`.
--
-- Cannot be derived from brands.slug or brands.name reliably across brands
-- (Brand 0: slug='hashtag', name='Hashtag Agencia', Notion select='Hashtag').
-- Stored on brand_configs so it lives next to the rest of the per-brand wiring.

ALTER TABLE brand_configs
  ADD COLUMN IF NOT EXISTS notion_client_filter text;

COMMENT ON COLUMN brand_configs.notion_client_filter IS
  'Exact Notion select-option value used to filter shared agency DBs to this brand''s rows. Set during onboarding.';

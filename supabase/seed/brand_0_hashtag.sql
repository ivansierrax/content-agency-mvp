-- Brand 0 seed — Hashtag Agencia (the dogfood brand)
-- Date: 2026-05-01 (Day 2)
--
-- Idempotent: safe to re-run. ON CONFLICT DO NOTHING on the brands insert,
-- and a SELECT-then-UPSERT pattern on brand_configs.
--
-- brand_identity is a PARTIAL seed — only the 5 known active rows fetched live
-- this session (1 theme + 3 pillars + 1 blueprint + 1 photo config). The other
-- 4 categories (image_rules, recipes, ctas, hooks, lexicon) get filled by Day 5's
-- proper Notion sync job, which will read all 9 DBs filtered to Client=Hashtag.
--
-- Token columns are NULL per D-011 — Hashtag's IG long-lived token is dead
-- (BUG-S58-4); rotation is its own atomic session on Day 7 evening.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. brands row
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.brands (slug, name, status, notes)
values (
  'hashtag',
  'Hashtag Agencia',
  'onboarding',
  'Brand 0 — Hashtag Agencia itself, the dogfood brand. Goes to active once the chain ships its first end-to-end post via the new Node service (Day 6 target).'
)
on conflict (slug) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. brand_configs row (uses brand id resolved by slug)
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.brand_configs (
  brand_id,
  ig_business_account_id,
  ig_username,
  fb_page_id,
  ig_token_encrypted,            -- null per D-011
  notion_token_encrypted,        -- null until Day 5 sync work
  ga_token_encrypted,            -- null (post-MVP)
  notion_brand_db_id,
  notion_strategy_page_id,
  publish_account_label,
  posts_per_week,
  posts_per_day_max,
  client_approval_required,
  brand_identity,
  brand_identity_synced_at,
  brand_identity_source
)
select
  b.id,
  '17841464669710572',                       -- agenciahashtag_
  'agenciahashtag_',
  '1083370791523753',                        -- Hashtag Agencia FB Page
  null,                                      -- ig_token_encrypted (D-011)
  null,
  null,
  '76133fbc60094add8e92e298821aab5f',        -- legacy Phase-1 content queue DB id (kept for reference)
  '349101e8a2ca810f8898f9095b5a52fb',        -- 🧩 Content Pipeline Config root page
  'main',
  5,                                          -- posts_per_week (mirrors current cadence)
  2,                                          -- posts_per_day_max
  false,                                      -- per D-006
  $brand_identity$
{
  "themes": [
    {
      "notion_page_id": "349101e8-a2ca-81e1-bce2-cac7b1cdbe40",
      "name": "Hashtag 2026 Primary",
      "active": true,
      "client": "Hashtag",
      "primary_color": "#F01428",
      "accent_color": "#F01428",
      "background_color_dark": "#0D0D0D",
      "background_color_light": "#FAFAFA",
      "body_text_color": "#F5F0E8",
      "muted_text_color": "#8A8680",
      "text_color_dark_bg": "#FAFAFA",
      "text_color_light_bg": "#0D0D0D",
      "heading_font": "Bebas Neue",
      "label_font": "Montserrat",
      "body_font": "Inter",
      "footer_line": "HASHTAG AGENCIA • 2026 | ivan@hashtag.com.mx",
      "tagline": "# HASHTAG GO BEYOND",
      "logo_url": null,
      "default_publish_accounts": ["ivansierrax", "agenciahashtag_"],
      "test_account_list": ["hashtag_labx"],
      "test_mode_enabled": false
    }
  ],
  "pillars": [
    {
      "notion_page_id": "349101e8-a2ca-81d8-8083-ce1cac35014a",
      "name": "Influencer Marketing",
      "short_code": "Influencer",
      "active": true,
      "client": "Hashtag",
      "description": "Estrategia, medición y casos de marketing de influencers en LATAM. Desde creadores micro hasta celebridades, con foco en ROI real y construcción de marca.",
      "voice_notes": "Service-showcase voice. Speak as an agency that runs these campaigns. Mix data with specific tactics. Never theoretical — everything must be something a brand could implement this week.",
      "cta_text": "Agenda tu llamada — ivan@hashtag.com.mx",
      "forbidden_angles": "Rankings genéricos de influencers. Listas de \"top 10 creators\" sin contexto. Consejos obvios (\"elige el creador que se alinee a tu marca\").",
      "preferred_recipes": ["B", "C"],
      "hashtag_seed_pool": "#InfluencerMarketing #MarketingDeInfluencers #CreadoresDeContenido #MarketingLATAM",
      "example_topics": "Cómo briefár a un creador sin matarle la voz; cuándo usar micro vs mega influencers; CPE vs CPM en influencer; el problema del fake engagement en México; creador vs vocero vs embajador"
    },
    {
      "notion_page_id": "349101e8-a2ca-81b0-a818-e8a4e2f1cbd5",
      "name": "Performance Marketing",
      "short_code": "Performance",
      "active": true,
      "client": "Hashtag",
      "description": "Google Ads, Meta Ads, TikTok Ads. Optimización de campañas, medición, atribución, CRO, y cómo sobrevivir al fin de las cookies de tercero.",
      "voice_notes": "Technical-but-accessible voice. Cite specific platform changes and numbers when allowed. Be honest about what works and what doesn't. No vanity metrics.",
      "cta_text": "Agenda tu llamada — ivan@hashtag.com.mx",
      "forbidden_angles": "\"Guías completas\" de 30 tips. Hacks sin contexto. Consejos que funcionaron en 2020 y ya no.",
      "preferred_recipes": ["A", "B"],
      "hashtag_seed_pool": "#PerformanceMarketing #GoogleAds #MetaAds #PaidMedia #MarketingDigital",
      "example_topics": "Por qué tu ROAS miente; Performance Max vs Search campaigns; CAPI vs Pixel en 2026; cómo medir contenido orgánico que sirve a paid; el colapso de las audiencias lookalike"
    },
    {
      "notion_page_id": "349101e8-a2ca-81a5-a456-d66a3b595857",
      "name": "Thought Leadership",
      "short_code": "ThoughtLeadership",
      "active": true,
      "client": "Hashtag",
      "description": "Tomas contrarias, predicciones, diagnósticos del estado del marketing. Alto riesgo / alto retorno en engagement — la voz opinionada de la agencia.",
      "voice_notes": "Maximum Death-Declaration and Identity-Provocation triggers. Stake a position. No hedging. Cite evidence but end with a conviction, not a question.",
      "cta_text": "Sigue a @agenciahashtag_ para mas",
      "forbidden_angles": "False balance (\"por un lado... por otro lado\"). Tomas obvias disfrazadas de contrarias. Ataques personales a colegas o competidores nombrados.",
      "preferred_recipes": ["A", "C"],
      "hashtag_seed_pool": "#Marketing #MarketingDigital #AgenciaDeMarketing #Marketeros",
      "example_topics": "La era del \"guru de marketing\" terminó; tu CMO no necesita un agencia, necesita un tech stack; el marketing de 2016 está muerto y tu brief lo sabe; por qué Hashtag rechaza briefs"
    }
  ],
  "image_rules": [],
  "blueprints": [
    {
      "notion_page_id": "349101e8-a2ca-8104-a7db-db49b2e79d9c",
      "name": "Hashtag Editorial Blueprint",
      "version": "1.0",
      "active": true,
      "client": "Hashtag",
      "file_url": "https://www.notion.so/349101e8a2ca810f8898f9095b5a52fb",
      "override_pairs_json": "{}",
      "change_notes": "Bootstrap. Extracted from CD v3 system prompt (Session 40) and memory editorial notes during Phase 1 of the 2026-04-21 consultant audit. Canonical file lives at /Users/ivansierra/Dropbox (Ivan)/Mac/Desktop/0 Lobby/Claude/content_pipeline/BLUEPRINT.md.",
      "last_updated": "2026-04-21"
    }
  ],
  "recipes": [],
  "ctas": [],
  "hooks": [],
  "lexicon": [],
  "photo": {
    "notion_page_id": "34a101e8-a2ca-8135-95e5-d051c60da05b",
    "name": "Hashtag Photo Config v1",
    "active": true,
    "client": "Hashtag",
    "style_anchor": "editorial documentary photograph, 35mm film grain texture, professional photography, 8K ultra-detailed",
    "camera_anchor": "Canon R5 + 35mm or 50mm prime, f/1.8–2.8, shallow to moderate depth of field",
    "mood_baseline": "warm natural tones, film-like color grading, high contrast shadows",
    "style_preset_shortname": "editorial-documentary-warm (v1)",
    "composition_default": "leaves negative space in one third of frame for text overlay",
    "voice_tone_tags": "direct · peer-authority · Mexican-casual",
    "scene_settings_pool": "rooftop terrace · coworking space · café natural light · urban street · home office · corporate office at night",
    "scene_palette_pool": "warm amber · cool blue · muted earth · high-contrast B&W · desaturated warm",
    "scene_time_of_day_pool": "golden hour · morning natural · late afternoon · dusk · night with monitor glow",
    "person_age_range": "20–35",
    "person_gender_rule": "50/50, alternating per carousel",
    "person_ethnicity_pool": "European 44% · Asian 39% · Black 17% (relative weights, no repeat consecutive). NO Latin American, NO Indian, NO South Asian.",
    "person_wardrobe_mix": "streetwear 50% · casual smart 45% · business casual 5%",
    "person_action_note": "Action verb and emotion picked per slide from content — not a fixed pool. Subject must be DOING something (not posing).",
    "person_banned_patterns": "smile-at-camera · thumbs-up · handshake · corporate-headshot · runway-pose · stiff-posing · fake-smile · LinkedIn-headshot",
    "object_choice_rule": "Designer picks object at runtime from the post's core concept. NO pre-set list — content drives. Every chosen object logged to Content Queue for pattern learning.",
    "object_count_max": 5,
    "object_composition": "editorial flat-lay OR low-angle hero shot",
    "object_lighting": "hard natural sunlight, sharp shadows, warm tones",
    "object_surface_pool": "concrete · wood · marble · linen · leather · matte metal",
    "object_surface_banned": "floating · glass display · white cyclorama · sci-fi pedestal · neon-lit",
    "single_image_bg_rotation": "Rotate across 3 colors for single-image posts: Deep Black #0D0D0D (provocation/death) · Hashtag Red #F01428 (high-stakes claim) · Clean White #FAFAFA (strategic/thoughtful). No more than 2 consecutive same color. Text colors per bg: BLACK→cream+red accent · RED→white+black accent · WHITE→black+red accent.",
    "negative_prompt_bank": "vintage · retro · neon · sci-fi · futuristic · stock photo · corporate headshot · fake smile · smiling at camera · runway fashion · editorial fashion · busy background · clutter · collage · text · typography · words · letters · logos · watermarks · handwritten text · visible writing · legible numbers in notebook · handwritten metrics · readable words on paper · visible brand names",
    "how_to_change_aesthetic": "TO SHIFT THE OVERALL PHOTO AESTHETIC, edit these 3 master fields and all future generated photos inherit the change: 1) STYLE ANCHOR — defines the genre/lens of photography. 2) CAMERA ANCHOR — defines the camera/lens feel. 3) MOOD BASELINE — defines the tonal/grading feel. The Designer agent reads these 3 fields at the start of every photo prompt. You DO NOT need to touch any other field to change the overall look.",
    "notes": "v1 seeded 2026-04-22 from prototype iteration sessions. Edit any field here and the Designer picks up on next post. Add new negative-prompt keywords here when a generation fails aesthetically."
  },
  "_seed_meta": {
    "seeded_at": "2026-05-01",
    "seeded_by": "Day 2 partial seed (5 of 45 known active rows). Day 5 Notion sync job will overwrite with the full picture from all 9 DBs filtered to Client=Hashtag.",
    "complete_categories": ["themes", "pillars", "blueprints", "photo"],
    "deferred_categories": ["image_rules", "recipes", "ctas", "hooks", "lexicon"]
  }
}
$brand_identity$::jsonb,
  now(),
  'notion'
from public.brands b
where b.slug = 'hashtag'
on conflict (brand_id) do update set
  ig_business_account_id = excluded.ig_business_account_id,
  ig_username            = excluded.ig_username,
  fb_page_id             = excluded.fb_page_id,
  brand_identity         = excluded.brand_identity,
  brand_identity_synced_at = excluded.brand_identity_synced_at,
  brand_identity_source  = excluded.brand_identity_source;

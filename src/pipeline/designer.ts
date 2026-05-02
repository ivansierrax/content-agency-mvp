/**
 * Designer (Day 6) — port of n8n's Agent 4: Designer (workflow `8KYkBaKg3yeRummd`,
 * "Designer: Build Render Jobs" + per-slide HCTI loop + storage upload).
 *
 * For each slide in the WriterDraft:
 *   - person_photo / object_photo → fill prompt deterministically from
 *     brand_identity.photo, then call Gemini 2.5 Flash Image for the bg image.
 *   - typography_dark / typography_light / data_card / closing_cta → no Gemini,
 *     just HTML.
 *   - All slide types → render via HCTI Hosted (HTML → PNG @ 1080×1350×2 dpi).
 *   - Upload PNG to Supabase Storage (public bucket).
 *   - Write the public URL back to slide.url.
 *
 * Storage choice (D-015): Supabase Storage instead of GDrive (production) —
 * already authenticated, public URLs, no OAuth refresh-token plumbing.
 *
 * HTML templates are VERBATIM ports of production. They use brand_theme colors.
 * Inline-styled <div>s, no external CSS framework — HCTI renders these reliably.
 */

import * as Sentry from '@sentry/node';
import { loadEnv } from '../lib/env.js';
import { getAdminClient } from '../lib/supabase.js';
import type {
  ContextPackage,
  WriterDraft,
  WriterSlide,
  BrandThemeForWriter,
} from './types.js';
import type { BrandIdentity } from '../db/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignerResult {
  draft: WriterDraft; // each slide now has .url populated
  slides_rendered: number;
  slides_failed: number;
  failures: Array<{ slide_number: number; reason: string }>;
}

export interface RunDesignerParams {
  context_package: ContextPackage;
  draft: WriterDraft;
  brand_id: string;
  brand_slug: string;
  /** Stable per-post identifier used as the storage path prefix. */
  post_queue_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo prompt enrichment (deterministic, port of n8n)
// ─────────────────────────────────────────────────────────────────────────────

interface PhotoConfig {
  style_anchor?: string;
  camera_anchor?: string;
  mood_baseline?: string;
  composition_default?: string;
  person_ethnicity_pool?: string;
  person_wardrobe_mix?: string;
  person_banned_patterns?: string;
  scene_settings_pool?: string;
  scene_time_of_day_pool?: string;
  scene_palette_pool?: string;
  object_surface_pool?: string;
  object_surface_banned?: string;
  object_lighting?: string;
  object_composition?: string;
  negative_prompt_bank?: string;
  voice_tone_tags?: string;
  [k: string]: unknown;
}

interface WeightedPool {
  pool: string[];
  weights: number[];
}

function pickWeighted(pool: string[], weights: number[]): string {
  if (pool.length === 0) return '';
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i] ?? 0;
    if (r <= 0) return pool[i] ?? '';
  }
  return pool[pool.length - 1] ?? '';
}

function pickRandom(arr: string[]): string {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] ?? '' : '';
}

function parseList(str: string | undefined): string[] {
  return (str ?? '').split(/·|\|/).map((s) => s.trim()).filter(Boolean);
}

function parseEthnicity(str: string | undefined): WeightedPool {
  const pool: string[] = [];
  const weights: number[] = [];
  const re = /(European|Asian|Black)\s+(\d+)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str ?? '')) !== null) {
    pool.push(m[1] ?? '');
    weights.push(parseInt(m[2] ?? '0', 10));
  }
  return { pool, weights };
}

function parseWardrobe(str: string | undefined): WeightedPool {
  const pool: string[] = [];
  const weights: number[] = [];
  const re = /(streetwear|casual smart|business casual)\s+(\d+)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str ?? '')) !== null) {
    pool.push(m[1] ?? '');
    weights.push(parseInt(m[2] ?? '0', 10));
  }
  return { pool, weights };
}

function enrichPhotoSlides(
  slides: WriterSlide[],
  photo: PhotoConfig,
  objectConcept: string
): WriterSlide[] {
  const eth = parseEthnicity(photo.person_ethnicity_pool);
  const wardrobe = parseWardrobe(photo.person_wardrobe_mix);
  const settings = parseList(photo.scene_settings_pool);
  const timesOfDay = parseList(photo.scene_time_of_day_pool);
  const palettes = parseList(photo.scene_palette_pool);
  const surfaces = parseList(photo.object_surface_pool);

  const styleAnchor = photo.style_anchor ?? 'editorial documentary photograph, 35mm film grain texture, professional photography, 8K ultra-detailed';
  const cameraAnchor = photo.camera_anchor ?? 'Canon R5 + 50mm prime, f/1.8, shallow depth of field';
  const moodBaseline = photo.mood_baseline ?? 'warm natural tones, film-like color grading, high contrast shadows';
  const compositionDefault = photo.composition_default ?? 'leaves negative space in one third of frame for text overlay';
  const negBank = photo.negative_prompt_bank ?? 'vintage, retro, neon, sci-fi, stock photo, text, typography, words, letters, logos, watermarks';
  const personBanned = photo.person_banned_patterns ?? 'smile-at-camera, thumbs-up, handshake, corporate-headshot, runway-pose, stiff-posing';
  const objSurfaceBanned = photo.object_surface_banned ?? 'floating, glass display, white cyclorama, sci-fi pedestal, neon-lit';
  const objLighting = photo.object_lighting ?? 'hard natural sunlight, sharp shadows, warm tones';
  const objComposition = photo.object_composition ?? 'editorial flat-lay or low-angle hero shot';

  let genderIdx = 0;
  return slides.map((s) => {
    const slide = { ...s };
    if (slide.slide_type === 'person_photo' && (!slide.person_prompt || slide.person_prompt.length < 30)) {
      const age = 20 + Math.floor(Math.random() * 16);
      const ethnicity = eth.pool.length ? pickWeighted(eth.pool, eth.weights) : 'European';
      const gender = genderIdx++ % 2 === 0 ? 'male' : 'female';
      const outfit = wardrobe.pool.length ? pickWeighted(wardrobe.pool, wardrobe.weights) : 'casual smart';
      const setting = pickRandom(settings) || 'home office';
      const timeOfDay = pickRandom(timesOfDay) || 'late afternoon natural light';
      const palette = pickRandom(palettes) || 'warm amber';
      const headlineHint = (slide.headline_text ?? '').substring(0, 60).toLowerCase();
      const action = `focused on work, natural posture, no smile, looking at ${
        headlineHint.indexOf('data') >= 0 || headlineHint.indexOf('dashboard') >= 0
          ? 'dashboard on laptop'
          : 'what they are doing'
      }`;
      slide.person_prompt = [
        styleAnchor + '.',
        `A ${age}-year-old ${ethnicity} ${gender} in ${outfit} attire, ${action}.`,
        `Setting: ${setting} during ${timeOfDay}. Palette: ${palette}.`,
        cameraAnchor + '.',
        compositionDefault + '. ' + moodBaseline + '.',
        `NEGATIVE: ${personBanned}, ${negBank}.`,
      ].join(' ');
    }
    if (slide.slide_type === 'object_photo' && (!slide.object_prompt || slide.object_prompt.length < 30)) {
      const surface = pickRandom(surfaces) || 'wood';
      slide.object_prompt = [
        styleAnchor + '.',
        `Editorial photograph of ${objectConcept || 'a relevant editorial object'} on a ${surface} surface.`,
        objLighting + '. ' + objComposition + '.',
        cameraAnchor + '. ' + compositionDefault + '. ' + moodBaseline + '.',
        `NEGATIVE: ${objSurfaceBanned}, ${negBank}.`,
      ].join(' ');
    }
    return slide;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini image generation (parallel)
// ─────────────────────────────────────────────────────────────────────────────

interface GeminiImagePart {
  inlineData?: { mimeType?: string; data?: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiImagePart[] };
  }>;
}

async function generateImage(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
        signal: AbortSignal.timeout(60_000),
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as GeminiResponse;
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const imgPart = parts.find((p) => p.inlineData?.data);
    return imgPart?.inlineData?.data ?? null;
  } catch {
    return null;
  }
}

async function generateAllPhotos(
  slides: WriterSlide[],
  apiKey: string
): Promise<Record<number, string>> {
  const jobs: Array<{ index: number; prompt: string }> = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i]!;
    if (s.slide_type === 'person_photo' && s.person_prompt) jobs.push({ index: i, prompt: s.person_prompt });
    else if (s.slide_type === 'object_photo' && s.object_prompt) jobs.push({ index: i, prompt: s.object_prompt });
  }
  if (jobs.length === 0) return {};

  const results = await Promise.allSettled(jobs.map((j) => generateImage(j.prompt, apiKey)));
  const map: Record<number, string> = {};
  for (let j = 0; j < jobs.length; j++) {
    const result = results[j];
    if (result?.status === 'fulfilled' && result.value) {
      map[jobs[j]!.index] = result.value;
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML templates — verbatim ports of production. Inline-styled.
// ─────────────────────────────────────────────────────────────────────────────

interface ThemeColors {
  RED: string;
  BLACK: string;
  CREAM: string;
  WHITE: string;
  GRAY: string;
  FOOTER_LINE: string;
}

function pickThemeColors(theme: BrandThemeForWriter, raw: Record<string, unknown>): ThemeColors {
  return {
    RED: (raw.accent_color as string) || theme.primary_color || '#F01428',
    BLACK: theme.bg_dark || '#0D0D0D',
    CREAM: (raw.body_text_color as string) || '#F5F0E8',
    WHITE: (raw.text_on_dark as string) || theme.bg_light || '#FAFAFA',
    GRAY: (raw.muted_text_color as string) || '#8A8680',
    FOOTER_LINE: (raw.footer_line as string) || 'HASHTAG AGENCIA • 2026 | ivan@hashtag.com.mx',
  };
}

function hl(text: string, accent: string, color: string): string {
  if (!accent || !text) return text;
  const idx = text.toUpperCase().indexOf(accent.toUpperCase());
  if (idx === -1) return text;
  return (
    text.substring(0, idx) +
    `<span style="color:${color};">` +
    text.substring(idx, idx + accent.length) +
    '</span>' +
    text.substring(idx + accent.length)
  );
}

function buildTypographyDark(sn: string, h: string, b: string, a: string, bgVar: 'red' | 'black', t: ThemeColors): string {
  const isR = bgVar === 'red';
  const bg = isR ? t.RED : t.BLACK;
  const tc = isR ? t.BLACK : t.WHITE;
  const ac = isR ? t.WHITE : t.RED;
  const bc = isR ? t.WHITE : t.CREAM;
  const dc = isR ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
  const fc = isR ? 'rgba(0,0,0,0.5)' : t.GRAY;
  const hh = hl(h, a, ac);
  const cv = sn === '01';
  return `<div style="width:1080px;height:1350px;background:${bg};position:relative;font-family:Bebas Neue,sans-serif;padding:54px;box-sizing:border-box;overflow:hidden;"><div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(circle,${dc} 1px,transparent 1px);background-size:8px 8px;"></div><div style="position:relative;z-index:1;height:100%;display:flex;flex-direction:column;"><div style="display:flex;justify-content:space-between;font-family:Montserrat,sans-serif;font-size:18px;color:${t.WHITE};font-weight:700;letter-spacing:3px;"><span>${sn}</span><span>HASHTAG AGENCIA</span></div><div style="flex:1;display:flex;flex-direction:column;justify-content:center;"><div style="font-size:${cv ? '120' : '100'}px;color:${tc};line-height:0.92;font-weight:400;text-transform:uppercase;margin-bottom:40px;">${hh}</div><div style="font-family:Inter,sans-serif;font-size:${cv ? '26' : '24'}px;color:${bc};line-height:1.55;max-width:92%;">${b}</div></div><div style="text-align:center;font-family:Montserrat,sans-serif;font-size:14px;color:${fc};font-weight:700;letter-spacing:2px;">${t.FOOTER_LINE}</div></div></div>`;
}

function buildTypographyLight(sn: string, h: string, b: string, a: string, t: ThemeColors): string {
  const hh = hl(h, a, t.RED);
  return `<div style="width:1080px;height:1350px;background:${t.WHITE};position:relative;font-family:Bebas Neue,sans-serif;padding:54px;box-sizing:border-box;overflow:hidden;"><div style="position:relative;z-index:1;height:100%;display:flex;flex-direction:column;"><div style="display:flex;justify-content:space-between;font-family:Montserrat,sans-serif;font-size:18px;color:${t.BLACK};font-weight:700;letter-spacing:3px;"><span>${sn}</span><span>HASHTAG AGENCIA</span></div><div style="flex:1;display:flex;flex-direction:column;justify-content:center;"><div style="font-size:110px;color:${t.BLACK};line-height:0.90;font-weight:400;text-transform:uppercase;margin-bottom:30px;">${hh}</div><div style="width:120px;height:2px;background:${t.BLACK};margin-bottom:30px;"></div><div style="font-family:Inter,sans-serif;font-size:24px;color:${t.GRAY};line-height:1.55;max-width:90%;">${b}</div></div><div style="position:absolute;bottom:120px;right:54px;font-size:32px;color:${t.BLACK};">&rarr;</div><div style="text-align:center;font-family:Montserrat,sans-serif;font-size:14px;color:${t.GRAY};font-weight:700;letter-spacing:2px;">${t.FOOTER_LINE}</div></div></div>`;
}

function buildPersonPhoto(sn: string, h: string, b: string, a: string, imgB64: string, t: ThemeColors): string {
  const hh = hl(h, a, t.RED);
  const img = imgB64
    ? `<img src="data:image/png;base64,${imgB64}" style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;"/>`
    : `<div style="position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);"></div>`;
  return `<div style="width:1080px;height:1350px;position:relative;font-family:Bebas Neue,sans-serif;overflow:hidden;background:${t.BLACK};">${img}<div style="position:absolute;bottom:0;left:0;right:0;height:60%;background:linear-gradient(transparent 0%,rgba(0,0,0,0.75) 50%,rgba(0,0,0,0.92) 100%);"></div><div style="position:absolute;top:54px;left:54px;right:54px;display:flex;justify-content:space-between;font-family:Montserrat,sans-serif;font-size:18px;color:${t.WHITE};font-weight:700;letter-spacing:3px;z-index:2;"><span>${sn}</span><span>HASHTAG AGENCIA</span></div><div style="position:absolute;bottom:100px;left:54px;right:54px;z-index:2;"><div style="font-size:80px;color:${t.WHITE};line-height:0.92;font-weight:400;text-transform:uppercase;margin-bottom:20px;">${hh}</div><div style="font-family:Inter,sans-serif;font-size:22px;color:${t.CREAM};line-height:1.55;max-width:90%;">${b}</div></div><div style="position:absolute;bottom:40px;left:0;right:0;text-align:center;font-family:Montserrat,sans-serif;font-size:14px;color:${t.GRAY};font-weight:700;letter-spacing:2px;z-index:2;">${t.FOOTER_LINE}</div></div>`;
}

function buildObjectPhoto(sn: string, h: string, b: string, a: string, imgB64: string, t: ThemeColors): string {
  const hh = hl(h, a, t.RED);
  const img = imgB64
    ? `<img src="data:image/png;base64,${imgB64}" style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;"/>`
    : `<div style="position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg,#2d1b69,#11001c);"></div>`;
  return `<div style="width:1080px;height:1350px;position:relative;font-family:Bebas Neue,sans-serif;overflow:hidden;background:${t.BLACK};">${img}<div style="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.35);"></div><div style="position:absolute;bottom:0;left:0;right:0;height:55%;background:linear-gradient(transparent,rgba(0,0,0,0.88));"></div><div style="position:absolute;top:54px;left:54px;right:54px;display:flex;justify-content:space-between;font-family:Montserrat,sans-serif;font-size:18px;color:${t.WHITE};font-weight:700;letter-spacing:3px;z-index:2;"><span>${sn}</span><span>HASHTAG AGENCIA</span></div><div style="position:absolute;bottom:100px;left:54px;right:54px;z-index:2;"><div style="font-size:90px;color:${t.WHITE};line-height:0.92;font-weight:400;text-transform:uppercase;margin-bottom:24px;">${hh}</div><div style="font-family:Inter,sans-serif;font-size:22px;color:${t.CREAM};line-height:1.55;max-width:88%;">${b}</div></div><div style="position:absolute;bottom:40px;left:0;right:0;text-align:center;font-family:Montserrat,sans-serif;font-size:14px;color:${t.GRAY};font-weight:700;letter-spacing:2px;z-index:2;">${t.FOOTER_LINE}</div></div>`;
}

function buildDataCard(
  sn: string,
  h: string,
  a: string,
  items: Array<{ number: string; label: string }>,
  t: ThemeColors
): string {
  const hh = hl(h, a, t.RED);
  const cards = items
    .map((item, i) => {
      const isEven = i % 2 === 0;
      return `<div style="background:${isEven ? t.BLACK : t.RED};border-radius:16px;padding:36px 32px;display:flex;flex-direction:column;gap:8px;"><div style="font-family:Bebas Neue,sans-serif;font-size:72px;color:${isEven ? t.RED : t.WHITE};line-height:1;">${item.number}</div><div style="font-family:Inter,sans-serif;font-size:18px;color:${isEven ? t.CREAM : t.WHITE};line-height:1.4;font-weight:500;">${item.label}</div></div>`;
    })
    .join('');
  return `<div style="width:1080px;height:1350px;background:${t.WHITE};position:relative;font-family:Bebas Neue,sans-serif;padding:54px;box-sizing:border-box;overflow:hidden;"><div style="position:relative;z-index:1;height:100%;display:flex;flex-direction:column;"><div style="display:flex;justify-content:space-between;font-family:Montserrat,sans-serif;font-size:18px;color:${t.BLACK};font-weight:700;letter-spacing:3px;"><span>${sn}</span><span>HASHTAG AGENCIA</span></div><div style="margin-top:60px;font-size:72px;color:${t.BLACK};line-height:0.92;text-transform:uppercase;margin-bottom:40px;">${hh}</div><div style="width:80px;height:3px;background:${t.RED};margin-bottom:40px;"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;flex:1;align-content:start;">${cards}</div><div style="text-align:center;font-family:Montserrat,sans-serif;font-size:14px;color:${t.GRAY};font-weight:700;letter-spacing:2px;margin-top:20px;">${t.FOOTER_LINE}</div></div></div>`;
}

function buildClosingCta(ctaText: string, t: ThemeColors): string {
  return `<div style="width:1080px;height:1350px;background:${t.BLACK};position:relative;font-family:Bebas Neue,sans-serif;box-sizing:border-box;overflow:hidden;"><div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(circle,rgba(255,255,255,0.04) 1px,transparent 1px);background-size:8px 8px;"></div><div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:600px;color:rgba(255,255,255,0.03);font-weight:400;line-height:1;pointer-events:none;">#</div><div style="position:relative;z-index:1;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;"><div style="font-size:110px;color:${t.WHITE};line-height:0.95;font-weight:400;text-transform:uppercase;text-align:center;">HASHTAG <span style="color:${t.RED};">AGENCIA</span></div><div style="margin-top:8px;font-family:Montserrat,sans-serif;font-size:22px;color:${t.GRAY};font-weight:700;letter-spacing:4px;text-align:center;">2026</div><div style="margin-top:50px;width:80px;height:2px;background:${t.RED};"></div><div style="margin-top:30px;font-family:Montserrat,sans-serif;font-size:22px;color:${t.CREAM};font-weight:700;letter-spacing:2px;text-align:center;">${ctaText || 'Conoce M&aacute;s'}</div><div style="margin-top:24px;font-family:Inter,sans-serif;font-size:18px;color:${t.GRAY};text-align:center;">Hashtag Agencia | Ivan Sierra</div><div style="margin-top:8px;font-family:Inter,sans-serif;font-size:18px;color:${t.GRAY};text-align:center;">ivan@hashtag.com.mx</div></div></div>`;
}

const CSS_IMPORT = "@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;700&family=Montserrat:wght@400;700;900&display=swap');";

function buildSlideHtml(
  slide: WriterSlide,
  index: number,
  allSlides: WriterSlide[],
  imageMap: Record<number, string>,
  t: ThemeColors
): string {
  const sn = String(index + 1).padStart(2, '0');
  const h = (slide.headline_text ?? '').toUpperCase();
  const b = slide.body_text ?? '';
  const a = (slide.accent_text ?? '').toUpperCase();
  const imgB64 = imageMap[index] ?? '';

  switch (slide.slide_type) {
    case 'typography_dark': {
      const darkIdx = allSlides.slice(0, index).filter((s) => s.slide_type === 'typography_dark').length;
      const bgVar = darkIdx % 2 === 0 ? 'black' : 'red';
      return buildTypographyDark(sn, h, b, a, bgVar, t);
    }
    case 'typography_light':
      return buildTypographyLight(sn, h, b, a, t);
    case 'person_photo':
      return buildPersonPhoto(sn, h, b, a, imgB64, t);
    case 'object_photo':
      return buildObjectPhoto(sn, h, b, a, imgB64, t);
    case 'data_card':
      return buildDataCard(sn, h, a, slide.data_items ?? [], t);
    case 'closing_cta':
      return buildClosingCta(slide.cta_text ?? '', t);
    default:
      return buildTypographyDark(sn, h, b, a, 'black', t);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HCTI render
// ─────────────────────────────────────────────────────────────────────────────

interface HctiResponse {
  url?: string;
  ok?: boolean;
  error?: string;
}

async function renderHtmlToPng(
  html: string,
  hctiUserId: string,
  hctiApiKey: string
): Promise<Uint8Array> {
  const auth = Buffer.from(`${hctiUserId}:${hctiApiKey}`).toString('base64');
  const res = await fetch('https://hcti.io/v1/image', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html,
      css: CSS_IMPORT,
      google_fonts: 'Bebas Neue|Inter:wght@400;500;700|Montserrat:wght@400;700;900',
      viewport_width: 1080,
      viewport_height: 1350,
      device_scale: 2,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`hcti_render: HTTP ${res.status} ${text.substring(0, 300)}`);
  }
  const json = (await res.json()) as HctiResponse;
  if (!json.url) throw new Error(`hcti_render: response missing url: ${JSON.stringify(json).substring(0, 300)}`);

  // HCTI returns a CDN URL — download the PNG bytes so we can re-upload to our own bucket.
  const dl = await fetch(json.url, { signal: AbortSignal.timeout(30_000) });
  if (!dl.ok) throw new Error(`hcti_download: HTTP ${dl.status}`);
  return new Uint8Array(await dl.arrayBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase Storage upload
// ─────────────────────────────────────────────────────────────────────────────

async function uploadSlide(
  bytes: Uint8Array,
  bucket: string,
  path: string
): Promise<string> {
  const env = loadEnv();
  const url = `${env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: bytes,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`supabase_upload: HTTP ${res.status} ${text.substring(0, 300)}`);
  }
  return `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level runDesigner
// ─────────────────────────────────────────────────────────────────────────────

export async function runDesigner(params: RunDesignerParams): Promise<DesignerResult> {
  const env = loadEnv();
  const cp = params.context_package;
  const draft = params.draft;

  // Read raw photo + theme rows from brand_identity (some fields aren't typed in BrandThemeForWriter).
  // We pass them through to pickThemeColors which reaches into the raw object for accent_color etc.
  const brandIdentity = await loadBrandIdentity(params.brand_id);
  const photoRaw = (brandIdentity.photo as PhotoConfig | undefined) ?? {};
  const themeRaw = ((brandIdentity.themes as Record<string, unknown>[] | undefined) ?? [])[0] ?? {};
  const themeColors = pickThemeColors(cp.brand_theme, themeRaw);

  // Step 1: enrich photo slide prompts (deterministic, port of n8n)
  const enrichedSlides = enrichPhotoSlides(draft.slides, photoRaw, cp.strategy.object_concept);

  // Step 2: generate images in parallel for photo slides
  const imageMap = await generateAllPhotos(enrichedSlides, env.GEMINI_API_KEY);

  // Step 3: render + upload each slide. Sequential to avoid HCTI rate-limit surprises.
  // Per-slide error isolation — one failure shouldn't kill the whole carousel.
  const failures: DesignerResult['failures'] = [];
  const renderedSlides: WriterSlide[] = [];
  for (let i = 0; i < enrichedSlides.length; i++) {
    const slide = enrichedSlides[i]!;
    const slideNumber = slide.slide_number ?? i + 1;
    try {
      const html = buildSlideHtml(slide, i, enrichedSlides, imageMap, themeColors);
      const pngBytes = await renderHtmlToPng(html, env.HCTI_USER_ID, env.HCTI_API_KEY);
      const sn = String(slideNumber).padStart(2, '0');
      const path = `${params.brand_slug}/${params.post_queue_id}/slide-${sn}.png`;
      const publicUrl = await uploadSlide(pngBytes, env.MVP_CONTENT_BUCKET, path);
      renderedSlides.push({ ...slide, url: publicUrl } as WriterSlide & { url: string });
    } catch (err) {
      const reason = (err as Error).message.substring(0, 200);
      failures.push({ slide_number: slideNumber, reason });
      Sentry.captureException(err, {
        tags: {
          source: 'runDesigner',
          brand_slug: params.brand_slug,
          post_queue_id: params.post_queue_id,
          slide_type: slide.slide_type,
        },
      });
      // Push the slide WITHOUT a url so downstream knows it's missing.
      renderedSlides.push({ ...slide });
    }
  }

  return {
    draft: { ...draft, slides: renderedSlides },
    slides_rendered: renderedSlides.filter((s) => (s as WriterSlide & { url?: string }).url).length,
    slides_failed: failures.length,
    failures,
  };
}

async function loadBrandIdentity(brandId: string): Promise<BrandIdentity> {
  const { data, error } = await getAdminClient()
    .from('brand_configs')
    .select('brand_identity')
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) throw new Error(`runDesigner: load brand_identity: ${error.message}`);
  return ((data as { brand_identity: BrandIdentity } | null)?.brand_identity ?? {}) as BrandIdentity;
}

# Ahimsa Site — Context for the Mobile App Coding Agent

This repo (`ahimsa-site`) is the companion web project to the **Ahimsa mobile app** (Bulgarian-language guided meditation app, iOS + Android). It is **not** the mobile app repo — it contains the marketing website, the blog, and — most importantly for you — the **admin panel that manages the mobile app's content and reads its analytics**.

## Repo layout

| Path | What it is |
| --- | --- |
| `index.html`, `assets/`, `style.css`, `policy*.html`, `support.html`, `mobile-redirect.html` | Static marketing site at https://ahimsaapp.com (Bulgarian, SEO/OpenGraph/structured data, app store links) |
| `scripts/build.mjs` | Site build → `dist/` |
| `scripts/build-blog.mjs` + `cms/` | Blog: posts authored in a Sanity studio (`cms/`), statically generated into `dist/blog/` at build time |
| `admin/` | **The admin panel** — React SPA served at https://ahimsaapp.com/admin/ |
| `admin/supabase/` | SQL migrations / RLS policies + the `r2-presign` edge function source |
| `wrangler.jsonc`, `dist/` | Everything is deployed together as static assets on Cloudflare Workers (`npm run build` → `wrangler deploy`) |

## The admin panel (`admin/`)

React 18 + TypeScript + Vite SPA (`@supabase/supabase-js`, react-router HashRouter, `@dnd-kit` for drag-and-drop, `recharts` for charts). Built output goes to `dist/admin/`, base path `/admin/`.

### Features

- **Auth** — Supabase email/password login. An `admins` table (email, optional `category` scope) decides access:
  - **Full admin** (no category scope): everything, including category deletion.
  - **Category-scoped admin**: can manage entries but is restricted (e.g. delete only within their category per RLS).
  - Includes password-recovery / set-password flow.
- **Entries management** (`EntriesPage`, `EntryFormPage`) — CRUD for meditation tracks. Fields: `title`, `author`, `category`, `video_category`, `free` (paid toggle), `number` (manual ordering), `media_type` (`audio` \| `video`), `image_url`, `audio_url`, `video_url`, `created_by` (audit = admin email). Drag-and-drop reordering within a category persists `number`.
- **Categories** (`CategoriesPage`) — manages `category_order` (`name`, `display_order`, `type` audio/video) with drag-and-drop. Controls section order on Home/Library in the app.
- **Banner management** (`BannerPage`) — edits `banner_config` rows: guest banner (id 1) and subscriber banner (id 2). Title/subtitle, gradient or solid background, text color, uploaded images (regular + large), action (`paywall` | `link` | `none`), action link (internal route), optional category/entry targeting. This is the promo banner the mobile app renders.
- **Analytics** (`AnalyticsPage`) — reads `playback_events` (raw rows written by the mobile app: heartbeats, seeks, pauses, completes with `position_seconds`, `playback_rate`, foreground flag, platform, device, tier). All aggregation (watch-time seconds, sessions, top entries/authors/categories) is done client-side in TypeScript; charts shown per day/week/month.

## Shared Supabase (same project as the mobile app!)

| Key | Value |
| --- | --- |
| Project URL | `https://zskpabenylubupwvaavh.supabase.co` |
| Project ref | `zskpabenylubupwvaavh` |
| Region | EU Central (Frankfurt) |

Tables: `entries`, `category_order`, `profiles` (read-only for admin; written by the mobile app), `playback_events` (written by the mobile app), `admins`, `banner_config`. Edge functions: `r2-presign` (admin uploads) and `delete-user` (mobile app self-service account deletion).

**The mobile app reads `entries` + `category_order` + `banner_config` and writes `profiles` + `playback_events`. The admin panel does the reverse. Schema changes here affect the mobile app — treat the table/column contract as shared and additive-only.**

## Media pipeline (important)

- Media files live in **Cloudflare R2**, bucket `ahimsa-media`, served publicly from `https://media.ahimsaapp.com` with prefixes:
  - Images: `https://media.ahimsaapp.com/images/<key>`
  - Audio: `https://media.ahimsaapp.com/audio/<key>`
  - Videos: `https://media.ahimsaapp.com/videos/<key>`
- **The database stores object keys only** (e.g. `intro-1.mp3`, `covers/x.jpg`) — never full URLs. Both apps construct URLs from keys (`admin/src/lib/media.ts`).
- Admin uploads flow: browser → `r2-presign` Supabase Edge Function (auth: admin user's JWT; returns presigned PUT URL + key) → direct PUT to R2 → key saved to DB. Legacy private Supabase Storage buckets (`images`, `audio`, `videos`) still exist; a migration script in the mobile app repo syncs them to R2.
- Admin env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MEDIA_BASE_URL`, `VITE_R2_PRESIGN_URL` (see `admin/.env.example`).

## RLS model

Mobile app uses the anon key with per-user RLS. Admin panel uses the **anon key + admin user JWT**, with policies in `admin/supabase/*.sql`:

- `admins` membership (email match) gates writes to `entries`, `category_order`, `banner_config`, storage buckets, and reads of `playback_events`.
- `entries` insert requires `created_by` = caller email.
- Guest/user read policies on `entries` / `category_order` are untouched — don't loosen or tighten them without checking both apps.

## Conventions / gotchas

- The mobile app **polls for content every ~5 minutes** — admin changes appear in-app without any push mechanism.
- Entry sort contract (client-side, both apps): within a category, by `number` asc → entries with `number` first → then `free` before locked.
- `entries.audio_url` is NOT NULL even for video entries (kept for backward compat).
- The app UI language is Bulgarian; the admin panel UI is English.
- Build/deploy from repo root: `npm run build` (site + blog + admin) then `npm run deploy` (wrangler). Admin dev: `npm --prefix admin run dev`; CMS studio: `npm run cms:dev`.
- Reference docs worth reading if you need schema detail: `admin/SUPABASE_SETUP.md` (full data model), `admin/ADMIN_PANEL_PROMPT.md` (R2/video migration rationale), `admin/supabase-watch-analytics-agent-prompt.md` (analytics spec).

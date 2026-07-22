# Supabase Data Model & Setup Reference

This document describes the existing Supabase project that backs the Ahimsa
mobile app, so an admin panel can be built to manage its content.

The Supabase project **already exists and is populated**. The admin panel does
NOT need to create a new database — it needs to connect to this one and build
CRUD interfaces against the tables/buckets described below.

---

## 1. Project connection

| Key | Value |
| --- | --- |
| Project URL | `https://zskpabenylubupwvaavh.supabase.co` |
| Project ref | `zskpabenylubupwvaavh` |
| Anon key | (in `.env` as `SUPABASE_ANON_KEY`) |
| DB host (pooler) | `aws-0-eu-central-1.pooler.supabase.com` |
| DB connection string | `postgresql://postgres.zskpabenylubupwvaavh@aws-0-eu-central-1.pooler.supabase.com:5432/postgres` |
| Region | EU Central (Frankfurt) |

### Keys the admin panel needs

The mobile app uses the **anon key** (with per-user RLS via the user's auth
session). An admin panel is different: it must act with elevated privileges to
manage content owned by no single user. Two options:

1. **Recommended: service role key.** Add `SUPABASE_SERVICE_ROLE_KEY` to the
   admin panel's env. The service role bypasses Row Level Security entirely, so
   admin CRUD "just works" without extra policies. **Never expose this key in
   the browser/client bundle** — keep it on a server route / API route / server
   action. If the admin panel is a server-rendered app (Next.js server
   components, Nuxt server routes, etc.), use it there only.
2. **Alternative: anon key + RLS policies** that allow content writes for users
   in an `admins` table / `is_admin` flag. More setup, safer if the panel must
   run fully client-side, but requires writing policies.

For a typical admin panel, go with option 1 and keep all Supabase calls server-side.

---

## 2. Storage buckets

Two **private** storage buckets hold the media. The mobile app never uses raw
public URLs — it calls `createSignedUrl(path, 3600)` to get a 1-hour signed URL.

| Bucket | Purpose | Stored as |
| --- | --- | --- |
| `images` | Cover artwork for entries | the `image_url` column holds the **path inside the bucket** (e.g. `my-entry.jpg`), NOT a full URL |
| `audio` | Meditation audio files | the `audio_url` column holds the **path inside the bucket** (e.g. `my-entry.mp3`), NOT a full URL |

### Admin panel implications

- When creating/editing an entry, upload the file to the correct bucket and
  store only the **bucket-relative path** in `image_url` / `audio_url`.
- To preview an image or play audio in the admin panel, generate a signed URL
  from the path (`supabase.storage.from('images').createSignedUrl(path, 3600)`),
  or a public URL if you flip a bucket to public.
- Subfolders inside a bucket are fine (e.g. `entries/intro-1.jpg`); the path
  stored in the column must match exactly what was uploaded.

---

## 3. Tables

### 3.1 `entries`  (the content the admin panel manages)

One row = one meditation track shown in the app.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `bigint` (int8) identity | NO | auto-increment | Primary key. App references entries by this id everywhere (`/player?id=…`, `recently_played`, `favorite`). Do not reuse ids after delete. |
| `title` | `text` | NO | — | Displayed on cards, rows, player, lock screen. |
| `author` | `text` | YES | — | Shown under the title in the player and row. Omitted in UI if empty. |
| `image_url` | `text` | NO | — | Path inside the `images` storage bucket (NOT a full URL). |
| `audio_url` | `text` | NO | — | Path inside the `audio` storage bucket (NOT a full URL). |
| `category` | `text` | YES | — | Groups entries into sections on Home/Library. Must match a `name` in `category_order` to be ordered correctly; otherwise it sorts to the end. |
| `free` | `boolean` | NO | `false` | `true` = playable by everyone; `false` = requires an active subscription (locked with a lock icon). |
| `number` | `int4` | YES | — | Optional manual ordering within a category. When present, the app sorts entries ascending by `number`; entries without `number` fall after, sorted free-first. |
| `created_at` | `timestamptz` | YES | `now()` | Not read by the app; useful for admin sorting. |

#### How the app reads entries

```ts
supabase.from("entries").select("*, free");
```

The app fetches **all** entries (no server-side filter) and groups/sorts them
client-side by `category` and `number`. Free entries are shown before paid ones
within a category when `number` is absent.

#### Sort behavior to preserve (client logic)

Within a category, the app sorts:
1. By `number` ascending (if both entries have `number`).
2. Entries with `number` come before entries without.
3. Otherwise: `free` entries first, then locked.

#### Admin CRUD notes

- **Create**: upload image → `images` bucket, upload audio → `audio` bucket,
  then insert row with the bucket-relative paths.
- **Update**: if the image/audio changes, upload the new file and update the
  path; optionally delete the old file from storage to avoid orphans.
- **Delete**: delete the row, then delete its files from `images` and `audio`
  buckets. Also consider that `profiles.recently_played` / `profiles.favorite`
  may still reference the deleted id (harmless — the app just won't find the
  entry — but you may want to clean up).
- The app polls for fresh content every 5 minutes, so admin changes appear in
  the app within ~5 minutes with no extra push logic.

### 3.2 `category_order`  (managed by the admin panel)

Controls the order categories appear on Home and in the Library.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| `name` | `text` | NO | — | Unique. Must match the `category` value used on `entries` rows. |
| `display_order` | `int4` | NO | — | Ascending sort key. |

#### How the app reads it

```ts
supabase
  .from("category_order")
  .select("name, display_order")
  .order("display_order", { ascending: true });
```

Categories that exist on `entries` but are missing from `category_order` are
shown after all ordered categories. The app has a hardcoded fallback order
(`Въведение`, `Енергийни центрове`, `Метта любов`, `Сенсей Весела Велин`,
`Въведение за деца`, `Приказни медитации за деца`) used only when this table is
empty — in practice the table drives ordering.

#### Admin CRUD notes

- Reordering = update `display_order` values (a drag-and-drop reorderer that
  reassigns sequential integers is the typical UX).
- When adding a category, insert a row here AND make sure at least one entry
  uses that `category` string, otherwise it shows with a count of 0.

### 3.3 `profiles`  (user data — read-only / analytics for the admin panel)

Per-user progress and preferences. Created lazily by the mobile app via upsert
when a logged-in user first plays/favorites/shares. **The admin panel should
generally not write to this table.**

| Column | Type | Nullable | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NO | Primary key. Equals `auth.users.id`. |
| `recently_played` | `int8[]` | YES | Array of entry ids, most-recent at the end (app keeps max 20). |
| `favorite` | `int8[]` | YES | Array of favorited entry ids. |
| `meditation_sessions` | `jsonb` | YES | Array of session objects (see shape below). |
| `shares_count` | `int4` | YES | Default 0. Used for the "Споделена енергия" badge (≥3). |
| `updated_at` | `timestamptz` | YES | Set by the app on each upsert. |

`meditation_sessions` element shape (JSONB):

```jsonc
{
  "id": 12,                 // entry id (bigint)
  "middleReached": true,    // count for streaks/badges
  "completed": true,        // count for the "Дисциплина" badge (10 completions)
  "datePlayed": "2026-07-22" // YYYY-MM-DD
}
```

#### How the app reads/writes it

```ts
// read
supabase
  .from("profiles")
  .select("recently_played, favorite, meditation_sessions, shares_count")
  .eq("id", session.user.id)
  .single();

// write (upsert — creates the row if missing)
supabase.from("profiles").upsert({
  id: session.user.id,
  recently_played: [...],
  favorite: [...],
  meditation_sessions: [...],
  shares_count: N,
  updated_at: new Date(),
});
```

#### Admin notes

- Useful for a read-only "users" / "analytics" view (counts of users, popular
  entries via `recently_played`, completion stats, etc.).
- Profile rows may not exist for every `auth.users` row (lazy creation), so
  join with `auth.users` carefully (use a left join and tolerate nulls).
- To truly delete a user, use the `delete-user` edge function (section 5), not
  a simple row delete — it removes the `auth.users` record too.

---

## 4. Row Level Security (RLS)

The mobile app relies on RLS via the user's auth session. The exact policies
live in the Supabase dashboard; the observed behavior is:

- `entries` and `category_order`: readable by everyone (anon + authenticated),
  because guests can browse content. Writes are admin-only (the app never
  writes to these).
- `profiles`: a user can read/update only their own row (`id = auth.uid()`).

For the admin panel, the simplest path is to use the **service role key** in
server-side code (bypasses RLS entirely). If you instead use the anon key, you
will need to add admin-specific policies (e.g. allow writes when
`auth.jwt() ->> 'is_admin' = 'true'` or when the user's id exists in an `admins`
table) — do NOT loosen the existing guest/user read policies.

---

## 5. Edge function: `delete-user`

Deployed function at `https://zskpabenylubupwvaavh.supabase.co/functions/v1/delete-user`.

- **Method:** `POST`
- **Auth:** `Authorization: Bearer <user_access_token>` — the function verifies
  the caller and deletes only their own auth account.
- **Body:** none.
- **Effect:** deletes the user from `auth.users` via the admin API. It does
  **not** currently delete their `profiles` row (the `profiles` row becomes
  orphaned). Source: `supabase/functions/delete-user/index.ts`.

Admin panel relevance: if the admin panel offers "delete user", prefer calling
this function with the user's own token, OR perform the equivalent server-side
with the service role key (`supabase.auth.admin.deleteUser(id)`) and also delete
their `profiles` row.

---

## 6. Reference SQL (reflects the existing schema)

Use this to understand exact types / to recreate in a fresh project. Verify
against the live dashboard before relying on it.

```sql
-- entries -------------------------------------------------------------
create table public.entries (
  id          bigint generated by default as identity primary key,
  title       text not null,
  author      text,
  image_url   text not null,          -- path inside the "images" bucket
  audio_url   text not null,          -- path inside the "audio" bucket
  category    text,
  free        boolean not null default false,
  number      int4,
  created_at  timestamptz default now()
);

-- category_order ------------------------------------------------------
create table public.category_order (
  name          text primary key,
  display_order int4 not null
);

-- profiles ------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  recently_played      bigint[] default '{}',
  favorite             bigint[] default '{}',
  meditation_sessions  jsonb    default '[]',
  shares_count         int4     default 0,
  updated_at           timestamptz
);
```

Storage buckets (create via dashboard or SQL):

```sql
insert into storage.buckets (id, name, public) values
  ('images', 'images', false),
  ('audio',  'audio',  false);
```

---

## 7. Suggested admin panel feature set

Based on the model above, the admin panel should provide:

1. **Entries list** — table with columns: id, title, author, category, free,
   number, created_at. Filter by category, search by title. Inline toggle for
   `free`. Click to edit.
2. **Entry create/edit form** — title, author, category (select from
   `category_order`, with "add new category" option), free (checkbox), number
   (optional int), image upload (→ `images` bucket), audio upload (→ `audio`
   bucket). Show image/audio preview via signed URL.
3. **Category ordering** — drag-and-drop list of `category_order` rows that
   rewrites `display_order` on drop.
4. **Storage browser** (optional) — list/delete orphaned files in `images` and
   `audio`.
5. **Users / analytics** (optional, read-only) — list `auth.users` joined to
   `profiles`, showing favorites count, sessions count, shares, last active.
6. **Delete user** (optional) — calls `delete-user` or the service-role
   equivalent plus `profiles` cleanup.

---

## 8. Env vars for the admin panel

```
SUPABASE_URL=https://zskpabenylubupwvaavh.supabase.co
SUPABASE_ANON_KEY=...        # already copied over
SUPABASE_SERVICE_ROLE_KEY=... # ADD THIS — required for admin CRUD server-side
```

Only `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are needed for a server-side
admin panel. Keep the service role key off the client.

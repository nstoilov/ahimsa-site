# r2-presign Edge Function

Presigns R2 (S3-compatible) PUT URLs so the admin panel can upload new cover
images, audio, and video **directly to R2** from the browser. R2 S3 credentials
never reach the client — only a short-lived presigned URL is returned.

## How it works

1. Admin panel (`admin/src/lib/r2upload.ts`) gets the current Supabase session JWT.
2. POSTs `{ kind, filename, contentType }` to this function with
   `Authorization: Bearer <jwt>`.
3. The function verifies the caller's email is in `public.admins` (via RLS using
   the caller's own JWT) — non-admins get 403.
4. The function builds a full-prefixed key `"<kind>/<timestamp>-<sanitized>"` and
   signs an S3 SigV4 **presigned PUT** URL (aws4fetch) against the R2 S3 endpoint.
5. Returns `{ uploadUrl, key }`. The browser PUTs the file bytes straight to R2.
6. The object key is stored in `entries.image_url` / `entries.audio_url` /
   `entries.video_url`; media is displayed via `https://media.ahimsaapp.com/<key>`.

No DELETE endpoint — when a file is replaced on edit, the old R2 object is left
as an orphan (cleanup can be done separately if needed).

## Deploy

From the repo root (Supabase CLI):

```bash
# 1. set R2 secrets (values are in admin/.env.functions, gitignored)
supabase functions deploy r2-presign --project-ref zskpabenylubupwvaavh

# 2. set secrets (run once; re-run if values change)
supabase secrets set --project-ref zskpabenylubupwvaavh --env-file admin/.env.functions
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are auto-injected into the function
runtime; only the `R2_*` secrets need to be set.

## R2 bucket CORS (REQUIRED for browser uploads)

The browser PUT goes cross-origin to `https://<account>.r2.cloudflarestorage.com`,
so the bucket must allow PUTs from the admin panel origin(s). Edit
`cors.json` (add/remove origins as needed) and apply it with the `set`
subcommand (note: `put` is not a valid wrangler subcommand — use `set`):

```bash
# from repo root (Cloudflare account already linked at root wrangler.jsonc):
npx wrangler r2 bucket cors set ahimsa-media --file admin/supabase/functions/r2-presign/cors.json

# verify it applied:
npx wrangler r2 bucket cors list ahimsa-media

# or apply via the Cloudflare dashboard: R2 > ahimsa-media > Settings > CORS policy
```

The `cors.json` file uses the Cloudflare R2 native shape — a top-level
`{ "rules": [...] }` object where each rule is
`{ "allowed": { "origins", "methods", "headers" }, "exposeHeaders", "maxAgeSeconds" }`
(see https://developers.cloudflare.com/api/operations/r2-put-bucket-cors-policy).
It lists the admin origins (`https://ahimsaapp.com`, `https://www.ahimsaapp.com`,
`http://localhost:5173`–`5175` for dev). `methods: ["PUT"]` only — media display uses
`<img>`/`<audio>`/`<video>` tags which don't trigger CORS preflight; add `"GET"`
if you later fetch media via `fetch()`. Adjust the origins to match where the
admin panel is actually served, then apply.

## Env vars summary

| Var | Lives in | Why |
| --- | --- | --- |
| `VITE_MEDIA_BASE_URL` | admin/.env.local (client bundle, public) | Build public read URLs |
| `VITE_R2_PRESIGN_URL` | admin/.env.local (client bundle, public) | Where to request presigns |
| `R2_ACCOUNT_ID` | Supabase Edge Function secrets | Secret — server-side only |
| `R2_ACCESS_KEY_ID` | Supabase Edge Function secrets | Secret — server-side only |
| `R2_SECRET_ACCESS_KEY` | Supabase Edge Function secrets | Secret — server-side only |
| `R2_BUCKET` | Supabase Edge Function secrets | `ahimsa-media` |
| `R2_REGION` | Supabase Edge Function secrets | `auto` |
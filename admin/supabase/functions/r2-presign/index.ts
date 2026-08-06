// Supabase Edge Function: presign R2 PUT URLs for the admin panel.
//
// Auth: caller must send `Authorization: Bearer <supabase access_token>`; the
// caller's email must be present in `public.admins` (verified via RLS).
//
// Body: { kind: "images" | "audio" | "videos", filename: string, contentType?: string }
// Returns: { uploadUrl: string, key: string } where `key` is the UNPREFIXED
// object key (e.g. "1700000000-intro.mp4") to store in the DB. The URL builder
// (admin/src/lib/media.ts) adds the kind prefix when constructing the public
// read URL; the file itself is PUT to "<kind>/<key>" in R2 so it lands under
// the images/, audio/, or videos/ folder that the custom domain serves.
//
// The browser then PUTs the file bytes directly to `uploadUrl`. R2 S3 creds
// stay server-side; only a short-lived presigned URL is returned.
//
// Required secrets (set via `supabase secrets set`):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_REGION
// SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically by Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.17'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const ALLOWED_KINDS = new Set(['images', 'audio', 'videos'])

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function isAdmin(supabaseUrl: string, anonKey: string, jwt: string): Promise<boolean> {
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data, error } = await sb.from('admins').select('email').maybeSingle()
  if (error) return false
  return !!data
}

async function presignR2Put(
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  region: string,
  key: string,
  expiresIn: number,
): Promise<string> {
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`
  // X-Amz-Expires must be set on the URL before signing; aws4fetch's S3 default
  // is 86400s if unset. signQuery:true puts the signature in the query string
  // (presigned URL) instead of an Authorization header.
  const objectUrl = `${endpoint}/${bucket}/${key}?X-Amz-Expires=${expiresIn}`
  const aws = new AwsClient({ accessKeyId, secretAccessKey, region, service: 's3' })
  const signed = await aws.sign(objectUrl, { method: 'PUT', aws: { signQuery: true } })
  return signed instanceof Request ? signed.url : String(signed)
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const auth = req.headers.get('authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }
  const jwt = auth.slice(7).trim()

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    return json({ error: 'Server misconfigured (SUPABASE_URL/ANON_KEY)' }, 500)
  }

  const accountId = Deno.env.get('R2_ACCOUNT_ID')
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')
  const bucket = Deno.env.get('R2_BUCKET') || 'ahimsa-media'
  const region = Deno.env.get('R2_REGION') || 'auto'
  if (!accountId || !accessKeyId || !secretAccessKey) {
    return json({ error: 'R2 credentials not configured' }, 500)
  }

  let body: { kind?: string; filename?: string; contentType?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const kind = body.kind ?? ''
  if (!ALLOWED_KINDS.has(kind)) {
    return json({ error: 'Invalid kind (expected images|audio|videos)' }, 400)
  }
  const filename = body.filename ?? ''
  if (!filename) {
    return json({ error: 'filename required' }, 400)
  }

  // Gate on admin role using the caller's own JWT (RLS self-read on admins).
  if (!(await isAdmin(supabaseUrl, anonKey, jwt))) {
    return json({ error: 'Forbidden: admin only' }, 403)
  }

  const stamp = Date.now()
  const safeName = sanitizeFileName(filename) || `upload-${stamp}`
  const rawKey = `${stamp}-${safeName}` // unprefixed DB key (e.g. "1700000000-intro.mp4")
  const r2Key = `${kind}/${rawKey}` // prefixed R2 path (e.g. "videos/1700000000-intro.mp4")

  const uploadUrl = await presignR2Put(
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    region,
    r2Key,
    900, // 15 minutes
  )

  return json({ uploadUrl, key: rawKey })
})
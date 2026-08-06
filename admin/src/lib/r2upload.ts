import { supabase } from './supabase'

export type MediaKind = 'images' | 'audio' | 'videos'

const PRESIGN_URL = import.meta.env.VITE_R2_PRESIGN_URL as string | undefined

/**
 * Presign an R2 PUT URL via the admin Edge Function, then PUT the file bytes
 * directly to R2. Returns the full-prefixed object key (e.g. "videos/123-x.mp4")
 * to store in the entries row.
 */
export async function presignAndUpload(kind: MediaKind, file: File): Promise<string> {
  if (!PRESIGN_URL) {
    throw new Error('Missing VITE_R2_PRESIGN_URL — cannot upload to R2.')
  }

  const { data } = await supabase.auth.getSession()
  const accessToken = data?.session?.access_token
  if (!accessToken) {
    throw new Error('Not authenticated.')
  }

  const res = await fetch(PRESIGN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      kind,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Presign failed (${res.status}): ${text}`)
  }
  const { uploadUrl, key } = (await res.json()) as { uploadUrl: string; key: string }

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!put.ok) {
    const text = await put.text().catch(() => '')
    throw new Error(`Upload to R2 failed (${put.status}): ${text}`)
  }
  return key
}
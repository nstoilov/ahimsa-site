import { supabase } from './supabase'

export type MediaKind = 'images' | 'audio' | 'videos'

const PRESIGN_URL = import.meta.env.VITE_R2_PRESIGN_URL as string | undefined

class R2NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'R2NetworkError'
  }
}

function putToR2(
  url: string,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload aborted.', 'AbortError'))
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total)
      }
    }

    const onAbort = () => xhr.abort()
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    const cleanup = () => signal?.removeEventListener('abort', onAbort)

    xhr.onload = () => {
      cleanup()
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Upload to R2 failed (${xhr.status}): ${xhr.responseText || ''}`))
      }
    }
    xhr.onerror = () => {
      cleanup()
      reject(new R2NetworkError('Upload to R2 failed (network error).'))
    }
    xhr.onabort = () => {
      cleanup()
      reject(new DOMException('Upload aborted.', 'AbortError'))
    }

    xhr.send(file)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function presignAndUpload(
  kind: MediaKind,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<string> {
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
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Presign failed (${res.status}): ${text}`)
  }
  const { uploadUrl, key } = (await res.json()) as { uploadUrl: string; key: string }

  const MAX_ATTEMPTS = 3
  const BACKOFF_MS = [1000, 3000]
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException('Upload aborted.', 'AbortError')
    try {
      await putToR2(uploadUrl, file, onProgress, signal)
      return key
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      if (!(err instanceof R2NetworkError)) throw err
      lastErr = err
      if (attempt < MAX_ATTEMPTS) {
        onProgress?.(0)
        await sleep(BACKOFF_MS[attempt - 1] ?? 3000)
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Upload to R2 failed (network error).')
}

export async function deleteR2Objects(keys: string[], signal?: AbortSignal): Promise<void> {
  if (keys.length === 0) return
  if (!PRESIGN_URL) {
    throw new Error('Missing VITE_R2_PRESIGN_URL — cannot delete R2 objects.')
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
    body: JSON.stringify({ action: 'delete', keys }),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`R2 delete failed (${res.status}): ${text}`)
  }
}
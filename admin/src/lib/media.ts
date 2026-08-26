const MEDIA_BASE_URL =
  (import.meta.env.VITE_MEDIA_BASE_URL as string | undefined) ||
  'https://media.ahimsaapp.com'

const MEDIA_BASE = MEDIA_BASE_URL.replace(/\/+$/, '')

// DB stores object keys WITHOUT the top-level bucket prefix (e.g. "metta2.jpg",
// "intro-1.mp3", "covers/meditation-7.jpg"). The URL builder adds the prefix
// matching the R2 bucket layout: images/, audio/, videos/.
export function prefixedR2Key(prefix: string, key: string): string {
  const cleanKey = key.replace(/^\/+/, '')
  return prefix ? `${prefix}/${cleanKey}` : cleanKey
}

export const getImageUrl = (key: string) => `${MEDIA_BASE}/${prefixedR2Key('images', key)}`
export const getAudioUrl = (key: string) => `${MEDIA_BASE}/${prefixedR2Key('audio', key)}`
export const getVideoUrl = (key: string) => `${MEDIA_BASE}/${prefixedR2Key('videos', key)}`
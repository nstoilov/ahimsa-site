const MEDIA_BASE_URL =
  (import.meta.env.VITE_MEDIA_BASE_URL as string | undefined) ||
  'https://media.ahimsaapp.com'

function join(base: string, prefix: string, key: string): string {
  const cleanBase = base.replace(/\/+$/, '')
  const cleanKey = key.replace(/^\/+/, '')
  return prefix ? `${cleanBase}/${prefix}/${cleanKey}` : `${cleanBase}/${cleanKey}`
}

// DB stores object keys WITHOUT the top-level bucket prefix (e.g. "metta2.jpg",
// "intro-1.mp3", "covers/meditation-7.jpg"). The URL builder adds the prefix
// matching the R2 bucket layout: images/, audio/, videos/.
export const getImageUrl = (key: string) => join(MEDIA_BASE_URL, 'images', key)
export const getAudioUrl = (key: string) => join(MEDIA_BASE_URL, 'audio', key)
export const getVideoUrl = (key: string) => join(MEDIA_BASE_URL, 'videos', key)
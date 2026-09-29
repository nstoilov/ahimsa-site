import type { MediaType } from './entries'

export type EntryDraft = {
  title: string
  author: string
  category: string
  videoCategory: string
  free: boolean
  mediaType: MediaType
  mediaTypeTouched: boolean
  categoryTouched: boolean
  imageFile: File | null
  audioFile: File | null
  videoFile: File | null
  imagePreview: string | null
  audioPreview: string | null
  videoPreview: string | null
}

let draft: EntryDraft | null = null

export function getEntryDraft(): EntryDraft | null {
  return draft
}

export function saveEntryDraft(next: EntryDraft): void {
  draft = next
}

export function clearEntryDraft(): void {
  draft = null
}

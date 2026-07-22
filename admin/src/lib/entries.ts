import { supabase } from './supabase'

export type Entry = {
  id: number
  title: string
  author: string | null
  image_url: string
  audio_url: string
  category: string | null
  free: boolean
  number: number | null
  created_at: string | null
}

export type EntryInput = {
  title: string
  author: string | null
  image_url: string
  audio_url: string
  category: string | null
  free: boolean
  number: number | null
}

export async function fetchEntries(): Promise<Entry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Entry[]
}

export async function fetchEntry(id: number): Promise<Entry> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as Entry
}

export async function createEntry(input: EntryInput): Promise<Entry> {
  const { data, error } = await supabase
    .from('entries')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data as Entry
}

export async function updateEntry(id: number, input: EntryInput): Promise<Entry> {
  const { data, error } = await supabase
    .from('entries')
    .update(input)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Entry
}

export async function deleteEntry(id: number): Promise<void> {
  const { error } = await supabase.from('entries').delete().eq('id', id)
  if (error) throw error
}

export async function fetchCategories(): Promise<string[]> {
  const { data, error } = await supabase
    .from('category_order')
    .select('name')
    .order('display_order', { ascending: true })
  if (error) throw error
  return (data as { name: string }[]).map((r) => r.name)
}

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function uploadMedia(
  bucket: 'images' | 'audio',
  file: File,
): Promise<string> {
  const path = `entries/${Date.now()}-${sanitizeFileName(file.name)}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  })
  if (error) throw error
  return path
}

export async function deleteMedia(
  bucket: 'images' | 'audio',
  path: string,
): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path])
  if (error) throw error
}

export async function getSignedMediaUrl(
  bucket: 'images' | 'audio',
  path: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

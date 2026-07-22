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

export type CategoryOrder = {
  name: string
  display_order: number
}

export async function fetchCategoryOrder(): Promise<CategoryOrder[]> {
  const { data, error } = await supabase
    .from('category_order')
    .select('name, display_order')
    .order('display_order', { ascending: true })
  if (error) throw error
  return data as CategoryOrder[]
}

export async function createCategory(name: string): Promise<void> {
  const { data: maxData, error: maxError } = await supabase
    .from('category_order')
    .select('display_order')
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (maxError) throw maxError
  const nextOrder = (maxData?.display_order ?? 0) + 1
  const { error: insertError } = await supabase
    .from('category_order')
    .insert({ name, display_order: nextOrder })
  if (insertError) throw insertError
}

export async function deleteCategory(name: string): Promise<void> {
  const { error } = await supabase.from('category_order').delete().eq('name', name)
  if (error) throw error
}

export async function removeCategoryWithEntries(name: string): Promise<void> {
  const { error: updateError } = await supabase
    .from('entries')
    .update({ category: null, number: null })
    .eq('category', name)
  if (updateError) throw updateError
  await deleteCategory(name)
}

export type CategoryOrderUpdate = {
  name: string
  display_order: number
}

export async function updateCategoryOrder(
  updates: CategoryOrderUpdate[],
): Promise<void> {
  await Promise.all(
    updates.map((u) =>
      supabase
        .from('category_order')
        .update({ display_order: u.display_order })
        .eq('name', u.name),
    ),
  )
}

export async function fetchMaxNumberInCategory(category: string): Promise<number> {
  const { data, error } = await supabase
    .from('entries')
    .select('number')
    .eq('category', category)
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.number ?? 0
}

export type OrderUpdate = {
  id: number
  category: string | null
  number: number | null
}

export async function updateEntriesOrder(updates: OrderUpdate[]): Promise<void> {
  await Promise.all(
    updates.map((u) =>
      supabase.from('entries').update({ category: u.category, number: u.number }).eq('id', u.id),
    ),
  )
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

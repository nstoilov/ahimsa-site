import { supabase } from './supabase'

export type MediaType = 'audio' | 'video'

export type Entry = {
  id: number
  title: string
  author: string | null
  image_url: string
  audio_url: string
  category: string | null
  video_category: string | null
  free: boolean
  media_type: MediaType
  video_url: string | null
  number: number | null
  created_at: string | null
}

export type EntryInput = {
  title: string
  author: string | null
  image_url: string
  audio_url: string
  category: string | null
  video_category: string | null
  free: boolean
  media_type: MediaType
  video_url: string | null
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
  const { data, error } = await supabase
    .from('entries')
    .delete()
    .eq('id', id)
    .select()
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Entry was not deleted — it may not exist, or you are not authorized to delete it.')
  }
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
  type: 'audio' | 'video' | null
}

export async function fetchCategoryOrder(): Promise<CategoryOrder[]> {
  const withType = await supabase
    .from('category_order')
    .select('name, display_order, type')
    .order('display_order', { ascending: true })

  // Fallback for projects that haven't run category_type_migration.sql yet:
  // retry without the `type` column and treat all rows as type=null.
  if (withType.error && /type/.test(withType.error.message)) {
    const withoutType = await supabase
      .from('category_order')
      .select('name, display_order')
      .order('display_order', { ascending: true })
    if (withoutType.error) throw withoutType.error
    return ((withoutType.data as { name: string; display_order: number }[]) ?? []).map((r) => ({
      name: r.name,
      display_order: r.display_order,
      type: null,
    }))
  }

  if (withType.error) throw withType.error
  return ((withType.data as CategoryOrder[]) ?? []).map((r) => ({
    ...r,
    type: r.type === 'video' ? 'video' : r.type === 'audio' ? 'audio' : null,
  }))
}

export async function createCategory(
  name: string,
  type: 'audio' | 'video' = 'audio',
): Promise<void> {
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
    .insert({ name, display_order: nextOrder, type })
  if (insertError) throw insertError
}

export async function deleteCategory(name: string): Promise<void> {
  const { error } = await supabase.from('category_order').delete().eq('name', name)
  if (error) throw error
}

export async function removeCategoryWithEntries(name: string): Promise<void> {
  const { error: updateError } = await supabase
    .from('entries')
    .update({ category: null, video_category: null, number: null })
    .or(`category.eq.${name},video_category.eq.${name}`)
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

export async function fetchMaxNumberInCategory(
  field: 'category' | 'video_category',
  category: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('entries')
    .select('number')
    .eq(field, category)
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.number ?? 0
}

export type OrderUpdate = {
  id: number
  category: string | null
  video_category: string | null
  number: number | null
}

export async function updateEntriesOrder(updates: OrderUpdate[]): Promise<void> {
  await Promise.all(
    updates.map((u) =>
      supabase
        .from('entries')
        .update({ category: u.category, video_category: u.video_category, number: u.number })
        .eq('id', u.id),
    ),
  )
}

/**
 * Build the sets of audio-only and video-only category names.
 *
 * A category counts as audio if any audio entry references it via `category`,
 * OR its `category_order.type` column is `'audio'`. Same for video. A category
 * present in both sets is "mixed". Empty categories rely on the `type` column
 * (set at creation via the Video checkbox); existing rows with `type IS NULL`
 * are left out of both sets until the first entry lands.
 */
export function categoryTypeSets(
  entries: Entry[],
  categoryOrder: CategoryOrder[],
): { audio: Set<string>; video: Set<string> } {
  const audio = new Set<string>()
  const video = new Set<string>()
  for (const e of entries) {
    if (e.media_type === 'video') {
      if (e.video_category) video.add(e.video_category)
    } else {
      if (e.category) audio.add(e.category)
    }
  }
  for (const c of categoryOrder) {
    if (c.type === 'video') video.add(c.name)
    else if (c.type === 'audio') audio.add(c.name)
  }
  return { audio, video }
}

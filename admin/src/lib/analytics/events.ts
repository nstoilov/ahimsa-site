import { supabase } from '../supabase'

/**
 * Raw playback events written by the mobile app (spec §2.1).
 * All analytics math runs in the admin panel; Supabase stores raw rows only.
 */
export type PlaybackEvent = {
  id: number
  session_id: string
  user_id: string | null
  content_id: number
  event_type: 'heartbeat' | 'seek' | 'pause' | 'resume' | 'complete' | 'session_end'
  position_seconds: number
  playback_rate: number
  is_foreground: boolean
  platform: 'ios' | 'android' | null
  device_id: string | null
  author: string | null
  tier: 'free' | 'paid' | null
  client_created_at: string
  created_at: string
}

const PAGE_SIZE = 1000

/**
 * Fetch all raw playback events whose server insert time (`created_at`) falls in
 * the half-open window [windowStartISO, windowEndISO). Paginates 1000 rows at a
 * time. Callers pass a *buffered* window (see periods.fetchWindowForPeriod) so
 * that sessions straddling the period boundary are reconstructed in full before
 * being bucketed by their true `started_at`.
 */
export async function fetchPlaybackEvents(
  windowStartISO: string,
  windowEndISO: string,
): Promise<PlaybackEvent[]> {
  const out: PlaybackEvent[] = []
  let offset = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('playback_events')
      .select('*')
      .gte('created_at', windowStartISO)
      .lt('created_at', windowEndISO)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...(data as PlaybackEvent[]))
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return out
}
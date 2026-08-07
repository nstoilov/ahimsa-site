/**
 * Period aggregation over computed sessions.
 *
 * Grouping uses the denormalized `playback_events.author` / `.tier` carried on
 * each SessionRow so historical payouts stay accurate even if the catalogue
 * row was later renamed/retiered.
 *
 * `uniqueViewers` counts distinct `device_id`, which covers both logged-in
 * users and guest plays (user_id IS NULL). `deviceReach` is the same metric
 * included separately for clarity.
 */

import type { SessionRow } from './secondsWatched'

export type Totals = {
  seconds_watched: number
  plays: number
  uniqueViewers: number
  deviceReach: number
}

export type GroupRow = {
  key: string
  label: string
  seconds_watched: number
  plays: number
  uniqueViewers: number
  deviceReach: number
  avgCompletion: number
}

export type EntryRow = GroupRow & {
  content_id: number
  title: string
  author: string | null
  tier: 'free' | 'paid' | null
  fraudCount: number
}

export type AnalyticsResult = {
  totals: Totals
  byEntry: EntryRow[]
  byAuthor: GroupRow[]
  byTier: GroupRow[]
}

export type EntryLookup = Map<number, { title: string; author: string | null }>

const UNKNOWN = 'Unknown'

function distinctCount<T>(values: IterableIterator<T>, isSet: (v: T) => boolean): number {
  const set = new Set<T>()
  for (const v of values) {
    if (isSet(v)) set.add(v)
  }
  return set.size
}

function aggregateGroup(
  sessions: SessionRow[],
  getKey: (s: SessionRow) => string,
  getLabel: (key: string, sample: SessionRow) => string,
): GroupRow[] {
  const groups = new Map<string, SessionRow[]>()
  for (const s of sessions) {
    const key = getKey(s)
    let bucket = groups.get(key)
    if (!bucket) {
      bucket = []
      groups.set(key, bucket)
    }
    bucket.push(s)
  }

  const rows: GroupRow[] = []
  for (const [key, bucket] of groups) {
    const first = bucket[0]
    let seconds = 0
    let completionSum = 0
    for (const s of bucket) {
      seconds += s.seconds_watched
      completionSum += s.completion_pct
    }
    rows.push({
      key,
      label: getLabel(key, first),
      seconds_watched: seconds,
      plays: bucket.length,
      uniqueViewers: distinctCount(bucket.map((s) => s.device_id).values(), (v) => v !== null),
      deviceReach: distinctCount(bucket.map((s) => s.device_id).values(), (v) => v !== null),
      avgCompletion: bucket.length ? completionSum / bucket.length : 0,
    })
  }
  rows.sort((a, b) => b.seconds_watched - a.seconds_watched)
  return rows
}

export function aggregate(sessions: SessionRow[], entries: EntryLookup): AnalyticsResult {
  // --- Totals ---
  let totalSeconds = 0
  const deviceIds = new Set<string>()
  for (const s of sessions) {
    totalSeconds += s.seconds_watched
    if (s.device_id !== null) deviceIds.add(s.device_id)
  }

  // --- By entry (with title join + fraud count) ---
  const byEntryMap = new Map<number, SessionRow[]>()
  for (const s of sessions) {
    let bucket = byEntryMap.get(s.content_id)
    if (!bucket) {
      bucket = []
      byEntryMap.set(s.content_id, bucket)
    }
    bucket.push(s)
  }
  const byEntry: EntryRow[] = []
  for (const [contentId, bucket] of byEntryMap) {
    let seconds = 0
    let completionSum = 0
    let fraudCount = 0
    for (const s of bucket) {
      seconds += s.seconds_watched
      completionSum += s.completion_pct
      if (s.fraud_flag) fraudCount++
    }
    // Most recent historical author from the sessions (handles author renames).
    const sortedByEnd = [...bucket].sort(
      (a, b) => new Date(b.ended_at).getTime() - new Date(a.ended_at).getTime(),
    )
    const historicalAuthor = sortedByEnd[0]?.author ?? null
    const lookup = entries.get(contentId)
    const title = lookup?.title ?? `Entry #${contentId} (removed)`
    byEntry.push({
      key: String(contentId),
      label: title,
      content_id: contentId,
      title,
      author: historicalAuthor,
      tier: bucket[0].tier,
      seconds_watched: seconds,
      plays: bucket.length,
      uniqueViewers: distinctCount(bucket.map((s) => s.device_id).values(), (v) => v !== null),
      deviceReach: distinctCount(bucket.map((s) => s.device_id).values(), (v) => v !== null),
      avgCompletion: bucket.length ? completionSum / bucket.length : 0,
      fraudCount,
    })
  }
  byEntry.sort((a, b) => b.seconds_watched - a.seconds_watched)

  // --- By author (denormalized, historical) ---
  const byAuthor = aggregateGroup(
    sessions,
    (s) => s.author ?? UNKNOWN,
    (key) => key,
  )

  // --- By tier (denormalized, historical) ---
  const byTier = aggregateGroup(
    sessions,
    (s) => s.tier ?? UNKNOWN,
    (key) => key.charAt(0).toUpperCase() + key.slice(1),
  )

  return {
    totals: {
      seconds_watched: totalSeconds,
      plays: sessions.length,
      uniqueViewers: deviceIds.size,
      deviceReach: deviceIds.size,
    },
    byEntry,
    byAuthor,
    byTier,
  }
}

/**
 * Collapse a sorted-by-seconds group list into the top N plus an "Other" bucket,
 * for pie-chart rendering (keeps the chart readable when there are many slices).
 */
export function topNWithOther(rows: GroupRow[], n: number): GroupRow[] {
  if (rows.length <= n) return rows
  const head = rows.slice(0, n).map((r) => ({ ...r }))
  const tail = rows.slice(n)
  let seconds = 0
  let plays = 0
  let viewers = 0
  let reach = 0
  let completionSum = 0
  for (const r of tail) {
    seconds += r.seconds_watched
    plays += r.plays
    viewers += r.uniqueViewers
    reach += r.deviceReach
    completionSum += r.avgCompletion * r.plays
  }
  const otherPlays = plays
  return [
    ...head,
    {
      key: '__other__',
      label: `Other (${tail.length})`,
      seconds_watched: seconds,
      plays,
      uniqueViewers: viewers,
      deviceReach: reach,
      avgCompletion: otherPlays ? completionSum / otherPlays : 0,
    },
  ]
}
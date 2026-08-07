/**
 * Per-session watch-time reconstruction (spec §4.1–§4.4, §6.1).
 *
 * A "session" = all PlaybackEvent rows sharing one `session_id`. We walk them in
 * client-time order, build a list of played `[start, end]` position intervals,
 * merge overlaps/adjacencies (§4.2), and sum the lengths to get `seconds_watched`.
 *
 * `content_duration` uses MAX(position_seconds) for the session as the duration
 * proxy (§6.1 — the mobile does not send duration). `completion_pct` is
 * clamped to [0,1]. Sessions exceeding `seconds_watched > duration * 3` are
 * flagged for fraud review (§4.3).
 */

import type { PlaybackEvent } from './events'

export type SessionRow = {
  session_id: string
  content_id: number
  user_id: string | null
  device_id: string | null
  author: string | null // denormalized, historical (§6.2)
  tier: 'free' | 'paid' | null // denormalized, historical (§6.2)
  seconds_watched: number
  content_duration: number // MAX(position_seconds) proxy (§6.1)
  completion_pct: number // clamp(seconds_watched / content_duration, 0, 1)
  started_at: string // min(client_created_at)
  ended_at: string // max(client_created_at)
  fraud_flag: boolean // §4.3 cap
}

type Interval = [number, number]

const TOLERANCE = 0.25 // ±25% of expected advancement (§4.1 step 2)
const FRAUD_DURATION_MULTIPLE = 3.0 // §4.3 sanity cap

function byClientTimeAsc(a: PlaybackEvent, b: PlaybackEvent): number {
  const ta = new Date(a.client_created_at).getTime()
  const tb = new Date(b.client_created_at).getTime()
  if (ta !== tb) return ta - tb
  return a.id - b.id
}

/**
 * Reconstruct the played position-intervals for one session's events
 * (already grouped by session_id, ordered by client_created_at).
 *
 * Implementation of spec §4.1.
 */
function reconstructIntervals(events: PlaybackEvent[]): Interval[] {
  const intervals: Interval[] = []
  let openStart: number | null = null
  let prevPos: number | null = null
  let prevTime: number | null = null

  const open = (pos: number) => {
    openStart = pos
  }
  const close = (endPos: number) => {
    if (openStart !== null && endPos > openStart) intervals.push([openStart, endPos])
    openStart = null
  }

  for (const ev of events) {
    const pos = Number(ev.position_seconds)
    const t = new Date(ev.client_created_at).getTime()

    switch (ev.event_type) {
      case 'heartbeat': {
        if (openStart === null) open(pos)
        if (prevPos !== null && prevTime !== null) {
          const dt = (t - prevTime) / 1000
          const expected = dt * Number(ev.playback_rate)
          const actual = pos - prevPos
          const tol = Math.abs(expected) * TOLERANCE
          const withinTolerance = expected > 0 && actual >= expected - tol && actual <= expected + tol
          if (withinTolerance) {
            // continuous playback: [prev_position, current_position] was played.
            // Close the open interval at the current position, reopen here.
            close(pos)
            open(pos)
          } else {
            // Scrubbed forward, scrubbed backward, or stalled (buffering /
            // pause-without-event): the interval straddling these two events
            // was NOT watched. Close the open interval at prev_position only.
            close(prevPos)
            open(pos)
          }
        }
        prevPos = pos
        prevTime = t
        break
      }
      case 'seek': {
        // Discontinuity: do not include the gap to the seek target.
        close(prevPos ?? pos)
        openStart = null
        prevPos = pos
        prevTime = t
        break
      }
      case 'pause': {
        // Close the open interval at the pause position; next resume reopens.
        close(pos)
        openStart = null
        prevPos = pos
        prevTime = t
        break
      }
      case 'resume': {
        open(pos)
        prevPos = pos
        prevTime = t
        break
      }
      case 'complete': {
        close(pos)
        openStart = null
        prevPos = pos
        prevTime = t
        break
      }
      case 'session_end': {
        close(prevPos ?? pos)
        openStart = null
        prevPos = pos
        prevTime = t
        break
      }
      default: {
        prevPos = pos
        prevTime = t
      }
    }
  }

  // Failsafe: if a session ended without session_end, close the trailing open interval.
  if (openStart !== null && prevPos !== null) close(prevPos)

  return intervals
}

/**
 * Merge overlapping / adjacent intervals and return the union (spec §4.2).
 */
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Interval[] = [[sorted[0][0], sorted[0][1]]]
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i]
    const last = merged[merged.length - 1]
    if (s <= last[1]) {
      if (e > last[1]) last[1] = e
    } else {
      merged.push([s, e])
    }
  }
  return merged
}

function sumDuration(merged: Interval[]): number {
  let total = 0
  for (const [s, e] of merged) total += e - s
  return total
}

export function computeSessions(events: PlaybackEvent[]): SessionRow[] {
  const bySession = new Map<string, PlaybackEvent[]>()
  for (const ev of events) {
    let bucket = bySession.get(ev.session_id)
    if (!bucket) {
      bucket = []
      bySession.set(ev.session_id, bucket)
    }
    bucket.push(ev)
  }

  const rows: SessionRow[] = []
  for (const [sessionId, bucket] of bySession) {
    if (bucket.length === 0) continue
    bucket.sort(byClientTimeAsc)

    const intervals = mergeIntervals(reconstructIntervals(bucket))
    const seconds_watched = sumDuration(intervals)
    const content_duration = bucket.reduce(
      (max, e) => Math.max(max, Number(e.position_seconds)),
      0,
    )
    const completion_pct =
      content_duration > 0 ? Math.min(1, Math.max(0, seconds_watched / content_duration)) : 0
    const startedAtMs = new Date(bucket[0].client_created_at).getTime()
    const endedAtMs = new Date(bucket[bucket.length - 1].client_created_at).getTime()
    const first = bucket[0]

    rows.push({
      session_id: sessionId,
      content_id: first.content_id,
      user_id: first.user_id,
      device_id: first.device_id,
      author: first.author,
      tier: first.tier,
      seconds_watched,
      content_duration,
      completion_pct,
      started_at: new Date(startedAtMs).toISOString(),
      ended_at: new Date(endedAtMs).toISOString(),
      fraud_flag: content_duration > 0 && seconds_watched > content_duration * FRAUD_DURATION_MULTIPLE,
    })
  }

  return rows
}
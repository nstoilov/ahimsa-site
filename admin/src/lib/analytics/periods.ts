/**
 * Period window helpers. Periods are aligned to UTC midnight to match the
 * `created_at` timestamptz semantics. Weeks are Monday-aligned to match
 * Postgres `date_trunc('week')` (ISO weeks).
 *
 * `start` is inclusive, `end` is exclusive ([start, end)).
 *
 * Period membership is defined by each session's `started_at`
 * (== min(client_created_at)), per spec §4.4. To reconstruct a session's full
 * played intervals we need *all* of its events, including ones uploaded just
 * after the period end; `fetchWindowForPeriod` therefore pads the read window
 * with a small lead/trail buffer. Sessions are assigned to a period by their
 * true `started_at` in the aggregate step (see AnalyticsPage).
 */

export type PeriodKind = 'day' | 'week' | 'month'

export type PeriodBounds = {
  start: string // ISO, inclusive
  end: string // ISO, exclusive
}

const LEAD_MS = 2 * 60 * 60 * 1000 // 2h before period start (clock-skew / late uploads)
const TRAIL_MS = 2 * 60 * 60 * 1000 // 2h after period end (tail events of sessions started late in the period)

function mondayOfISOWeek(year: number, week: number): Date {
  // ISO 8601: week 1 is the week containing the year's first Thursday,
  // and weeks start on Monday. Jan 4 is always in week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() // 0=Sun..6=Sat
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - ((jan4Day + 6) % 7))
  const monday = new Date(week1Monday)
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7)
  return monday
}

function isoWeekParts(date: Date): { year: number; week: number } {
  const monday = new Date(date)
  const day = monday.getUTCDay()
  monday.setUTCDate(monday.getUTCDate() - ((day + 6) % 7)) // back to Monday
  const thursday = new Date(monday)
  thursday.setUTCDate(monday.getUTCDate() + 3) // Thursday of this week
  const year = thursday.getUTCFullYear()
  const week1Monday = mondayOfISOWeek(year, 1)
  const week = Math.round((monday.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1
  return { year, week }
}

export function periodBounds(kind: PeriodKind, value: string): PeriodBounds {
  switch (kind) {
    case 'day': {
      const [y, m, d] = value.split('-').map(Number)
      const start = new Date(Date.UTC(y, m - 1, d))
      const end = new Date(start)
      end.setUTCDate(start.getUTCDate() + 1)
      return { start: start.toISOString(), end: end.toISOString() }
    }
    case 'week': {
      const [ys, ws] = value.split('-W')
      const start = mondayOfISOWeek(Number(ys), Number(ws))
      const end = new Date(start)
      end.setUTCDate(start.getUTCDate() + 7)
      return { start: start.toISOString(), end: end.toISOString() }
    }
    case 'month': {
      const [y, m] = value.split('-').map(Number)
      const start = new Date(Date.UTC(y, m - 1, 1))
      const end = new Date(Date.UTC(y, m, 1)) // Date.UTC normalizes month 12 -> next Jan
      return { start: start.toISOString(), end: end.toISOString() }
    }
    default:
      throw new Error(`Unknown period kind: ${kind}`)
  }
}

export function fetchWindowForPeriod(kind: PeriodKind, value: string): PeriodBounds {
  const bounds = periodBounds(kind, value)
  const startMs = new Date(bounds.start).getTime() - LEAD_MS
  const endMs = new Date(bounds.end).getTime() + TRAIL_MS
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() }
}

export function defaultPeriodValue(kind: PeriodKind): string {
  const now = new Date()
  switch (kind) {
    case 'day':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        .toISOString()
        .slice(0, 10)
    case 'week': {
      const { year, week } = isoWeekParts(now)
      return `${year}-W${String(week).padStart(2, '0')}`
    }
    case 'month':
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    default:
      throw new Error(`Unknown period kind: ${kind}`)
  }
}

export function shiftPeriodValue(kind: PeriodKind, value: string, delta: number): string {
  const { start } = periodBounds(kind, value)
  const d = new Date(start)
  switch (kind) {
    case 'day':
      d.setUTCDate(d.getUTCDate() + delta)
      return d.toISOString().slice(0, 10)
    case 'week':
      d.setUTCDate(d.getUTCDate() + delta * 7)
      return (() => {
        const { year, week } = isoWeekParts(d)
        return `${year}-W${String(week).padStart(2, '0')}`
      })()
    case 'month':
      d.setUTCMonth(d.getUTCMonth() + delta)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    default:
      throw new Error(`Unknown period kind: ${kind}`)
  }
}

export function periodDisplayRange(kind: PeriodKind, value: string): string {
  const { start, end } = periodBounds(kind, value)
  const e = new Date(end)
  e.setUTCMilliseconds(-1)
  return `${start.replace('T', ' ').slice(0, 16)} → ${e.toISOString().replace('T', ' ').slice(0, 16)} UTC`
}
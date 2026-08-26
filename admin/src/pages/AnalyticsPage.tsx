import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Pie,
  PieChart,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { AdminNav } from '../components/AdminNav'
import { fetchEntries, type Entry } from '../lib/entries'
import { supabase } from '../lib/supabase'
import {
  aggregate,
  computeSessions,
  defaultPeriodValue,
  fetchPlaybackEvents,
  fetchWindowForPeriod,
  periodBounds,
  periodDisplayRange,
  shiftPeriodValue,
  topNWithOther,
  type AnalyticsResult,
  type EntryLookup,
  type EntryRow,
  type GroupRow,
  type PeriodKind,
  type PlaybackEvent,
  type SessionRow,
} from '../lib/analytics'

const PIE_PALETTE = [
  '#a78bfa',
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#22d3ee',
  '#fb923c',
  '#a3e635',
  '#f87171',
  '#c084fc',
]

const OTHER_COLOR = '#64748b'
const TOP_N = 8

type LoadingState = 'idle' | 'loading' | 'success' | 'error'

function formatSeconds(s: number): string {
  const total = Math.round(s)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function formatPct(p: number): string {
  return `${Math.round(p * 100)}%`
}

function PieCard({
  title,
  rows,
  totalSeconds,
}: {
  title: string
  rows: GroupRow[]
  totalSeconds: number
}) {
  const data = useMemo(() => {
    const sortable = rows.filter((r) => r.seconds_watched > 0)
    sortable.sort((a, b) => b.seconds_watched - a.seconds_watched)
    const withPct = topNWithOther(sortable, TOP_N).map((r) => ({
      ...r,
      label: `${r.label} (${totalSeconds > 0 ? Math.round((r.seconds_watched / totalSeconds) * 100) : 0}%)`,
    }))
    return withPct
  }, [rows, totalSeconds])

  return (
    <div className="admin-analytics-pie">
      <h3>{title}</h3>
      {data.length === 0 || totalSeconds === 0 ? (
        <p className="admin-muted admin-analytics-empty">No watch time in this period.</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={data}
              dataKey="seconds_watched"
              nameKey="label"
              innerRadius={55}
              outerRadius={90}
              paddingAngle={1}
              stroke="rgba(0,0,0,0.2)"
            >
              {data.map((d, i) => (
                <Cell
                  key={d.key}
                  fill={d.key === '__other__' ? OTHER_COLOR : PIE_PALETTE[i % PIE_PALETTE.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatSeconds(Number(value)) as unknown as string}
              contentStyle={{
                backgroundColor: '#232342',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                fontSize: '0.85rem',
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={40}
              wrapperStyle={{ fontSize: '0.8rem', opacity: 0.85 }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

type SortKey = 'title' | 'author' | 'tier' | 'plays' | 'uniqueViewers' | 'deviceReach' | 'avgCompletion' | 'seconds_watched'

function compareEntryRows(a: EntryRow, b: EntryRow, key: SortKey): number {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title)
    case 'author':
      return (a.author ?? '').localeCompare(b.author ?? '')
    case 'tier':
      return (a.tier ?? '').localeCompare(b.tier ?? '')
    case 'plays':
      return a.plays - b.plays
    case 'uniqueViewers':
      return a.uniqueViewers - b.uniqueViewers
    case 'deviceReach':
      return a.deviceReach - b.deviceReach
    case 'avgCompletion':
      return a.avgCompletion - b.avgCompletion
    case 'seconds_watched':
      return a.seconds_watched - b.seconds_watched
  }
}

const NUMERIC_SORT_KEYS: Set<SortKey> = new Set([
  'plays',
  'uniqueViewers',
  'deviceReach',
  'avgCompletion',
  'seconds_watched',
])

function defaultDirForKey(key: SortKey): 'asc' | 'desc' {
  return NUMERIC_SORT_KEYS.has(key) ? 'desc' : 'asc'
}

export function AnalyticsPage() {
  const [kind, setKind] = useState<PeriodKind>('week')
  const [value, setValue] = useState<string>(() => defaultPeriodValue('week'))
  const [result, setResult] = useState<AnalyticsResult | null>(null)
  const [status, setStatus] = useState<LoadingState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [rawCount, setRawCount] = useState(0)
  const [recentEvents, setRecentEvents] = useState<PlaybackEvent[]>([])
  const [showRecent, setShowRecent] = useState(false)
  const [diag, setDiag] = useState<{
    periodStart: string
    periodEnd: string
    windowStart: string
    windowEnd: string
    sessionsTotal: number
    sessionsInPeriod: number
  } | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'seconds_watched',
    dir: 'desc',
  })
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [lookup, setLookup] = useState<EntryLookup>(new Map())
  const [selectedAuthor, setSelectedAuthor] = useState<string>('All')

  const filteredResult = useMemo(() => {
    if (selectedAuthor === 'All' || sessions.length === 0) return null
    const filtered = sessions.filter((s) => s.author === selectedAuthor)
    if (filtered.length === 0) return null
    return aggregate(filtered, lookup)
  }, [selectedAuthor, sessions, lookup])

  const activeResult = filteredResult ?? result

  const sortedByEntry = useMemo(() => {
    if (!activeResult) return []
    const rows = activeResult.byEntry.filter((r) => r.seconds_watched > 0)
    rows.sort((a, b) => {
      const cmp = compareEntryRows(a, b, sort.key)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [activeResult, sort])

  function handleSort(key: SortKey) {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { key, dir: defaultDirForKey(key) }
    })
  }

  function sortArrow(key: SortKey): string {
    if (sort.key !== key) return ''
    return sort.dir === 'asc' ? ' ↑' : ' ↓'
  }

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    setDiag(null)
    try {
      const period = periodBounds(kind, value)
      const window = fetchWindowForPeriod(kind, value)

      // Fetch period data + a small recent preview (diagnostic) in parallel
      const [events, entries, recentRes] = await Promise.all([
        fetchPlaybackEvents(window.start, window.end),
        fetchEntries(),
        supabase.from('playback_events').select('*').order('created_at', { ascending: false }).limit(20),
      ])

      setRawCount(events.length)
      setRecentEvents((recentRes.data as PlaybackEvent[]) ?? [])

      const allSessions = computeSessions(events)
      const sessions = allSessions.filter((s) => {
        const t = new Date(s.started_at).getTime()
        return t >= new Date(period.start).getTime() && t < new Date(period.end).getTime()
      })

      const lookup: EntryLookup = new Map(
        (entries as Entry[]).map((e) => [e.id, { title: e.title, author: e.author }]),
      )
      setSessions(sessions)
      setLookup(lookup)
      setResult(aggregate(sessions, lookup))
      setSelectedAuthor('All')
      setDiag({
        periodStart: period.start,
        periodEnd: period.end,
        windowStart: window.start,
        windowEnd: window.end,
        sessionsTotal: allSessions.length,
        sessionsInPeriod: sessions.length,
      })
      setStatus('success')

      // eslint-disable-next-line no-console
      console.log('[Analytics]', {
        rawEvents: events.length,
        sessionsTotal: allSessions.length,
        sessionsInPeriod: sessions.length,
        period,
        window,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics.')
      setStatus('error')
    }
  }, [kind, value])

  useEffect(() => {
    load()
  }, [load])

  function changeKind(next: PeriodKind) {
    setKind(next)
    setValue(defaultPeriodValue(next))
  }

  const displayRange = useMemo(() => periodDisplayRange(kind, value), [kind, value])

  return (
    <div className="admin-app">
      <AdminNav />
      <main className="admin-page admin-analytics-page">
        <div className="admin-page-head">
          <h2>Watch analytics</h2>
          <div className="admin-page-actions admin-analytics-controls">
            <div className="admin-media-toggle">
              {(['day', 'week', 'month'] as const).map((k) => (
                <button
                  key={k}
                  className={kind === k ? 'is-active' : ''}
                  onClick={() => changeKind(k)}
                >
                  {k[0].toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
            <button
              className="admin-button admin-button-sm"
              onClick={() => setValue((v) => shiftPeriodValue(kind, v, -1))}
            >
              ‹ Prev
            </button>
            <input
              className="admin-analytics-period-input"
              type={kind === 'day' ? 'date' : kind === 'week' ? 'week' : 'month'}
              value={value}
              onChange={(e) => e.target.value && setValue(e.target.value)}
            />
            <button
              className="admin-button admin-button-sm"
              onClick={() => setValue((v) => shiftPeriodValue(kind, v, 1))}
            >
              Next ›
            </button>
            <button
              className="admin-button admin-button-sm admin-button-ghost"
              onClick={() => setValue(defaultPeriodValue(kind))}
            >
              Current
            </button>
          </div>
        </div>

        <p className="admin-analytics-range admin-muted">{displayRange}</p>

        {error && <p className="admin-error">{error}</p>}

        {status === 'loading' && <p className="admin-muted">Loading…</p>}

        {status === 'success' && result && (
          <>
            {result.byAuthor.length > 0 && (
              <div className="admin-analytics-author">
                <span className="admin-muted">Author</span>
                <div className="admin-media-toggle">
                  <button
                    className={selectedAuthor === 'All' ? 'is-active' : ''}
                    onClick={() => setSelectedAuthor('All')}
                  >
                    All
                  </button>
                  {result.byAuthor.map((a) => (
                    <button
                      key={a.key}
                      className={selectedAuthor === a.key ? 'is-active' : ''}
                      onClick={() => setSelectedAuthor(a.key)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <section className="admin-analytics-stats">
              <div className="admin-stat">
                <span className="admin-stat-value">{formatSeconds(activeResult?.totals.seconds_watched ?? 0)}</span>
                <span className="admin-stat-label">Watch time</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-value">{activeResult?.totals.plays ?? 0}</span>
                <span className="admin-stat-label">Plays</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-value">{activeResult?.totals.uniqueViewers ?? 0}</span>
                <span className="admin-stat-label">Unique viewers</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-value">{activeResult?.totals.deviceReach ?? 0}</span>
                <span className="admin-stat-label">Device reach</span>
              </div>
            </section>

            {activeResult?.totals.plays === 0 ? (
              <div className="admin-analytics-empty">
                <p className="admin-muted">
                  No plays recorded in this period. Raw events fetched: {rawCount}.
                </p>
                {diag && (
                  <details className="admin-analytics-diag">
                    <summary>Diagnostics</summary>
                    <div className="admin-analytics-diag-body">
                      <p>
                        <strong>Period:</strong>{' '}
                        <code>
                          {diag.periodStart.slice(0, 19)} → {diag.periodEnd.slice(0, 19)} UTC
                        </code>
                      </p>
                      <p>
                        <strong>Fetch window:</strong>{' '}
                        <code>
                          {diag.windowStart.slice(0, 19)} → {diag.windowEnd.slice(0, 19)} UTC
                        </code>
                      </p>
                      <p>
                        <strong>Sessions found in window:</strong> {diag.sessionsTotal}
                      </p>
                      <p>
                        <strong>Sessions inside period:</strong> {diag.sessionsInPeriod}
                      </p>
                      <p className="admin-muted">
                        If sessions exist in the window but 0 inside the period, the mobile
                        device clock may be offset (client_created_at differs from UTC).
                      </p>
                    </div>
                  </details>
                )}
                <button
                  className="admin-button admin-button-sm admin-button-ghost"
                  onClick={() => setShowRecent((v) => !v)}
                >
                  {showRecent ? 'Hide' : 'Show'} recent raw events
                </button>
                {showRecent && (
                  <div className="admin-analytics-recent">
                    {recentEvents.length === 0 ? (
                      <p className="admin-error">
                        No raw playback_events rows found at all. Either the mobile app hasn’t
                        written any events yet, or the RLS SELECT policy isn’t active.
                      </p>
                    ) : (
                      <>
                        <p className="admin-muted">
                          Last {recentEvents.length} raw rows (newest first):
                        </p>
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>created_at</th>
                              <th>event_type</th>
                              <th>session_id</th>
                              <th>content_id</th>
                              <th>author</th>
                              <th>tier</th>
                              <th>position</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recentEvents.map((ev) => (
                              <tr key={ev.id}>
                                <td>{ev.created_at.slice(0, 19)}</td>
                                <td>{ev.event_type}</td>
                                <td className="mono">{ev.session_id.slice(0, 8)}…</td>
                                <td>{ev.content_id}</td>
                                <td>{ev.author ?? '—'}</td>
                                <td>{ev.tier ?? '—'}</td>
                                <td>{Number(ev.position_seconds).toFixed(1)}s</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                <section className="admin-analytics-pies">
                  <PieCard
                    title="By author"
                    rows={result.byAuthor}
                    totalSeconds={result.totals.seconds_watched}
                  />
                  <PieCard
                    title="By entry"
                    rows={activeResult!.byEntry}
                    totalSeconds={activeResult!.totals.seconds_watched}
                  />
                  <PieCard
                    title="By tier"
                    rows={activeResult!.byTier}
                    totalSeconds={activeResult!.totals.seconds_watched}
                  />
                </section>

                <section className="admin-analytics-table-wrap">
                  <h3>Entries played</h3>
                  <table className="admin-table admin-analytics-table">
                    <thead>
                      <tr>
                        <th className="sortable" onClick={() => handleSort('title')}>
                          Entry{sortArrow('title')}
                        </th>
                        <th className="sortable" onClick={() => handleSort('author')}>
                          Author{sortArrow('author')}
                        </th>
                        <th className="sortable" onClick={() => handleSort('tier')}>
                          Tier{sortArrow('tier')}
                        </th>
                        <th className="num sortable" onClick={() => handleSort('plays')}>
                          Plays{sortArrow('plays')}
                        </th>
                        <th className="num sortable" onClick={() => handleSort('uniqueViewers')}>
                          Unique viewers{sortArrow('uniqueViewers')}
                        </th>
                        <th className="num sortable" onClick={() => handleSort('deviceReach')}>
                          Device reach{sortArrow('deviceReach')}
                        </th>
                        <th className="num sortable" onClick={() => handleSort('avgCompletion')}>
                          Avg completion{sortArrow('avgCompletion')}
                        </th>
                        <th className="num sortable" onClick={() => handleSort('seconds_watched')}>
                          Watch time{sortArrow('seconds_watched')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedByEntry.map((row) => (
                        <tr key={row.content_id}>
                          <td>
                            {row.title}
                            {row.fraudCount > 0 && (
                              <span
                                className="admin-badge admin-badge-fraud"
                                title={`${row.fraudCount} session(s) exceeded the 3× duration sanity cap`}
                              >
                                ⚠ {row.fraudCount}
                              </span>
                            )}
                          </td>
                          <td>{row.author ?? '—'}</td>
                          <td>
                            <span
                              className={`admin-badge${row.tier === 'paid' ? ' admin-badge-paid' : ''}`}
                            >
                              {row.tier ?? '—'}
                            </span>
                          </td>
                          <td className="num">{row.plays}</td>
                          <td className="num">{row.uniqueViewers}</td>
                          <td className="num">{row.deviceReach}</td>
                          <td className="num">{formatPct(row.avgCompletion)}</td>
                          <td className="num">{formatSeconds(row.seconds_watched)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <p className="admin-muted admin-analytics-footnote">
                  Raw events fetched: {rawCount}. Watch time uses deduplicated played intervals per
                  session; author &amp; tier reflect the historical values at time of viewing;
                  unique viewers include both logged-in users and guests (by device).
                </p>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
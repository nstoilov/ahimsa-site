import { useEffect, useRef, useState } from 'react'
import { AdminNav } from '../components/AdminNav'
import { useAuth } from '../auth/AuthContext'
import { fetchCategories } from '../lib/entries'
import {
  fetchGrantedAccess,
  saveGrantedAccess,
  deleteGrantedAccess,
  FULL_ACCESS,
  type AccessScope,
  type GrantedAccess,
} from '../lib/grantedAccess'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function todayString(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
// pub
// Timezone-safe: no Date round-trip — parsing "YYYY-MM-DDT00:00:00" locally
// and calling toISOString() shifts the date back a day in UTC+ timezones,
// which made every valid date fail validation.
function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

function addMonthsISO(baseISO: string, months: number): string {
  const [year, month, day] = baseISO.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1, 1))
  target.setUTCMonth(target.getUTCMonth() + months)
  const daysInMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(day, daysInMonth))
  return target.toISOString().slice(0, 10)
}

const DURATION_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1).map((months) => ({
  months,
  label: months === 12 ? '1 year' : `${months} ${months === 1 ? 'month' : 'months'}`,
}))

// "Пълен достъп" is stored as access_type = 'all' (explicit full-access
// grant, categories = null), which keeps future categories covered and
// behaves exactly like a subscription. Selecting every category individually
// is equivalent. When no categories can be loaded we fail safe to full
// access (the picker shows a warning so this never happens silently).
function scopeForSave(selected: Set<string>, categoryNames: string[], allAccess: boolean): AccessScope {
  if (allAccess || categoryNames.length === 0) return FULL_ACCESS
  if (selected.size >= categoryNames.length) return FULL_ACCESS
  return { access_type: 'categories', categories: Array.from(selected) }
}

function scopeLabel(scope: GrantedAccess | AccessScope): string {
  if (scope.access_type === 'all') return 'all categories'
  const n = scope.categories?.length ?? 0
  return `${n} ${n === 1 ? 'category' : 'categories'}`
}

function CategoryScopePicker({
  categoryNames,
  selected,
  onChange,
  allAccess,
  onAllAccessChange,
  invalid = false,
}: {
  categoryNames: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  allAccess: boolean
  onAllAccessChange: (v: boolean) => void
  invalid?: boolean
}) {
  const [showList, setShowList] = useState(false)
  const allSelected = categoryNames.length > 0 && selected.size >= categoryNames.length
  return (
    <div className={`admin-category-scope${invalid ? ' admin-flash' : ''}`}>
      <div className="admin-category-scope-head">
        <span className="admin-category-scope-title">Category access</span>
        <div className="admin-category-scope-actions">
          <button
            type="button"
            className="admin-link-button"
            onClick={() => onChange(new Set(categoryNames))}
            disabled={allAccess || !showList}
          >
            Select all
          </button>
          <button
            type="button"
            className="admin-link-button"
            onClick={() => onChange(new Set())}
            disabled={allAccess || !showList}
          >
            Deselect all
          </button>
        </div>
      </div>
      <div className="admin-category-scope-controls">
        <label className="admin-check admin-category-scope-all" title="Достъп до всичко">
          <input
            type="checkbox"
            checked={allAccess}
            onChange={(e) => onAllAccessChange(e.target.checked)}
          />
          <span>Пълен достъп</span>
          <span className="admin-muted admin-category-scope-all-hint">
            — unlocks everything, same as a subscription
          </span>
        </label>
        <button
          type="button"
          className={`admin-button admin-button-sm admin-category-scope-toggle${showList ? ' admin-category-scope-toggle-active' : ''}`}
          onClick={() => setShowList((v) => !v)}
          disabled={allAccess}
          aria-expanded={showList}
        >
          {showList ? 'Hide categories' : 'Select categories'}
          {showList ? '' : selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>
      {categoryNames.length === 0 ? (
        <p className="admin-muted admin-category-scope-hint">
          No categories could be loaded — the grant will cover all categories (full access).
        </p>
      ) : (
        <>
          {showList && (
            <div
              className={`admin-category-scope-grid${allAccess ? ' admin-category-scope-grid-disabled' : ''}`}
            >
              {categoryNames.map((name) => (
                <label
                  key={name}
                  className="admin-check admin-category-scope-item"
                  title={name}
                >
                  <input
                    type="checkbox"
                    disabled={allAccess}
                    checked={selected.has(name)}
                    onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) next.add(name)
                      else next.delete(name)
                      onChange(next)
                    }}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          )}
          <p className="admin-muted admin-category-scope-hint">
            {allAccess
              ? 'Пълен достъп — всичко е отключено, като абонамент.'
              : categoryNames.length === 0
                ? ''
                : showList
                  ? allSelected
                    ? 'All categories selected — full subscriber access, same as a subscription.'
                    : selected.size === 0
                      ? 'Select at least one category (or all) to grant access.'
                      : 'Only the selected categories are unlocked; everything else stays locked.'
                  : selected.size > 0
                    ? `${selected.size} ${selected.size === 1 ? 'category' : 'categories'} selected.`
                    : 'No categories selected yet — pick "Пълен достъп" or select categories.'}
          </p>
        </>
      )}
    </div>
  )
}

export function GrantedAccessPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<GrantedAccess[]>([])
  const [categoryNames, setCategoryNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    kind: 'success' | 'warning' | 'error'
    message: string
  } | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newDuration, setNewDuration] = useState('')
  const [newSelected, setNewSelected] = useState<Set<string>>(new Set())
  const [newAllAccess, setNewAllAccess] = useState(false)
  const [granting, setGranting] = useState(false)
  const [editing, setEditing] = useState<GrantedAccess | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editSelected, setEditSelected] = useState<Set<string>>(new Set())
  const [editAllAccess, setEditAllAccess] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [removing, setRemoving] = useState<GrantedAccess | null>(null)
  const [removingBusy, setRemovingBusy] = useState(false)
  const [flash, setFlash] = useState<{ email: boolean; duration: boolean; scope: boolean } | null>(
    null,
  )
  const datePickerRef = useRef<HTMLInputElement>(null)
  const flashTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    }
  }, [])

  // Remove and re-apply the flash class across frames so the CSS animation
  // retriggers even on rapid repeated clicks.
  function triggerFlash(targets: { email: boolean; duration: boolean; scope: boolean }) {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    setFlash(null)
    window.requestAnimationFrame(() => {
      setFlash(targets)
      flashTimer.current = window.setTimeout(() => {
        setFlash(null)
        flashTimer.current = null
      }, 1000)
    })
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [grants, cats] = await Promise.all([fetchGrantedAccess(), fetchCategories()])
      setRows(grants)
      setCategoryNames(cats)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load granted access.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const today = todayString()
  const maxDate = addMonthsISO(today, 12)
  const newEmailValid = EMAIL_RE.test(newEmail.trim())
  const newDateValid = isValidDate(newDate) && newDate >= today && newDate <= maxDate
  const newScopeValid = newAllAccess || categoryNames.length === 0 || newSelected.size > 0
  const canGrant = newEmailValid && newDateValid && newScopeValid

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault()
    const email = newEmail.trim()
    if (granting) return
    if (!canGrant) {
      triggerFlash({
        email: !newEmailValid,
        duration: !newDateValid,
        scope: !newScopeValid,
      })
      return
    }
    setGranting(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await saveGrantedAccess(
        email,
        newDate,
        scopeForSave(newSelected, categoryNames, newAllAccess),
        user?.email ?? '',
      )
      // The upsert returned the persisted row — the grant is confirmed saved.
      if (!saved?.email) throw new Error('Grant was not saved — no row was returned.')
      setNotice({
        kind: 'success',
        message: `Granted ${saved.email} access to ${scopeLabel(saved)} until ${saved.expires_at}.`,
      })
      setNewEmail('')
      setNewDate('')
      setNewDuration('')
      setNewSelected(new Set())
      setNewAllAccess(false)
      await load()
    } catch (err) {
      setNotice({
        kind: 'error',
        message: `Could not grant access to ${email}: ${err instanceof Error ? err.message : 'unknown error.'}`,
      })
    } finally {
      setGranting(false)
    }
  }

  function handleDurationChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const months = Number(e.target.value)
    if (!Number.isInteger(months) || months < 1) return
    setNewDuration(e.target.value)
    setNewDate(addMonthsISO(todayString(), months))
  }

  function openDatePicker() {
    // The date input stays visually hidden (showPicker needs it rendered);
    // opening the native picker directly avoids a second visible field.
    try {
      datePickerRef.current?.showPicker?.()
    } catch {
      // Browser blocked the picker (e.g. missing user activation) — ignore.
    }
  }

  function startEdit(row: GrantedAccess) {
    setEditing(row)
    setEditDate(row.expires_at)
    // Scoped grants keep only categories that still exist; "all" grants
    // prefill with the toggle on.
    setEditAllAccess(row.access_type === 'all')
    setEditSelected(
      row.access_type === 'all'
        ? new Set(categoryNames)
        : new Set((row.categories ?? []).filter((c) => categoryNames.includes(c))),
    )
    setError(null)
  }

  const editScopeValid = editAllAccess || categoryNames.length === 0 || editSelected.size > 0

  async function confirmEdit() {
    if (!editing || !isValidDate(editDate) || !editScopeValid) return
    setSavingEdit(true)
    setError(null)
    try {
      const saved = await saveGrantedAccess(
        editing.email,
        editDate,
        scopeForSave(editSelected, categoryNames, editAllAccess),
        user?.email ?? '',
      )
      setNotice({
        kind: 'success',
        message: `Updated ${saved.email}: ${scopeLabel(saved)} until ${saved.expires_at}.`,
      })
      setEditing(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update granted access.')
    } finally {
      setSavingEdit(false)
    }
  }

  async function confirmRemove() {
    if (!removing) return
    setRemovingBusy(true)
    setError(null)
    try {
      await deleteGrantedAccess(removing.email)
      setNotice({ kind: 'warning', message: `Removed granted access for ${removing.email}.` })
      setRemoving(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove granted access.')
    } finally {
      setRemovingBusy(false)
    }
  }

  return (
    <div className="admin-app">
      <AdminNav />
      <main className="admin-page">
        <div className="admin-page-head">
          <h2>Granted Access</h2>
        </div>

        <form className="admin-grant-form" onSubmit={handleGrant}>
          <div className="admin-grant-row">
            <input
              type="email"
              className={flash?.email ? 'admin-flash' : undefined}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="user@example.com"
              autoComplete="off"
            />
            <div className="admin-expiry-picker">
              <select
                className={flash?.duration ? 'admin-flash' : undefined}
                value={newDuration}
                onChange={handleDurationChange}
                title="Access duration from today"
              >
                <option value="" disabled>
                  Pick duration
                </option>
                {newDuration === 'custom' && (
                  <option value="custom" disabled>
                    {newDate}
                  </option>
                )}
                {DURATION_OPTIONS.map((option) => (
                  <option key={option.months} value={String(option.months)}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="admin-calendar-toggle"
                onClick={openDatePicker}
                title="Pick a specific date (up to 1 year from today)"
                aria-label="Pick a specific expiry date"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </button>
              <input
                ref={datePickerRef}
                type="date"
                className="admin-date-input-hidden"
                value={newDate}
                min={today}
                max={maxDate}
                onChange={(e) => {
                  setNewDate(e.target.value)
                  setNewDuration('custom')
                }}
                tabIndex={-1}
                aria-hidden="true"
                title="Access expires at the end of this day"
              />
            </div>
            <button
              type="submit"
              className={`admin-button admin-button-sm admin-grant-submit${canGrant ? '' : ' admin-grant-submit-inactive'}`}
              disabled={granting}
              aria-busy={granting}
            >
              {granting ? <span className="admin-spinner" aria-hidden="true" /> : 'Grant access'}
            </button>
          </div>
          <CategoryScopePicker
            categoryNames={categoryNames}
            selected={newSelected}
            onChange={setNewSelected}
            allAccess={newAllAccess}
            onAllAccessChange={setNewAllAccess}
            invalid={flash?.scope ?? false}
          />
        </form>

        {notice && <p className={`admin-notice admin-notice-${notice.kind}`}>{notice.message}</p>}
        {error && <p className="admin-error">{error}</p>}

        {loading ? (
          <p className="admin-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="admin-muted">No granted emails yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Access until</th>
                <th>Category access</th>
                <th>Status</th>
                <th>Granted by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const active = row.expires_at >= today
                return (
                  <tr key={row.email}>
                    <td>{row.email}</td>
                    <td>{row.expires_at}</td>
                    <td className="admin-grant-cats">
                      {row.access_type === 'all' ? (
                        'All (full access)'
                      ) : (
                        <span title={row.categories?.join(', ')}>{row.categories?.join(', ')}</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`admin-badge ${active ? 'admin-badge-active' : 'admin-badge-expired'}`}
                      >
                        {active ? 'Active' : 'Expired'}
                      </span>
                    </td>
                    <td className="admin-muted">{row.granted_by ?? '—'}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button className="admin-link-button" onClick={() => startEdit(row)}>
                          Edit
                        </button>
                        <button className="admin-link-button" onClick={() => setRemoving(row)}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <p className="admin-board-hint admin-muted">
          Grants run through the end of the cutoff day. “All categories” grants behave exactly like
          a subscription (no paywall, no locks, breathing exercises included); category-scoped
          grants unlock only entries in the selected categories. The app re-checks on launch, login
          and whenever it returns to the foreground.
        </p>
      </main>

      {editing && (
        <div className="admin-modal-overlay" onClick={() => !savingEdit && setEditing(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit grant</h3>
            <p>
              <strong>{editing.email}</strong>
            </p>
            <div className="admin-form">
              <label className="admin-field">
                <span>Access until (end of day)</span>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  autoFocus
                />
              </label>
            </div>
            <CategoryScopePicker
              categoryNames={categoryNames}
              selected={editSelected}
              onChange={setEditSelected}
              allAccess={editAllAccess}
              onAllAccessChange={setEditAllAccess}
            />
            <div className="admin-modal-actions">
              <button
                className="admin-button admin-button-ghost"
                onClick={() => setEditing(null)}
                disabled={savingEdit}
              >
                Cancel
              </button>
              <button
                className="admin-button"
                onClick={confirmEdit}
                disabled={savingEdit || !isValidDate(editDate) || !editScopeValid}
              >
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {removing && (
        <div className="admin-modal-overlay" onClick={() => !removingBusy && setRemoving(null)}>
          <div className="admin-modal admin-modal-danger" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-danger-title">Remove granted access</h3>
            <p>
              Are you sure? <strong>{removing.email}</strong> will lose the granted access the
              next time the app checks.
            </p>
            <div className="admin-modal-actions">
              <button
                className="admin-button admin-button-ghost"
                onClick={() => setRemoving(null)}
                disabled={removingBusy}
              >
                Cancel
              </button>
              <button
                className="admin-button-danger"
                onClick={confirmRemove}
                disabled={removingBusy}
              >
                {removingBusy ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

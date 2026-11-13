import { useEffect, useRef, useState } from 'react'
import { AdminNav } from '../components/AdminNav'
import { useAuth } from '../auth/AuthContext'
import { fetchCategories } from '../lib/entries'
import {
  fetchGrantedAccess,
  saveGrantedAccess,
  deleteGrantedAccess,
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

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
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

// Selecting every category is stored as null ("all"), which keeps future
// categories covered and behaves exactly like a subscription. When no
// categories can be loaded we fail safe to full access (the picker shows a
// warning so this never happens silently).
function scopeForSave(selected: Set<string>, categoryNames: string[]): string[] | null {
  if (categoryNames.length === 0) return null
  if (selected.size >= categoryNames.length) return null
  return Array.from(selected)
}

function scopeLabel(categories: string[] | null): string {
  if (categories === null) return 'all categories'
  const n = categories.length
  return `${n} ${n === 1 ? 'category' : 'categories'}`
}

function CategoryScopePicker({
  categoryNames,
  selected,
  onChange,
}: {
  categoryNames: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const allSelected = categoryNames.length > 0 && selected.size >= categoryNames.length
  return (
    <div className="admin-category-scope">
      <div className="admin-category-scope-head">
        <span className="admin-category-scope-title">Category access</span>
        <div className="admin-category-scope-actions">
          <button
            type="button"
            className="admin-link-button"
            onClick={() => onChange(new Set(categoryNames))}
          >
            Select all
          </button>
          <button type="button" className="admin-link-button" onClick={() => onChange(new Set())}>
            Deselect all
          </button>
        </div>
      </div>
      {categoryNames.length === 0 ? (
        <p className="admin-muted admin-category-scope-hint">
          No categories could be loaded — the grant will cover all categories (full access).
        </p>
      ) : (
        <>
          <div className="admin-category-scope-grid">
            {categoryNames.map((name) => (
              <label key={name} className="admin-check admin-category-scope-item">
                <input
                  type="checkbox"
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
          <p className="admin-muted admin-category-scope-hint">
            {allSelected
              ? 'All categories selected — full subscriber access, same as a subscription.'
              : selected.size === 0
                ? 'Select at least one category (or all) to grant access.'
                : 'Only the selected categories are unlocked; everything else stays locked.'}
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
  const [notice, setNotice] = useState<{ kind: 'success' | 'warning'; message: string } | null>(
    null,
  )
  const [newEmail, setNewEmail] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newDuration, setNewDuration] = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)
  // null = not initialized yet -> defaults to "all categories" once loaded
  const [newSelected, setNewSelected] = useState<Set<string> | null>(null)
  const [granting, setGranting] = useState(false)
  const [editing, setEditing] = useState<GrantedAccess | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editSelected, setEditSelected] = useState<Set<string>>(new Set())
  const [savingEdit, setSavingEdit] = useState(false)
  const [removing, setRemoving] = useState<GrantedAccess | null>(null)
  const [removingBusy, setRemovingBusy] = useState(false)
  const datePickerRef = useRef<HTMLInputElement>(null)

  const newSelection = newSelected ?? new Set(categoryNames)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    if (showDatePicker) datePickerRef.current?.showPicker?.()
  }, [showDatePicker])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [grants, cats] = await Promise.all([fetchGrantedAccess(), fetchCategories()])
      setRows(grants)
      setCategoryNames(cats)
      setNewSelected((prev) => prev ?? new Set(cats))
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
  const newScopeValid = categoryNames.length === 0 || newSelection.size > 0

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault()
    const email = newEmail.trim()
    if (!EMAIL_RE.test(email) || !newDateValid || !newScopeValid) return
    setGranting(true)
    setError(null)
    try {
      const saved = await saveGrantedAccess(
        email,
        newDate,
        scopeForSave(newSelection, categoryNames),
        user?.email ?? '',
      )
      setNotice({
        kind: 'success',
        message: `Granted ${saved.email} access to ${scopeLabel(saved.categories)} until ${saved.expires_at}.`,
      })
      setNewEmail('')
      setNewDate('')
      setNewDuration('')
      setShowDatePicker(false)
      setNewSelected(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant access.')
    } finally {
      setGranting(false)
    }
  }

  function handleDurationChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const months = Number(e.target.value)
    if (!Number.isInteger(months) || months < 1) return
    setNewDuration(e.target.value)
    setNewDate(addMonthsISO(todayString(), months))
    setShowDatePicker(false)
  }

  function toggleDatePicker() {
    setShowDatePicker((open) => !open)
  }

  function startEdit(row: GrantedAccess) {
    setEditing(row)
    setEditDate(row.expires_at)
    // Scoped grants keep only categories that still exist; "all" grants
    // prefill with the full list.
    setEditSelected(
      row.categories === null
        ? new Set(categoryNames)
        : new Set(row.categories.filter((c) => categoryNames.includes(c))),
    )
    setError(null)
  }

  const editScopeValid = categoryNames.length === 0 || editSelected.size > 0

  async function confirmEdit() {
    if (!editing || !isValidDate(editDate) || !editScopeValid) return
    setSavingEdit(true)
    setError(null)
    try {
      const saved = await saveGrantedAccess(
        editing.email,
        editDate,
        scopeForSave(editSelected, categoryNames),
        user?.email ?? '',
      )
      setNotice({
        kind: 'success',
        message: `Updated ${saved.email}: ${scopeLabel(saved.categories)} until ${saved.expires_at}.`,
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
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="user@example.com"
              autoComplete="off"
            />
            <div className="admin-expiry-picker">
              <select
                value={newDuration}
                onChange={handleDurationChange}
                title="Access duration from today"
              >
                <option value="" disabled>
                  Pick duration
                </option>
                {newDuration === 'custom' && (
                  <option value="custom" disabled>
                    {newDate ? `Custom date (${newDate})` : 'Custom date'}
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
                className={`admin-calendar-toggle${showDatePicker ? ' admin-calendar-toggle-active' : ''}`}
                onClick={toggleDatePicker}
                title="Pick a specific date (up to 1 year from today)"
                aria-label="Pick a specific expiry date"
                aria-expanded={showDatePicker}
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
              {showDatePicker && (
                <input
                  ref={datePickerRef}
                  type="date"
                  value={newDate}
                  min={today}
                  max={maxDate}
                  onChange={(e) => {
                    setNewDate(e.target.value)
                    setNewDuration('custom')
                  }}
                  title="Access expires at the end of this day"
                />
              )}
            </div>
            <button
              type="submit"
              className="admin-button admin-button-sm"
              disabled={granting || !newEmailValid || !newDateValid || !newScopeValid}
            >
              {granting ? 'Granting…' : 'Grant access'}
            </button>
          </div>
          <CategoryScopePicker
            categoryNames={categoryNames}
            selected={newSelection}
            onChange={setNewSelected}
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
                      {row.categories === null ? (
                        'All categories'
                      ) : (
                        <span title={row.categories.join(', ')}>{row.categories.join(', ')}</span>
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

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminNav } from '../components/AdminNav'
import { deleteEntry, fetchEntries, type Entry } from '../lib/entries'

export function EntriesPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setEntries(await fetchEntries())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load entries.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleDelete(id: number) {
    if (!window.confirm('Delete this entry? This cannot be undone.')) return
    try {
      await deleteEntry(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete entry.')
    }
  }

  return (
    <div className="admin-app">
      <AdminNav />
      <main className="admin-page">
        <div className="admin-page-head">
          <h2>Entries</h2>
          <Link to="/entries/new" className="admin-button">
            New entry
          </Link>
        </div>
        {error && <p className="admin-error">{error}</p>}
        {loading ? (
          <p className="admin-muted">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="admin-muted">No entries yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Author</th>
                <th>Category</th>
                <th>Free</th>
                <th>Number</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.id}</td>
                  <td>{entry.title}</td>
                  <td>{entry.author ?? '—'}</td>
                  <td>{entry.category ?? '—'}</td>
                  <td>{entry.free ? 'Yes' : 'No'}</td>
                  <td>{entry.number ?? '—'}</td>
                  <td className="admin-row-actions">
                    <Link to={`/entries/${entry.id}/edit`}>Edit</Link>
                    <button
                      className="admin-link-button"
                      onClick={() => handleDelete(entry.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  )
}

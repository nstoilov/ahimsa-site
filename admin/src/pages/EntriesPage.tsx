import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { AdminNav } from '../components/AdminNav'
import { EntryCard } from '../components/EntryCard'
import {
  createCategory,
  deleteCategory,
  fetchCategoryOrder,
  fetchEntries,
  updateEntriesOrder,
  type CategoryOrder,
  type Entry,
  type OrderUpdate,
} from '../lib/entries'

const UNCATEGORIZED_KEY = '__uncategorized__'

type Container = {
  key: string
  label: string
  entries: Entry[]
}

function sortEntries(arr: Entry[]): Entry[] {
  return [...arr].sort((a, b) => {
    const na = a.number
    const nb = b.number
    if (na != null && nb != null) return na - nb
    if (na != null) return -1
    if (nb != null) return 1
    return a.free === b.free ? 0 : a.free ? -1 : 1
  })
}

function buildContainers(
  entries: Entry[],
  categoryOrder: CategoryOrder[],
): Container[] {
  const orderedNames = categoryOrder
    .slice()
    .sort((a, b) => a.display_order - b.display_order)
    .map((c) => c.name)
  const knownCategories = new Set(orderedNames)
  const extraNames = [
    ...new Set(
      entries
        .map((e) => e.category)
        .filter((c): c is string => !!c && !knownCategories.has(c)),
    ),
  ].sort()
  const allNames = [...orderedNames, ...extraNames]

  const containers: Container[] = []
  containers.push({
    key: UNCATEGORIZED_KEY,
    label: 'Uncategorized',
    entries: sortEntries(entries.filter((e) => !e.category)),
  })
  for (const name of allNames) {
    containers.push({
      key: name,
      label: name,
      entries: sortEntries(entries.filter((e) => e.category === name)),
    })
  }
  return containers
}

function renumber(container: Container): Container {
  return {
    ...container,
    entries: container.entries.map((e, i) => ({ ...e, number: i + 1 })),
  }
}

function CategorySection({
  container,
  onDeleteCategory,
}: {
  container: Container
  onDeleteCategory?: (name: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: container.key })
  const itemIds = useMemo(() => container.entries.map((e) => String(e.id)), [container.entries])
  const isCategory = container.key !== UNCATEGORIZED_KEY

  return (
    <section className={`admin-category${isOver ? ' is-over' : ''}`}>
      <header className="admin-category-head">
        <h3>{container.label}</h3>
        <span className="admin-muted">{container.entries.length}</span>
        {isCategory && onDeleteCategory && (
          <button
            className="admin-link-button"
            onClick={() => onDeleteCategory(container.key)}
          >
            Remove category
          </button>
        )}
      </header>
      <div ref={setNodeRef} className="admin-cards">
        <SortableContext items={itemIds} strategy={rectSortingStrategy}>
          {container.entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </SortableContext>
      </div>
    </section>
  )
}

export function EntriesPage() {
  const [containers, setContainers] = useState<Container[]>([])
  const [original, setOriginal] = useState<Map<number, Entry>>(new Map())
  const categoryOrderRef = useRef<CategoryOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newCategory, setNewCategory] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [entries, categoryOrder] = await Promise.all([
        fetchEntries(),
        fetchCategoryOrder(),
      ])
      setContainers(buildContainers(entries, categoryOrder))
      setOriginal(new Map(entries.map((e) => [e.id, e])))
      categoryOrderRef.current = categoryOrder
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load entries.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)

    setContainers((prev) => {
      const next = prev.map((c) => ({ ...c, entries: [...c.entries] }))
      const srcIdx = next.findIndex((c) =>
        c.entries.some((e) => String(e.id) === activeId),
      )
      if (srcIdx === -1) return prev
      const moved = next[srcIdx].entries.find((e) => String(e.id) === activeId)
      if (!moved) return prev

      const withoutMoved: Container = {
        ...next[srcIdx],
        entries: next[srcIdx].entries.filter((e) => String(e.id) !== activeId),
      }
      next[srcIdx] = withoutMoved

      let dstIdx: number
      let insertIdx: number
      const containerMatch = next.findIndex((c) => c.key === overId)
      if (containerMatch !== -1) {
        dstIdx = containerMatch
        insertIdx = next[dstIdx].entries.length
      } else {
        const found = next.findIndex((c) =>
          c.entries.some((e) => String(e.id) === overId),
        )
        if (found === -1) return prev
        dstIdx = found
        insertIdx = next[dstIdx].entries.findIndex((e) => String(e.id) === overId)
      }

      const dstKey = next[dstIdx].key
      const movedWithCategory: Entry = {
        ...moved,
        category: dstKey === UNCATEGORIZED_KEY ? null : dstKey,
      }
      const newDstEntries = [...next[dstIdx].entries]
      newDstEntries.splice(insertIdx, 0, movedWithCategory)
      next[dstIdx] = { ...next[dstIdx], entries: newDstEntries }

      next[srcIdx] = renumber(next[srcIdx])
      next[dstIdx] = renumber(next[dstIdx])

      setDirty(true)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const updates: OrderUpdate[] = []
      for (const c of containers) {
        for (const e of c.entries) {
          const orig = original.get(e.id)
          if (orig && (orig.category !== e.category || orig.number !== e.number)) {
            updates.push({ id: e.id, category: e.category, number: e.number })
          }
        }
      }
      if (updates.length > 0) {
        await updateEntriesOrder(updates)
      }
      const fresh = containers.flatMap((c) => c.entries)
      setOriginal(new Map(fresh.map((e) => [e.id, { ...e }])))
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    const entries = Array.from(original.values())
    setContainers(buildContainers(entries, categoryOrderRef.current))
    setDirty(false)
  }

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault()
    const name = newCategory.trim()
    if (!name) return
    try {
      await createCategory(name)
      setNewCategory('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create category.')
    }
  }

  async function handleDeleteCategory(name: string) {
    if (!window.confirm(`Remove category "${name}"? Entries keep their category label but will no longer be ordered here.`)) return
    try {
      await deleteCategory(name)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove category.')
    }
  }

  return (
    <div className="admin-app">
      <AdminNav />
      <main className="admin-page admin-board-page">
        <div className="admin-page-head">
          <h2>Entries</h2>
          <div className="admin-page-actions">
            <Link to="/entries/new" className="admin-button">
              New entry
            </Link>
          </div>
        </div>

        <form className="admin-new-category" onSubmit={handleCreateCategory}>
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="New category name"
          />
          <button type="submit" className="admin-button admin-button-sm" disabled={!newCategory.trim()}>
            Add category
          </button>
        </form>

        {error && <p className="admin-error">{error}</p>}
        {loading ? (
          <p className="admin-muted">Loading…</p>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            {containers.map((c) => (
              <CategorySection
                key={c.key}
                container={c}
                onDeleteCategory={handleDeleteCategory}
              />
            ))}
          </DndContext>
        )}

        <p className="admin-board-hint admin-muted">
          Drag cards to reorder within a category or move them across categories. Click Save changes to persist.
        </p>
      </main>

      {dirty && (
        <div className="admin-floating-bar">
          <button
            className="admin-button admin-button-ghost"
            onClick={handleCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button className="admin-button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}

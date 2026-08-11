import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AdminNav } from '../components/AdminNav'
import {
  createCategory,
  deleteCategory,
  categoryTypeSets,
  fetchCategoryOrder,
  fetchEntries,
  updateCategoryOrder,
  type CategoryOrder,
  type CategoryOrderUpdate,
} from '../lib/entries'

function categoryTypeBadge(name: string, audioCats: Set<string>, videoCats: Set<string>): string | null {
  const isAudio = audioCats.has(name)
  const isVideo = videoCats.has(name)
  if (isAudio && isVideo) return 'mixed'
  if (isAudio) return 'audio'
  if (isVideo) return 'video'
  return null
}

function SortableCategory({
  category,
  entryCount,
  audioCategories,
  videoCategories,
  onRemove,
}: {
  category: CategoryOrder
  entryCount: number
  audioCategories: Set<string>
  videoCategories: Set<string>
  onRemove: (name: string, hasEntries: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: category.name })
  const hasEntries = entryCount > 0
  const inferred = categoryTypeBadge(category.name, audioCategories, videoCategories)
  const type = inferred ?? (category.type === 'video' ? 'video' : 'audio')
  return (
    <div
      ref={setNodeRef}
      className={`admin-sort-row${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <span className="admin-sort-grip">⋮⋮</span>
      <span className="admin-sort-name">{category.name}</span>
      <span className={`admin-badge admin-badge-${type}`}>{type}</span>
      <span className="admin-muted">{entryCount} {entryCount === 1 ? 'entry' : 'entries'}</span>
      <button
        className={`admin-button-danger admin-button-sm${hasEntries ? ' admin-button-disabled' : ''}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onRemove(category.name, hasEntries)
        }}
      >
        Remove
      </button>
    </div>
  )
}

export function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryOrder[]>([])
  const [original, setOriginal] = useState<CategoryOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIsVideo, setNewIsVideo] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removingBusy, setRemovingBusy] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [entryCounts, setEntryCounts] = useState<Record<string, number>>({})
  const [audioCategories, setAudioCategories] = useState<Set<string>>(new Set())
  const [videoCategories, setVideoCategories] = useState<Set<string>>(new Set())
  const originalRef = useRef<CategoryOrder[]>([])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [data, entries] = await Promise.all([
        fetchCategoryOrder(),
        fetchEntries(),
      ])
      setCategories(data)
      setOriginal(data)
      originalRef.current = data
      const counts: Record<string, number> = {}
      for (const e of entries) {
        const cat = e.media_type === 'video' ? e.video_category : e.category
        if (cat) counts[cat] = (counts[cat] ?? 0) + 1
      }
      setEntryCounts(counts)
      const { audio, video } = categoryTypeSets(entries, data)
      setAudioCategories(audio)
      setVideoCategories(video)
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load categories.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setCategories((prev) => {
      const oldIndex = prev.findIndex((c) => c.name === active.id)
      const newIndex = prev.findIndex((c) => c.name === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      const moved = arrayMove(prev, oldIndex, newIndex).map((c, i) => ({
        ...c,
        display_order: i + 1,
      }))
      setDirty(true)
      return moved
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const updates: CategoryOrderUpdate[] = []
      for (const c of categories) {
        const orig = original.find((o) => o.name === c.name)
        if (orig && orig.display_order !== c.display_order) {
          updates.push({ name: c.name, display_order: c.display_order })
        }
      }
      if (updates.length > 0) {
        await updateCategoryOrder(updates)
      }
      setOriginal(categories.map((c) => ({ ...c })))
      originalRef.current = categories.map((c) => ({ ...c }))
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setCategories(originalRef.current.map((c) => ({ ...c })))
    setDirty(false)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    try {
      await createCategory(name, newIsVideo ? 'video' : 'audio')
      setNewName('')
      setNewIsVideo(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create category.')
    }
  }

  async function confirmRemove() {
    if (!removing) return
    setRemovingBusy(true)
    setError(null)
    try {
      await deleteCategory(removing)
      setRemoving(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove category.')
    } finally {
      setRemovingBusy(false)
    }
  }

  return (
    <div className="admin-app">
      <AdminNav />
      <main className="admin-page">
        <div className="admin-page-head">
          <h2>Categories</h2>
        </div>

        <form className="admin-new-category" onSubmit={handleCreate}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New category name"
          />
          <label className="admin-check">
            <input
              type="checkbox"
              checked={newIsVideo}
              onChange={(e) => setNewIsVideo(e.target.checked)}
            />
            <span>Video</span>
          </label>
          <button
            type="submit"
            className="admin-button admin-button-sm"
            disabled={!newName.trim()}
          >
            Add category
          </button>
        </form>

        {error && <p className="admin-error">{error}</p>}
        {loading ? (
          <p className="admin-muted">Loading…</p>
        ) : categories.length === 0 ? (
          <p className="admin-muted">No categories yet.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={categories.map((c) => c.name)}
              strategy={verticalListSortingStrategy}
            >
              <div className="admin-sort-list">
                {categories.map((c) => (
                  <SortableCategory
                    key={c.name}
                    category={c}
                    entryCount={entryCounts[c.name] ?? 0}
                    audioCategories={audioCategories}
                    videoCategories={videoCategories}
                    onRemove={(name, hasEntries) =>
                      hasEntries ? setBlocked(name) : setRemoving(name)
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <p className="admin-board-hint admin-muted">
          Drag rows to reorder categories. New categories are added at the end.
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

      {removing && (
        <div className="admin-modal-overlay" onClick={() => !removingBusy && setRemoving(null)}>
          <div className="admin-modal admin-modal-danger" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-danger-title">Remove category</h3>
            <p>
              Are you sure? This cannot be undone.
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
                {removingBusy ? 'Removing…' : 'Remove category'}
              </button>
            </div>
          </div>
        </div>
      )}

      {blocked && (
        <div className="admin-modal-overlay" onClick={() => setBlocked(null)}>
          <div className="admin-modal admin-modal-danger" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-danger-title">Cannot remove category</h3>
            <p>
              <strong>{blocked}</strong> still has entries.
            </p>
            <p className="admin-modal-danger-text">
              To delete, first remove all entries from this category.
            </p>
            <div className="admin-modal-actions">
              <button
                className="admin-button admin-button-ghost"
                onClick={() => setBlocked(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

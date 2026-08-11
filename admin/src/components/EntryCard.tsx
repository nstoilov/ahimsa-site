import { useMemo, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link } from 'react-router-dom'
import { type Entry } from '../lib/entries'
import { getImageUrl } from '../lib/media'

export type CategoryOption = {
  key: string
  label: string
}

function filterCompatibleOptions(
  options: CategoryOption[],
  entry: Entry,
  audioCats: Set<string>,
  videoCats: Set<string>,
): CategoryOption[] {
  return options.filter((opt) => {
    if (opt.key === '__uncategorized__') return true
    const isAudioCat = audioCats.has(opt.key)
    const isVideoCat = videoCats.has(opt.key)
    if (entry.media_type === 'audio') {
      return !(isVideoCat && !isAudioCat)
    }
    if (entry.media_type === 'video') {
      return !(isAudioCat && !isVideoCat)
    }
    return true
  })
}

export function EntryCard({
  entry,
  categoryOptions,
  audioCategories,
  videoCategories,
  onMove,
  dragEnabled,
}: {
  entry: Entry
  categoryOptions: CategoryOption[]
  audioCategories: Set<string>
  videoCategories: Set<string>
  onMove: (entryId: number, targetKey: string) => void
  dragEnabled: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(entry.id),
    disabled: !dragEnabled,
  })
  const [imgFailed, setImgFailed] = useState(false)
  const imgUrl = getImageUrl(entry.image_url)

  const compatibleOptions = useMemo(
    () => filterCompatibleOptions(categoryOptions, entry, audioCategories, videoCategories),
    [categoryOptions, entry, audioCategories, videoCategories],
  )

  return (
    <div
      ref={setNodeRef}
      className={`admin-card${isDragging ? ' is-dragging' : ''}${dragEnabled ? ' is-draggable' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...(dragEnabled ? listeners : {})}
    >
      {compatibleOptions.length > 1 && (
        <div className="admin-card-move">
          <select
            value=""
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const key = e.target.value
              if (key) onMove(entry.id, key)
              e.target.value = ''
            }}
            aria-label="Move to category"
          >
            <option value="" disabled>
              ↕️
            </option>
            {compatibleOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="admin-card-image">
        {imgUrl && !imgFailed ? (
          <img
            src={imgUrl}
            alt={entry.title}
            draggable={false}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="admin-card-placeholder" />
        )}
      </div>
      <div className="admin-card-body">
        <span className="admin-card-title">{entry.title}</span>
        {entry.author && <span className="admin-card-author">{entry.author}</span>}
      </div>
      <div className="admin-card-footer">
        <div className="admin-card-badges">
          <span className="admin-badge" title={`Media type: ${entry.media_type}`}>
            {entry.media_type === 'video' ? '🎬 Video' : '🎧 Audio'}
          </span>
          {entry.free ? (
            <span className="admin-badge">Free</span>
          ) : (
            <span className="admin-badge admin-badge-paid">Paid</span>
          )}
        </div>
        <Link
          to={`/entries/${entry.id}/edit`}
          className="admin-card-edit"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          Edit
        </Link>
      </div>
    </div>
  )
}
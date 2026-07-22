import { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link } from 'react-router-dom'
import { getSignedMediaUrl, type Entry } from '../lib/entries'

export function EntryCard({ entry }: { entry: Entry }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(entry.id),
  })
  const [imgUrl, setImgUrl] = useState<string | null>(null)

  useEffect(() => {
    getSignedMediaUrl('images', entry.image_url)
      .then(setImgUrl)
      .catch(() => setImgUrl(null))
  }, [entry.image_url])

  return (
    <div
      ref={setNodeRef}
      className={`admin-card${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <div className="admin-card-image">
        {imgUrl ? (
          <img src={imgUrl} alt={entry.title} draggable={false} />
        ) : (
          <div className="admin-card-placeholder" />
        )}
      </div>
      <div className="admin-card-body">
        <span className="admin-card-title">{entry.title}</span>
        {entry.author && <span className="admin-card-author">{entry.author}</span>}
      </div>
      <div className="admin-card-footer">
        {entry.free ? (
          <span className="admin-badge">Free</span>
        ) : (
          <span className="admin-badge admin-badge-paid">Paid</span>
        )}
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

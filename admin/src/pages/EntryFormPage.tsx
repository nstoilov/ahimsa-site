import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AdminNav } from '../components/AdminNav'
import {
  createEntry,
  deleteMedia,
  fetchCategories,
  fetchEntry,
  getSignedMediaUrl,
  updateEntry,
  uploadMedia,
  type EntryInput,
} from '../lib/entries'

type Mode = 'create' | 'edit'

export function EntryFormPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const mode: Mode = id ? 'edit' : 'create'
  const entryId = id ? Number(id) : NaN

  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [category, setCategory] = useState('')
  const [free, setFree] = useState(false)
  const [number, setNumber] = useState('')
  const [categories, setCategories] = useState<string[]>([])

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [audioPreview, setAudioPreview] = useState<string | null>(null)
  const [existingImagePath, setExistingImagePath] = useState<string | null>(null)
  const [existingAudioPath, setExistingAudioPath] = useState<string | null>(null)

  const [loading, setLoading] = useState(mode === 'edit')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const imageInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => {
        // categories are optional suggestions; ignore failures
      })
  }, [])

  useEffect(() => {
    if (mode !== 'edit') return
    let cancelled = false
    ;(async () => {
      try {
        const entry = await fetchEntry(entryId)
        if (cancelled) return
        setTitle(entry.title)
        setAuthor(entry.author ?? '')
        setCategory(entry.category ?? '')
        setFree(entry.free)
        setNumber(entry.number?.toString() ?? '')
        setExistingImagePath(entry.image_url)
        setExistingAudioPath(entry.audio_url)
        try {
          setImagePreview(await getSignedMediaUrl('images', entry.image_url))
        } catch {
          // preview optional
        }
        try {
          setAudioPreview(await getSignedMediaUrl('audio', entry.audio_url))
        } catch {
          // preview optional
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load entry.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [entryId, mode])

  function onPickImage(file: File | null) {
    setImageFile(file)
    setImagePreview(file ? URL.createObjectURL(file) : existingImagePath ? null : null)
  }

  function onPickAudio(file: File | null) {
    setAudioFile(file)
    setAudioPreview(file ? URL.createObjectURL(file) : existingAudioPath ? null : null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    if (!imageFile && !existingImagePath) {
      setError('An image is required.')
      return
    }
    if (!audioFile && !existingAudioPath) {
      setError('An audio file is required.')
      return
    }

    setSubmitting(true)
    try {
      let imagePath = existingImagePath
      let audioPath = existingAudioPath

      if (imageFile) {
        imagePath = await uploadMedia('images', imageFile)
        if (existingImagePath) {
          await deleteMedia('images', existingImagePath).catch(() => {})
        }
      }
      if (audioFile) {
        audioPath = await uploadMedia('audio', audioFile)
        if (existingAudioPath) {
          await deleteMedia('audio', existingAudioPath).catch(() => {})
        }
      }

      const input: EntryInput = {
        title: title.trim(),
        author: author.trim() || null,
        image_url: imagePath as string,
        audio_url: audioPath as string,
        category: category.trim() || null,
        free,
        number: number.trim() === '' ? null : Number(number),
      }

      if (mode === 'create') {
        await createEntry(input)
      } else {
        await updateEntry(entryId, input)
      }
      navigate('/entries', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save entry.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="admin-app">
        <AdminNav />
        <main className="admin-page">
          <p className="admin-muted">Loading…</p>
        </main>
      </div>
    )
  }

  return (
    <div className="admin-app">
      <AdminNav />
      <main className="admin-page">
        <div className="admin-page-head">
          <h2>{mode === 'create' ? 'New entry' : 'Edit entry'}</h2>
          <button
            className="admin-link-button"
            onClick={() => navigate('/entries')}
          >
            Back
          </button>
        </div>

        <form className="admin-form" onSubmit={handleSubmit}>
          <label className="admin-field">
            <span>Title *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </label>

          <label className="admin-field">
            <span>Author</span>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Optional"
            />
          </label>

          <label className="admin-field">
            <span>Category</span>
            <input
              list="admin-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Optional"
            />
            <datalist id="admin-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          <div className="admin-form-row">
            <label className="admin-field">
              <span>Number</span>
              <input
                type="number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="Optional"
              />
            </label>

            <label className="admin-check">
              <input
                type="checkbox"
                checked={free}
                onChange={(e) => setFree(e.target.checked)}
              />
              <span>Free</span>
            </label>
          </div>

          <div className="admin-field">
            <span>Cover image *</span>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
            />
            {imagePreview && (
              <img className="admin-preview" src={imagePreview} alt="Cover preview" />
            )}
          </div>

          <div className="admin-field">
            <span>Audio file *</span>
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              onChange={(e) => onPickAudio(e.target.files?.[0] ?? null)}
            />
            {audioPreview && (
              <audio className="admin-preview" src={audioPreview} controls />
            )}
          </div>

          {error && <p className="admin-error">{error}</p>}

          <button type="submit" className="admin-button" disabled={submitting}>
            {submitting ? 'Saving…' : mode === 'create' ? 'Create entry' : 'Save changes'}
          </button>
        </form>
      </main>
    </div>
  )
}

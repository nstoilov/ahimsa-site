import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AdminNav } from '../components/AdminNav'
import { useAuth } from '../auth/AuthContext'
import {
  createEntry,
  categoryTypeSets,
  deleteEntry,
  fetchCategoryOrder,
  fetchEntries,
  fetchEntry,
  fetchMaxNumberInCategory,
  updateEntry,
  type CategoryOrder,
  type Entry,
  type EntryInput,
  type MediaType,
} from '../lib/entries'
import { getAudioUrl, getImageUrl, getVideoUrl, prefixedR2Key } from '../lib/media'
import { deleteR2Objects, presignAndUpload } from '../lib/r2upload'

type Mode = 'create' | 'edit'

export function EntryFormPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { adminCategories, isFullAdmin } = useAuth()
  const mode: Mode = id ? 'edit' : 'create'
  const entryId = id ? Number(id) : NaN

  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [category, setCategory] = useState('')
  const [videoCategory, setVideoCategory] = useState('')
  const [free, setFree] = useState(false)
  const [categories, setCategories] = useState<CategoryOrder[]>([])
  const [originalCategory, setOriginalCategory] = useState<string | null>(null)
  const [originalVideoCategory, setOriginalVideoCategory] = useState<string | null>(null)
  const [originalNumber, setOriginalNumber] = useState<number | null>(null)

  const [mediaType, setMediaType] = useState<MediaType>('audio')
  const mediaTypeLocked = mode === 'edit'

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [audioPreview, setAudioPreview] = useState<string | null>(null)
  const [videoPreview, setVideoPreview] = useState<string | null>(null)
  const [existingImagePath, setExistingImagePath] = useState<string | null>(null)
  const [existingAudioPath, setExistingAudioPath] = useState<string | null>(null)
  const [existingVideoPath, setExistingVideoPath] = useState<string | null>(null)

  const [loading, setLoading] = useState(mode === 'edit')
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [upload, setUpload] = useState<{ label: string; percent: number } | null>(null)
  const [audioCategories, setAudioCategories] = useState<Set<string>>(new Set())
  const [videoCategories, setVideoCategories] = useState<Set<string>>(new Set())

  const imageInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetchCategoryOrder()
      .then(setCategories)
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error('[EntryForm] category_order read failed', e)
      })
    fetchEntries()
      .then((entries) => {
        fetchCategoryOrder()
          .then((order) => {
            const { audio, video } = categoryTypeSets(entries as Entry[], order)
            setAudioCategories(audio)
            setVideoCategories(video)
          })
          .catch((e) => {
            // eslint-disable-next-line no-console
            console.error('[EntryForm] category_order read failed', e)
          })
      })
      .catch(() => {
        // ignore failures
      })
  }, [])

  const rawAvailable = useMemo(
    () => {
      const names = categories.map((c) => c.name)
      if (adminCategories === null) return names
      return names.filter((c) => adminCategories.includes(c))
    },
    [categories, adminCategories],
  )

  const availableCategories = useMemo(() => {
    if (mediaType === 'audio') {
      return rawAvailable.filter(
        (c) => !(videoCategories.has(c) && !audioCategories.has(c)),
      )
    }
    if (mediaType === 'video') {
      return rawAvailable.filter(
        (c) => !(audioCategories.has(c) && !videoCategories.has(c)),
      )
    }
    return rawAvailable
  }, [rawAvailable, mediaType, audioCategories, videoCategories])

  const categoryDisabled =
    adminCategories !== null && adminCategories.length === 1

  useEffect(() => {
    if (mode === 'create' && categoryDisabled && availableCategories.length === 1) {
      if (mediaType === 'audio') {
        setCategory(availableCategories[0])
        setVideoCategory('')
      } else {
        setVideoCategory(availableCategories[0])
        setCategory('')
      }
    }
  }, [mode, categoryDisabled, availableCategories, mediaType])

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
        setVideoCategory(entry.video_category ?? '')
        setFree(entry.free)
        setMediaType(entry.media_type)
        setOriginalCategory(entry.category ?? null)
        setOriginalVideoCategory(entry.video_category ?? null)
        setOriginalNumber(entry.number ?? null)
        setExistingImagePath(entry.image_url)
        setExistingAudioPath(entry.audio_url)
        setExistingVideoPath(entry.video_url)
        setImagePreview(getImageUrl(entry.image_url))
        if (entry.media_type === 'audio' && entry.audio_url) {
          setAudioPreview(getAudioUrl(entry.audio_url))
        }
        if (entry.media_type === 'video' && entry.video_url) {
          setVideoPreview(getVideoUrl(entry.video_url))
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
    setImagePreview(
      file ? URL.createObjectURL(file) : existingImagePath ? getImageUrl(existingImagePath) : null,
    )
  }

  function onPickAudio(file: File | null) {
    setAudioFile(file)
    setAudioPreview(
      file ? URL.createObjectURL(file) : existingAudioPath ? getAudioUrl(existingAudioPath) : null,
    )
  }

  function onPickVideo(file: File | null) {
    setVideoFile(file)
    setVideoPreview(
      file ? URL.createObjectURL(file) : existingVideoPath ? getVideoUrl(existingVideoPath) : null,
    )
  }

  async function computeNumber(): Promise<number | null> {
    const isVideo = mediaType === 'video'
    const cat = isVideo ? videoCategory.trim() : category.trim()
    const field = isVideo ? 'video_category' : 'category'
    const origCat = isVideo ? originalVideoCategory : originalCategory
    if (!cat) return null
    if (mode === 'edit' && cat === origCat) return originalNumber
    const max = await fetchMaxNumberInCategory(field, cat)
    return max + 1
  }

  const hasCategory = !!(originalCategory || originalVideoCategory)

  async function handleDelete() {
    if (mode !== 'edit' || !isFullAdmin || hasCategory) return
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return
    setDeleting(true)
    setError(null)
    try {
      const keys: string[] = []
      if (existingImagePath) keys.push(prefixedR2Key('images', existingImagePath))
      if (existingAudioPath) keys.push(prefixedR2Key('audio', existingAudioPath))
      if (existingVideoPath) keys.push(prefixedR2Key('videos', existingVideoPath))
      await deleteEntry(entryId)
      let r2Warning: string | null = null
      try {
        await deleteR2Objects(keys)
      } catch (e) {
        r2Warning = e instanceof Error ? e.message : String(e)
      }
      navigate('/entries', { replace: true, state: { deletedEntry: title, r2Warning } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry.')
    } finally {
      setDeleting(false)
    }
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
    if (mediaType === 'audio' && !audioFile && !existingAudioPath) {
      setError('An audio file is required.')
      return
    }
    if (mediaType === 'video' && !videoFile && !existingVideoPath) {
      setError('A video file is required.')
      return
    }

    const isVideo = mediaType === 'video'
    const selectedCat = isVideo ? videoCategory.trim() : category.trim()
    const isAudioCat = audioCategories.has(selectedCat)
    const isVideoCat = videoCategories.has(selectedCat)
    if (isVideo && isAudioCat && !isVideoCat) {
      setError('This category is used for audio entries. Please select a video category.')
      return
    }
    if (!isVideo && isVideoCat && !isAudioCat) {
      setError('This category is used for video entries. Please select an audio category.')
      return
    }

    setSubmitting(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      let imagePath = existingImagePath
      let audioPath = existingAudioPath
      let videoPath = existingVideoPath

      if (imageFile) {
        setUpload({ label: 'Uploading image', percent: 0 })
        imagePath = await presignAndUpload('images', imageFile, (p) => setUpload({ label: 'Uploading image', percent: p }), controller.signal)
      }
      if (mediaType === 'audio' && audioFile) {
        setUpload({ label: 'Uploading audio', percent: 0 })
        audioPath = await presignAndUpload('audio', audioFile, (p) => setUpload({ label: 'Uploading audio', percent: p }), controller.signal)
      }
      if (mediaType === 'video' && videoFile) {
        setUpload({ label: 'Uploading video', percent: 0 })
        videoPath = await presignAndUpload('videos', videoFile, (p) => setUpload({ label: 'Uploading video', percent: p }), controller.signal)
      }

      const input: EntryInput = {
        title: title.trim(),
        author: author.trim() || null,
        image_url: imagePath as string,
        audio_url: isVideo ? '' : (audioPath as string),
        category: isVideo ? null : (category.trim() || null),
        video_category: isVideo ? (videoCategory.trim() || null) : null,
        free,
        media_type: mediaType,
        video_url: isVideo ? (videoPath ?? null) : null,
        number: await computeNumber(),
      }

      if (mode === 'create') {
        await createEntry(input)
      } else {
        await updateEntry(entryId, input)
      }
      navigate('/entries', { replace: true })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Upload cancelled.')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save entry.')
      }
    } finally {
      setUpload(null)
      abortRef.current = null
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

          <div className="admin-field">
            <span>
              Media type{' '}
              {mediaTypeLocked && (
                <span className="admin-muted">(locked after creation)</span>
              )}
            </span>
            <div className="admin-media-toggle" role="group" aria-label="Media type">
              <button
                type="button"
                disabled={mediaTypeLocked}
                className={mediaType === 'audio' ? 'is-active' : ''}
                onClick={() => {
                  setMediaType('audio')
                  setVideoCategory('')
                }}
              >
                Audio
              </button>
              <button
                type="button"
                disabled={mediaTypeLocked}
                className={mediaType === 'video' ? 'is-active' : ''}
                onClick={() => {
                  setMediaType('video')
                  setCategory('')
                }}
              >
                Video
              </button>
            </div>
          </div>

          <label className="admin-field">
            <span>Author</span>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Optional"
            />
          </label>

          {mediaType === 'audio' ? (
            <label className="admin-field">
              <span>Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={categoryDisabled}
              >
                {adminCategories === null && (
                  <option value="">No category</option>
                )}
                {availableCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                {mode === 'edit' &&
                  category &&
                  !availableCategories.includes(category) && (
                    <option value={category}>{category}</option>
                  )}
              </select>
            </label>
          ) : (
            <label className="admin-field">
              <span>Video category</span>
              <select
                value={videoCategory}
                onChange={(e) => setVideoCategory(e.target.value)}
                disabled={categoryDisabled}
              >
                {adminCategories === null && (
                  <option value="">No category</option>
                )}
                {availableCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                {mode === 'edit' &&
                  videoCategory &&
                  !availableCategories.includes(videoCategory) && (
                    <option value={videoCategory}>{videoCategory}</option>
                  )}
              </select>
            </label>
          )}

          <div className="admin-form-row">
            {mode === 'edit' && (
              <label className="admin-field">
                <span>
                  Number <span className="admin-muted">(set by drag-and-drop)</span>
                </span>
                <input
                  value={originalNumber ?? '—'}
                  readOnly
                  tabIndex={-1}
                  className="admin-readonly"
                />
              </label>
            )}

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

          {mediaType === 'audio' && (
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
          )}

          {mediaType === 'video' && (
            <div className="admin-field">
              <span>Video file *</span>
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                onChange={(e) => onPickVideo(e.target.files?.[0] ?? null)}
              />
              {videoPreview && (
                <video className="admin-preview admin-preview-video" src={videoPreview} controls />
              )}
            </div>
          )}

          {error && <p className="admin-error">{error}</p>}

          {upload && (
            <div className="admin-upload-progress">
              <div className="admin-upload-progress-head">
                <span>{upload.label} {Math.round(upload.percent * 100)}%</span>
                <button
                  type="button"
                  className="admin-button admin-button-sm admin-button-ghost"
                  onClick={() => abortRef.current?.abort()}
                >
                  Cancel
                </button>
              </div>
              <div className="admin-upload-progress-track">
                <div
                  className="admin-upload-progress-fill"
                  style={{ width: `${upload.percent * 100}%` }}
                />
              </div>
            </div>
          )}

          <button type="submit" className="admin-button" disabled={submitting || deleting}>
            {submitting ? 'Saving…' : mode === 'create' ? 'Create entry' : 'Save changes'}
          </button>

          {mode === 'edit' && isFullAdmin && (
            <div className="admin-delete-field">
              <button
                type="button"
                className="admin-button admin-button-danger"
                onClick={handleDelete}
                disabled={deleting || submitting || hasCategory}
              >
                {deleting ? 'Deleting…' : 'Delete entry'}
              </button>
              {hasCategory && (
                <span className="admin-muted admin-delete-hint">
                  Move the entry to Uncategorized first to enable deletion.
                </span>
              )}
            </div>
          )}
        </form>
      </main>
    </div>
  )
}
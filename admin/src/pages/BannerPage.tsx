import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AdminNav } from '../components/AdminNav'
import {
  fetchBannerConfig,
  saveBannerConfig,
  type BannerAction,
  type BannerConfigInput,
} from '../lib/banner'
import { fetchCategoryOptions, type CategoryOption } from '../lib/entries'
import { getImageUrl } from '../lib/media'
import { presignAndUpload } from '../lib/r2upload'

const APP_DEFAULT_GRADIENT_START = '#E8A33D'
const APP_DEFAULT_GRADIENT_END = '#D98A24'
const SAMPLE_PRICE = '12,99 лв.'

const HEX_RE = /^#[0-9A-Fa-f]{6}$/

const ALL_ACTIONS: BannerAction[] = ['paywall', 'link', 'none']
const SUBSCRIBER_ACTIONS: BannerAction[] = ['link', 'none']

const ACTION_LABELS: Record<BannerAction, string> = {
  paywall: 'Paywall',
  link: 'Link',
  none: 'None',
}

function normalizeActionFor(
  value: string,
  allowed: BannerAction[],
  fallback: BannerAction,
): BannerAction {
  const candidate = ALL_ACTIONS.includes(value as BannerAction) ? (value as BannerAction) : fallback
  return allowed.includes(candidate) ? candidate : fallback
}

function normalizeActionLink(value: string): string {
  const trimmed = value.trim()
  let candidate = trimmed
  if (/^ahimsaapp\.com\//i.test(candidate)) {
    candidate = `https://${candidate}`
  }
  try {
    const url = new URL(candidate)
    if (url.hostname.replace(/^www\./, '') === 'ahimsaapp.com') {
      return `${url.pathname}${url.search}${url.hash}`
    }
  } catch {
    // not a full URL — treat as an internal route
  }
  return trimmed
}

function loadImageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function hexLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrastRatio(a: string, b: string): number {
  const la = hexLuminance(a)
  const lb = hexLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

type BannerSectionProps = {
  bannerId: number
  heading: string
  description: string
  allowedActions: BannerAction[]
  fallbackAction: BannerAction
  defaultEnabled: boolean
  categories: CategoryOption[]
}

function BannerSection({
  bannerId,
  heading,
  description,
  categories,
  allowedActions,
  fallbackAction,
  defaultEnabled,
}: BannerSectionProps) {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [enabled, setEnabled] = useState(defaultEnabled)
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [gradientStart, setGradientStart] = useState('')
  const [gradientEnd, setGradientEnd] = useState('')
  const [bgMode, setBgMode] = useState<'gradient' | 'solid'>('gradient')
  const [backgroundColor, setBackgroundColor] = useState('')
  const [textColor, setTextColor] = useState('')
  const [action, setAction] = useState<BannerAction>(fallbackAction)
  const [actionLink, setActionLink] = useState('')

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [existingImageKey, setExistingImageKey] = useState<string | null>(null)
  const [imageLargeFile, setImageLargeFile] = useState<File | null>(null)
  const [imageLargePreview, setImageLargePreview] = useState<string | null>(null)
  const [existingImageLargeKey, setExistingImageLargeKey] = useState<string | null>(null)
  const [largeImageSize, setLargeImageSize] = useState<{ width: number; height: number } | null>(
    null,
  )
  const [upload, setUpload] = useState<{ label: string; percent: number } | null>(null)

  const imageInputRef = useRef<HTMLInputElement>(null)
  const imageLargeInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const largeSizeTokenRef = useRef(0)

  const paywallAllowed = allowedActions.includes('paywall')

  const selectedCategoryId = (() => {
    const trimmed = actionLink.trim()
    const match = categories.find((c) => trimmed === `/category-entries?id=${c.id}`)
    return match ? String(match.id) : ''
  })()

  function onPickCategory(value: string) {
    if (!value) {
      setActionLink('')
      return
    }
    setActionLink(`/category-entries?id=${value}`)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const config = await fetchBannerConfig(bannerId)
        if (cancelled || !config) return
        setEnabled(config.enabled)
        setTitle(config.title ?? '')
        setSubtitle(config.subtitle ?? '')
        setGradientStart(config.gradient_start ?? '')
        setGradientEnd(config.gradient_end ?? '')
        setBackgroundColor(config.background_color ?? '')
        setBgMode(config.background_color ? 'solid' : 'gradient')
        setTextColor(config.text_color ?? '')
        setAction(normalizeActionFor(config.action, allowedActions, fallbackAction))
        setActionLink(config.action_link ?? '')
        setExistingImageKey(config.image_key)
        setImagePreview(config.image_key ? getImageUrl(config.image_key) : null)
        setExistingImageLargeKey(config.image_large_key)
        const largeUrl = config.image_large_key ? getImageUrl(config.image_large_key) : null
        setImageLargePreview(largeUrl)
        if (largeUrl) measureLargeImage(largeUrl)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load banner config.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onPickImage(file: File | null) {
    setImageFile(file)
    setImagePreview(
      file ? URL.createObjectURL(file) : existingImageKey ? getImageUrl(existingImageKey) : null,
    )
  }

  function removeImage() {
    setImageFile(null)
    setExistingImageKey(null)
    setImagePreview(null)
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  function measureLargeImage(url: string) {
    const token = ++largeSizeTokenRef.current
    loadImageSize(url).then((size) => {
      if (token === largeSizeTokenRef.current) setLargeImageSize(size)
    })
  }

  function onPickLargeImage(file: File | null) {
    setImageLargeFile(file)
    const url = file
      ? URL.createObjectURL(file)
      : existingImageLargeKey
        ? getImageUrl(existingImageLargeKey)
        : null
    setImageLargePreview(url)
    if (url) {
      measureLargeImage(url)
    } else {
      largeSizeTokenRef.current++
      setLargeImageSize(null)
    }
  }

  function removeLargeImage() {
    setImageLargeFile(null)
    setExistingImageLargeKey(null)
    setImageLargePreview(null)
    largeSizeTokenRef.current++
    setLargeImageSize(null)
    if (imageLargeInputRef.current) imageLargeInputRef.current.value = ''
  }

  const startValid = HEX_RE.test(gradientStart.trim())
  const endValid = HEX_RE.test(gradientEnd.trim())
  const startColor = startValid ? gradientStart.trim() : APP_DEFAULT_GRADIENT_START
  const endColor = endValid ? gradientEnd.trim() : APP_DEFAULT_GRADIENT_END
  const gradient = `linear-gradient(to bottom right, ${startColor}, ${endColor})`
  const bgValid = HEX_RE.test(backgroundColor.trim())
  const textValid = HEX_RE.test(textColor.trim())
  const solidActive = bgMode === 'solid' && bgValid
  const cardBackground = solidActive ? backgroundColor.trim() : gradient
  const shadowColor = solidActive ? backgroundColor.trim() : endColor
  const previewTextColor = textValid ? textColor.trim() : '#FFFFFF'
  const contrastBackgrounds = solidActive ? [backgroundColor.trim()] : [startColor, endColor]
  const worstContrast = Math.min(
    ...contrastBackgrounds.map((bg) => contrastRatio(previewTextColor, bg)),
  )
  const lowContrast = worstContrast < 3
  const previewTitle = title.trim()
  const previewSubtitle = subtitle.trim().replace(/\{price\}/g, SAMPLE_PRICE)
  const hasContent = !!(
    previewTitle ||
    previewSubtitle ||
    imagePreview ||
    imageLargePreview
  )
  const titleTooLong = title.trim().length > 60
  const subtitleTooLong = subtitle.trim().length > 80
  const subtitleHasPrice = subtitle.includes('{price}')
  const largeFrameAspect = largeImageSize
    ? Math.max(largeImageSize.width / largeImageSize.height, 1.5)
    : 1.5
  const largeImageNarrowerThanThreeTwo =
    largeImageSize && largeImageSize.width / largeImageSize.height < 1.48 ? largeImageSize : null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!allowedActions.includes(action)) {
      setError('Invalid action for this banner.')
      return
    }
    if (gradientStart.trim() && !startValid) {
      setError('Gradient start must be a #RRGGBB hex color (e.g. #E8A33D) or empty.')
      return
    }
    if (gradientEnd.trim() && !endValid) {
      setError('Gradient end must be a #RRGGBB hex color (e.g. #D98A24) or empty.')
      return
    }
    if (backgroundColor.trim() && !bgValid) {
      setError('Background color must be a #RRGGBB hex color or empty.')
      return
    }
    if (textColor.trim() && !textValid) {
      setError('Text color must be a #RRGGBB hex color or empty.')
      return
    }
    const link = action === 'link' ? normalizeActionLink(actionLink) : null
    if (action === 'link' && !link) {
      setError('Action link is required when the action is Link.')
      return
    }
    if (link && !link.startsWith('/')) {
      setError('Action link must be an internal route starting with "/" (e.g. /library).')
      return
    }
    if (link) setActionLink(link)

    setSubmitting(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      let imageKey = existingImageKey
      if (imageFile) {
        setUpload({ label: 'Uploading image', percent: 0 })
        imageKey = await presignAndUpload(
          'images',
          imageFile,
          (p) => setUpload({ label: 'Uploading image', percent: p }),
          controller.signal,
        )
      }
      let imageLargeKey = existingImageLargeKey
      if (imageLargeFile) {
        setUpload({ label: 'Uploading large image', percent: 0 })
        imageLargeKey = await presignAndUpload(
          'images',
          imageLargeFile,
          (p) => setUpload({ label: 'Uploading large image', percent: p }),
          controller.signal,
        )
      }
      const input: BannerConfigInput = {
        enabled,
        title: title.trim() || null,
        subtitle: subtitle.trim() || null,
        gradient_start: gradientStart.trim() || null,
        gradient_end: gradientEnd.trim() || null,
        background_color: bgMode === 'solid' ? backgroundColor.trim() || null : null,
        text_color: textColor.trim() || null,
        image_key: imageKey,
        image_large_key: imageLargeKey,
        action,
        action_link: link,
      }
      await saveBannerConfig(bannerId, input)
      setExistingImageKey(imageKey)
      setImageFile(null)
      if (imageInputRef.current) imageInputRef.current.value = ''
      setImagePreview(imageKey ? getImageUrl(imageKey) : null)
      setExistingImageLargeKey(imageLargeKey)
      setImageLargeFile(null)
      if (imageLargeInputRef.current) imageLargeInputRef.current.value = ''
      setImageLargePreview(imageLargeKey ? getImageUrl(imageLargeKey) : null)
      if (!imageLargeKey) setLargeImageSize(null)
      setSaved(true)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Upload cancelled.')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save banner.')
      }
    } finally {
      setUpload(null)
      abortRef.current = null
      setSubmitting(false)
    }
  }

  return (
    <section className="admin-banner-section">
      <h3>{heading}</h3>
      <p className="admin-muted admin-banner-section-desc">{description}</p>

      {loading ? (
        <p className="admin-muted">Loading…</p>
      ) : (
        <>
          {error && <p className="admin-error">{error}</p>}

          <div className="admin-banner-preview-block">
            <span className="admin-muted admin-field-hint">Preview</span>
            {hasContent ? (
              <>
                <div
                  className={`admin-banner-card${enabled ? '' : ' is-disabled'}${
                    imageLargePreview ? ' has-large-image' : ''
                  }`}
                  style={{
                    background: cardBackground,
                    color: previewTextColor,
                    boxShadow: `0 10px 24px -6px ${shadowColor}66`,
                  }}
                >
                  <div className={`admin-banner-row${imagePreview ? '' : ' is-text-only'}`}>
                    {imagePreview && (
                      <img className="admin-banner-image" src={imagePreview} alt="" />
                    )}
                    {(previewTitle || previewSubtitle) && (
                      <div className="admin-banner-text">
                        {previewTitle && (
                          <span className="admin-banner-title">{previewTitle}</span>
                        )}
                        {previewSubtitle && (
                          <span className="admin-banner-subtitle">{previewSubtitle}</span>
                        )}
                      </div>
                    )}
                    {action !== 'none' && <span className="admin-banner-chevron">›</span>}
                  </div>
                  {imageLargePreview && (
                    <img
                      className="admin-banner-large-image"
                      src={imageLargePreview}
                      alt=""
                      style={{ aspectRatio: String(largeFrameAspect) }}
                    />
                  )}
                </div>
                {!enabled && (
                  <span className="admin-muted admin-field-hint">
                    Hidden in the app — the banner is turned off.
                  </span>
                )}
              </>
            ) : (
              <span className="admin-muted admin-field-hint">
                No banner content set — nothing shows in the app.
              </span>
            )}
          </div>

          <form className="admin-form" onSubmit={handleSubmit}>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>
                Enabled{' '}
                <span className="admin-muted">(turn off to hide the banner completely)</span>
              </span>
            </label>

            <label className="admin-field">
              <span>Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              {titleTooLong && (
                <span className="admin-field-hint admin-hint-warning">
                  Recommended max 60 characters — longer titles wrap on the card.
                </span>
              )}
            </label>

            <label className="admin-field">
              <span>Subtitle</span>
              <input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
              />
              <span className="admin-muted admin-field-hint">
                Use {'{price}'} to insert the monthly price.
              </span>
              {subtitleTooLong && (
                <span className="admin-field-hint admin-hint-warning">
                  Recommended max 80 characters.
                </span>
              )}
              {subtitleHasPrice && action !== 'paywall' && (
                <span className="admin-field-hint admin-hint-warning">
                  With the {action === 'link' ? 'Link' : 'None'} action the app hides the banner
                  whenever the price is not loaded
                  {paywallAllowed ? ` — use {price} with the Paywall action.` : '.'}
                </span>
              )}
            </label>

            <div className="admin-field">
              <span>Background</span>
              <div className="admin-media-toggle" role="group" aria-label="Background mode">
                <button
                  type="button"
                  className={bgMode === 'gradient' ? 'is-active' : ''}
                  onClick={() => setBgMode('gradient')}
                >
                  Gradient
                </button>
                <button
                  type="button"
                  className={bgMode === 'solid' ? 'is-active' : ''}
                  onClick={() => setBgMode('solid')}
                >
                  Solid
                </button>
              </div>
              <span className="admin-muted admin-field-hint">
                {bgMode === 'gradient'
                  ? 'Two-stop gradient, top-left → bottom-right. Empty colors fall back to the app defaults.'
                  : 'Flat background color. Empty falls back to the gradient.'}
              </span>
            </div>

            {bgMode === 'gradient' ? (
              <>
                <div className="admin-color-grid">
                  <label className="admin-field">
                    <span>Gradient start</span>
                    <div className="admin-color-row">
                      <input
                        value={gradientStart}
                        onChange={(e) => setGradientStart(e.target.value)}
                      />
                      <input
                        type="color"
                        aria-label="Gradient start color"
                        value={
                          startValid
                            ? gradientStart.trim().toLowerCase()
                            : APP_DEFAULT_GRADIENT_START.toLowerCase()
                        }
                        onChange={(e) => setGradientStart(e.target.value)}
                      />
                    </div>
                    {gradientStart.trim() && !startValid && (
                      <span className="admin-error">Must be #RRGGBB hex or empty.</span>
                    )}
                  </label>
                  <label className="admin-field">
                    <span>Gradient end</span>
                    <div className="admin-color-row">
                      <input
                        value={gradientEnd}
                        onChange={(e) => setGradientEnd(e.target.value)}
                      />
                      <input
                        type="color"
                        aria-label="Gradient end color"
                        value={
                          endValid
                            ? gradientEnd.trim().toLowerCase()
                            : APP_DEFAULT_GRADIENT_END.toLowerCase()
                        }
                        onChange={(e) => setGradientEnd(e.target.value)}
                      />
                    </div>
                    {gradientEnd.trim() && !endValid && (
                      <span className="admin-error">Must be #RRGGBB hex or empty.</span>
                    )}
                  </label>
                </div>
                <div className="admin-field">
                  <div className="admin-banner-gradient-strip" style={{ background: gradient }} />
                  <span className="admin-muted admin-field-hint">
                    Live gradient — empty or invalid colors fall back to the app defaults (
                    {APP_DEFAULT_GRADIENT_START} → {APP_DEFAULT_GRADIENT_END}).
                  </span>
                </div>
              </>
            ) : (
              <label className="admin-field">
                <span>Background color</span>
                <div className="admin-color-row">
                  <input
                    value={backgroundColor}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                  />
                  <input
                    type="color"
                    aria-label="Background color"
                    value={bgValid ? backgroundColor.trim().toLowerCase() : '#ffffff'}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                  />
                </div>
                {backgroundColor.trim() && !bgValid && (
                  <span className="admin-error">Must be #RRGGBB hex or empty.</span>
                )}
              </label>
            )}

            <label className="admin-field">
              <span>Text color</span>
              <div className="admin-color-row">
                <input
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                />
                <input
                  type="color"
                  aria-label="Text color"
                  value={textValid ? textColor.trim().toLowerCase() : '#ffffff'}
                  onChange={(e) => setTextColor(e.target.value)}
                />
              </div>
              {textColor.trim() && !textValid && (
                <span className="admin-error">Must be #RRGGBB hex or empty.</span>
              )}
              <span className="admin-muted admin-field-hint">
                Empty = white. Title at full strength, subtitle 85%, chevron 70%.
              </span>
              {lowContrast && (previewTitle || previewSubtitle) && (
                <span className="admin-field-hint admin-hint-warning">
                  Low contrast ({worstContrast.toFixed(1)}:1) between the text and the background —
                  the text may be hard to read.
                </span>
              )}
            </label>

            <div className="admin-field">
              <span>Image</span>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
              />
              <span className="admin-muted admin-field-hint">
                Optional — shown 44×44 to the left of the text. Without it the app centers the
                text.
              </span>
              {imagePreview && (
                <div className="admin-banner-image-row">
                  <img className="admin-preview" src={imagePreview} alt="Banner image preview" />
                  <button
                    type="button"
                    className="admin-button admin-button-sm admin-button-ghost"
                    onClick={removeImage}
                    disabled={submitting}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            <div className="admin-field">
              <span>Large image</span>
              <input
                ref={imageLargeInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => onPickLargeImage(e.target.files?.[0] ?? null)}
              />
              <span className="admin-muted admin-field-hint">
                Optional — shown below the text, fitted and never cropped. Wider than 3:2 makes
                the banner shorter; narrower than 3:2 is letterboxed inside the 3:2 frame.
              </span>
              {imageLargePreview && (
                <div className="admin-banner-image-row">
                  <img
                    className="admin-preview"
                    src={imageLargePreview}
                    alt="Large banner image preview"
                  />
                  <button
                    type="button"
                    className="admin-button admin-button-sm admin-button-ghost"
                    onClick={removeLargeImage}
                    disabled={submitting}
                  >
                    Remove
                  </button>
                </div>
              )}
              {largeImageNarrowerThanThreeTwo && (
                <span className="admin-field-hint admin-hint-warning">
                  This image is {largeImageNarrowerThanThreeTwo.width}×
                  {largeImageNarrowerThanThreeTwo.height} — narrower than 3:2. It is letterboxed
                  inside the 3:2 frame; upload 3:2 or wider to avoid empty space.
                </span>
              )}
            </div>

            <div className="admin-field">
              <span>Action</span>
              <div className="admin-media-toggle" role="group" aria-label="Banner action">
                {allowedActions.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={action === a ? 'is-active' : ''}
                    onClick={() => setAction(a)}
                  >
                    {ACTION_LABELS[a]}
                  </button>
                ))}
              </div>
              <span className="admin-muted admin-field-hint">
                {paywallAllowed
                  ? 'Paywall opens the subscription screen (shown only to non-subscribers). Link navigates in-app. None shows the banner without a tap action.'
                  : 'Link navigates in-app. None shows the banner without a tap action.'}
              </span>
            </div>

            {action === 'link' && (
              <>
                <label className="admin-field">
                  <span>Category</span>
                  <select
                    value={selectedCategoryId}
                    onChange={(e) => onPickCategory(e.target.value)}
                    disabled={categories.length === 0}
                  >
                    <option value="">Custom / none</option>
                    {categories.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className="admin-muted admin-field-hint">
                    Pick a category to fill the link automatically, or leave on Custom and enter
                    any route below.
                  </span>
                </label>
                <label className="admin-field">
                  <span>Action link *</span>
                  <input
                    value={actionLink}
                    onChange={(e) => setActionLink(e.target.value)}
                    onBlur={() => setActionLink((v) => normalizeActionLink(v))}
                    placeholder="/library or https://ahimsaapp.com/player?id=15"
                  />
                  <span className="admin-muted admin-field-hint">
                    Internal app route, e.g. /library, /player?id=12, /breathing. Links from
                    ahimsaapp.com are converted to routes automatically.
                  </span>
                </label>
              </>
            )}

            {upload && (
              <div className="admin-upload-progress">
                <div className="admin-upload-progress-head">
                  <span>
                    {upload.label} {Math.round(upload.percent * 100)}%
                  </span>
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

            <button type="submit" className="admin-button" disabled={submitting}>
              {submitting ? 'Saving…' : `Save ${heading.toLowerCase()}`}
            </button>
          </form>
        </>
      )}

      {saved && (
        <div className="admin-modal-overlay" onClick={() => setSaved(false)}>
          <div className="admin-modal admin-modal-success" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-success-title">{heading} saved</h3>
            <p>Changes appear in the app within ~5 minutes (or on next app launch).</p>
            <div className="admin-modal-actions">
              <button className="admin-button" onClick={() => setSaved(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export function BannerPage() {
  const [categories, setCategories] = useState<CategoryOption[]>([])

  useEffect(() => {
    let cancelled = false
    fetchCategoryOptions()
      .then((options) => {
        if (!cancelled) setCategories(options)
      })
      .catch((e) => console.error('Failed to load categories for banner links:', e))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="admin-app">
      <AdminNav />
      <main className="admin-page">
        <div className="admin-page-head">
          <h2>Banner</h2>
        </div>

        <p className="admin-muted admin-banner-intro">
          Controls the promo banners on the mobile app Home screen. Empty text fields show
          nothing; empty colors fall back to the app's default gradient.
        </p>

        <BannerSection
          bannerId={1}
          heading="General banner"
          description="Shown on the Home screen — to non-subscribers for the Paywall action, to everyone for Link or None. Subscribers see the subscriber banner below instead, when it's enabled."
          allowedActions={ALL_ACTIONS}
          fallbackAction="paywall"
          defaultEnabled
          categories={categories}
        />

        <BannerSection
          bannerId={2}
          heading="Subscriber banner"
          description="Shown only to users with an active subscription — it replaces the general banner for them. While it's disabled, subscribers fall back to the general banner (which shows them nothing while it uses the Paywall action). Non-subscribers never see it."
          allowedActions={SUBSCRIBER_ACTIONS}
          fallbackAction="none"
          defaultEnabled={false}
          categories={categories}
        />
      </main>
    </div>
  )
}

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createClient } from '@sanity/client'
import { toHTML } from '@portabletext/to-html'
import { createImageUrlBuilder } from '@sanity/image-url'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'dist')
const distBlog = join(dist, 'blog')

// --- Config -----------------------------------------------------------------

function loadDotEnv(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    let value = match[2]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value
  }
}
loadDotEnv(join(root, '.env'))

const SITE_URL = (process.env.SITE_URL || 'https://ahimsaapp.com').replace(/\/+$/, '')
const DATASET = process.env.SANITY_DATASET || 'production'
const PROJECT_ID = process.env.SANITY_PROJECT_ID || process.env.SANITY_STUDIO_PROJECT_ID
const FIXTURE = process.env.BLOG_FIXTURE
const API_VERSION = '2024-10-01'
const RSS_LIMIT = 20

// Published posts, newest first. Unauthenticated Content Lake queries can only
// see published documents (drafts require auth), and the filters keep out
// anything without a slug or with a future publishedAt.
const POSTS_QUERY = `*[
  _type == "post"
  && defined(slug.current)
  && defined(publishedAt)
  && dateTime(publishedAt) <= dateTime(now())
] | order(publishedAt desc) {
  "id": _id,
  title,
  "slug": slug.current,
  excerpt,
  coverImage,
  "coverAsset": coverImage.asset->,
  body,
  publishedAt,
  _updatedAt,
  "author": author->{name},
  "categories": categories[]->{title},
  seoTitle,
  seoDescription,
  canonicalUrl
}`

// --- Helpers ------------------------------------------------------------------

function fail(message) {
  console.error(`\n[blog] FAILED: ${message}`)
  process.exit(1)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

const BG_MONTHS = [
  'януари', 'февруари', 'март', 'април', 'май', 'юни',
  'юли', 'август', 'септември', 'октомври', 'ноември', 'декември',
]

function formatBgDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso ?? '')
  return `${d.getUTCDate()} ${BG_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} г.`
}

function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '',
  )
}

function jsonLdScript(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`
}

const imageUrlFor = createImageUrlBuilder({
  projectId: PROJECT_ID || 'fixture-project',
  dataset: DATASET,
})
const imageUrl = (source, width) => imageUrlFor.image(source).width(width).url()

const portableTextComponents = {
  types: {
    image: ({value}) => {
      const src = value.asset ? imageUrl(value, 1200) : ''
      const caption = value.caption ? `<figcaption>${escapeHtml(value.caption)}</figcaption>` : ''
      return `<figure><img src="${src}" alt="${escapeHtml(value.alt || '')}" loading="lazy" />${caption}</figure>`
    },
    codeBlock: ({value}) => {
      const lang = value.language && value.language !== 'plaintext'
        ? ` class="language-${escapeHtml(value.language)}"`
        : ''
      return `<pre${lang}><code>${escapeHtml(value.code || '')}</code></pre>`
    },
  },
  marks: {
    link: ({value, children}) => {
      const href = value?.href || ''
      const external = /^https?:\/\//i.test(href)
      return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${children}</a>`
    },
  },
}

// --- Data ---------------------------------------------------------------------

async function fetchPosts() {
  if (FIXTURE) {
    const raw = await readFile(resolve(root, FIXTURE), 'utf8')
    try {
      return JSON.parse(raw)
    } catch (e) {
      fail(`could not parse fixture ${FIXTURE}: ${e.message}`)
    }
  }
  if (!PROJECT_ID) {
    fail(
      'SANITY_PROJECT_ID is not set. Copy .env.example to .env and fill in your ' +
      'Sanity project ID (see BLOG.md), or use BLOG_FIXTURE for offline generation.',
    )
  }
  const client = createClient({
    projectId: PROJECT_ID,
    dataset: DATASET,
    apiVersion: API_VERSION,
    useCdn: false,
  })
  try {
    const posts = await client.fetch(POSTS_QUERY)
    if (!Array.isArray(posts)) fail('Sanity returned an unexpected response (not an array).')
    return posts
  } catch (e) {
    fail(`Sanity query failed (project ${PROJECT_ID}, dataset ${DATASET}): ${e.message}`)
  }
}

// --- Validation ------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const problems = []
const seenSlugs = new Map()

function problem(post, message) {
  const label = post.title || post.slug || post.id || 'untitled document'
  problems.push(`«${label}»: ${message}`)
}

function validatePosts(posts) {
  for (const post of posts) {
    const slug = String(post.slug ?? '').trim()
    if (!slug) {
      problem(post, 'missing slug')
    } else {
      if (slug.length > 96) problem(post, `slug is longer than 96 characters ("${slug}")`)
      if (!SLUG_RE.test(slug)) {
        problem(post, `invalid slug "${slug}" — allowed: lowercase latin letters, digits and hyphens`)
      }
      const key = slug.toLowerCase()
      if (seenSlugs.has(key)) {
        problem(post, `duplicate slug "${slug}" — already used by «${seenSlugs.get(key)}»`)
      } else {
        seenSlugs.set(key, post.title || post.id || slug)
      }
    }
    if (!post.title) problem(post, 'missing title')
    if (!post.excerpt) problem(post, 'missing excerpt')
    if (!post.coverImage?.asset) problem(post, 'missing cover image')
    if (!post.coverAsset) problem(post, 'cover image asset is broken or deleted')
    if (!Array.isArray(post.body) || post.body.length === 0) problem(post, 'missing body content')
    if (!post.author?.name) problem(post, 'missing author')
    if (!post.publishedAt) problem(post, 'missing publishedAt')
    for (const block of post.body ?? []) {
      if (block?._type === 'image' && !block.asset) problem(post, 'inline image without asset')
    }
  }
  if (problems.length > 0) {
    fail(`invalid posts, no output generated:\n  ${problems.join('\n  ')}`)
  }
}

// --- Page rendering ------------------------------------------------------------------

async function loadTemplates() {
  const dir = join(root, 'blog', 'templates')
  const [layout, index, article] = await Promise.all([
    readFile(join(dir, 'layout.html'), 'utf8'),
    readFile(join(dir, 'index.html'), 'utf8'),
    readFile(join(dir, 'article.html'), 'utf8'),
  ])
  return {layout, index, article}
}

function renderLayout(templates, vars) {
  return renderTemplate(templates.layout, vars)
}

function categoryChips(categories) {
  if (!categories?.length) return ''
  const chips = categories
    .map((c) => `<span class="blog-chip">${escapeHtml(c.title)}</span>`)
    .join('')
  return `<div class="blog-chips">${chips}</div>`
}

function postCard(post) {
  const href = `/blog/${post.slug}/`
  const meta = [
    `<time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(formatBgDate(post.publishedAt))}</time>`,
    `<span>${escapeHtml(post.author.name)}</span>`,
  ].join('<span class="blog-meta-sep">·</span>')
  return `<article class="blog-card">
  <a class="blog-card-link" href="${href}">
    <div class="blog-card-media"><img src="${imageUrl(post.coverImage, 800)}" alt="${escapeHtml(post.coverImage.alt || '')}" loading="lazy" /></div>
    <div class="blog-card-body">
      <div class="blog-card-meta">${meta}</div>
      <h2>${escapeHtml(post.title)}</h2>
      <p>${escapeHtml(post.excerpt)}</p>
      ${categoryChips(post.categories)}
    </div>
  </a>
</article>`
}

function buildIndexPage(templates, posts) {
  const mainContent = renderTemplate(templates.index, {
    postCards: posts.length
      ? `<div class="blog-grid">${posts.map(postCard).join('\n')}</div>`
      : `<p class="blog-empty">Още няма публикувани статии.</p>`,
  })
  const description =
    'Статии за медитация, дишане и осъзнат живот от екипа на Ahimsa — първото българско приложение за водени медитации.'
  return renderLayout(templates, {
    title: 'Блог | Ahimsa',
    metaDescription: description,
    canonicalUrl: `${SITE_URL}/blog/`,
    ogTitle: 'Ahimsa Блог',
    ogDescription: description,
    ogImage: `${SITE_URL}/assets/hero.png`,
    ogUrl: `${SITE_URL}/blog/`,
    ogType: 'website',
    publishedTimeMeta: '',
    extraHead: `<link rel="alternate" type="application/rss+xml" title="Ahimsa Блог" href="/blog/rss.xml">`,
    jsonLd: jsonLdScript({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: 'Ahimsa Блог',
      url: `${SITE_URL}/blog/`,
      description,
      publisher: {'@type': 'Organization', name: 'Ahimsa', url: SITE_URL},
    }),
    mainContent,
  })
}

function buildArticlePage(templates, post, newer, older) {
  const canonical = post.canonicalUrl || `${SITE_URL}/blog/${post.slug}/`
  const title = post.seoTitle || `${post.title} | Ahimsa`
  const description = post.seoDescription || post.excerpt
  const coverUrl = imageUrl(post.coverImage, 1200)

  let bodyHtml
  try {
    bodyHtml = toHTML(post.body, {components: portableTextComponents})
  } catch (e) {
    problem(post, `could not render body content (${e.message})`)
    return null
  }

  const metaHtml = `<div class="blog-post-meta">
  <time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(formatBgDate(post.publishedAt))}</time>
  <span class="blog-meta-sep">·</span>
  <span>${escapeHtml(post.author.name)}</span>
  ${categoryChips(post.categories)}
</div>`

  const coverHtml = `<img class="blog-cover" src="${imageUrl(post.coverImage, 1600)}" alt="${escapeHtml(post.coverImage.alt || '')}" fetchpriority="high">`

  const pagerParts = []
  if (older) {
    pagerParts.push(`<a class="blog-pager-item" href="/blog/${older.slug}/">
  <span class="blog-pager-label">&larr; По-стара статия</span>
  <span class="blog-pager-title">${escapeHtml(older.title)}</span>
</a>`)
  }
  if (newer) {
    pagerParts.push(`<a class="blog-pager-item blog-pager-next" href="/blog/${newer.slug}/">
  <span class="blog-pager-label">По-нова статия &rarr;</span>
  <span class="blog-pager-title">${escapeHtml(newer.title)}</span>
</a>`)
  }

  const mainContent = renderTemplate(templates.article, {
    title: escapeHtml(post.title),
    metaHtml,
    coverHtml,
    bodyHtml,
    pagerHtml: pagerParts.length ? `<nav class="blog-pager">${pagerParts.join('\n')}</nav>` : '',
  })

  const html = renderLayout(templates, {
    title: escapeHtml(title),
    metaDescription: escapeHtml(description),
    canonicalUrl: escapeHtml(canonical),
    ogTitle: escapeHtml(title),
    ogDescription: escapeHtml(description),
    ogImage: coverUrl,
    ogUrl: canonical,
    ogType: 'article',
    publishedTimeMeta: `<meta property="article:published_time" content="${escapeHtml(post.publishedAt)}">`,
    extraHead: '',
    jsonLd:
      jsonLdScript({
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description,
        image: [coverUrl],
        datePublished: post.publishedAt,
        dateModified: post._updatedAt || post.publishedAt,
        author: {'@type': 'Person', name: post.author.name},
        publisher: {'@type': 'Organization', name: 'Ahimsa', url: SITE_URL},
        mainEntityOfPage: {'@type': 'WebPage', '@id': canonical},
      }) +
      jsonLdScript({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          {'@type': 'ListItem', position: 1, name: 'Начало', item: `${SITE_URL}/`},
          {'@type': 'ListItem', position: 2, name: 'Блог', item: `${SITE_URL}/blog/`},
          {'@type': 'ListItem', position: 3, name: post.title, item: canonical},
        ],
      }),
    mainContent,
  })

  return {slug: post.slug, html}
}

function buildRss(posts) {
  const items = posts.slice(0, RSS_LIMIT).map((post) => {
    const url = `${SITE_URL}/blog/${post.slug}/`
    return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>
      <description>${escapeXml(post.excerpt)}</description>
    </item>`
  })
  const lastBuild = posts.length
    ? new Date(posts[0].publishedAt).toUTCString()
    : new Date().toUTCString()
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Ahimsa Блог</title>
    <link>${SITE_URL}/blog/</link>
    <description>Статии за медитация, дишане и осъзнат живот от екипа на Ahimsa.</description>
    <language>bg-BG</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items.join('\n')}
  </channel>
</rss>
`
}

function buildSitemap(posts) {
  const staticPages = ['/', '/support.html', '/policy.html', '/policy-chap.html', '/blog/']
  const urls = staticPages.map(
    (path) => `  <url><loc>${SITE_URL}${path === '/' ? '/' : path}</loc></url>`,
  )
  for (const post of posts) {
    const lastmod = String(post._updatedAt || post.publishedAt).slice(0, 10)
    urls.push(`  <url><loc>${SITE_URL}/blog/${post.slug}/</loc><lastmod>${lastmod}</lastmod></url>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`
}

// --- Main ------------------------------------------------------------------

async function main() {
  const templates = await loadTemplates()

  const posts = await fetchPosts()
  validatePosts(posts)
  console.log(`[blog] fetched ${posts.length} published post(s)`)

  const pages = [{path: join(distBlog, 'index.html'), html: buildIndexPage(templates, posts)}]
  for (let i = 0; i < posts.length; i++) {
    const page = buildArticlePage(templates, posts[i], posts[i - 1], posts[i + 1])
    if (page) pages.push({path: join(distBlog, posts[i].slug, 'index.html'), html: page.html})
  }

  // Body rendering may have added problems (malformed portable text).
  if (problems.length > 0) {
    fail(`invalid posts, no output generated:\n  ${problems.join('\n  ')}`)
  }

  await mkdir(distBlog, {recursive: true})
  await cp(join(root, 'blog', 'blog.css'), join(distBlog, 'blog.css'), {force: true})
  for (const page of pages) {
    await mkdir(join(page.path, '..'), {recursive: true})
    await writeFile(page.path, page.html)
  }
  await writeFile(join(distBlog, 'rss.xml'), buildRss(posts))
  await writeFile(join(dist, 'sitemap.xml'), buildSitemap(posts))

  console.log(`✓ Blog generated: ${posts.length} article page(s), index, rss.xml, sitemap.xml`)
}

main().catch((e) => fail(e.stack || String(e)))

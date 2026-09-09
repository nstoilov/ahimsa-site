# Sanity Studio — engineering notes

Reference for how the Sanity integration works, why it's built this way, and
the exact problems hit during setup (with symptoms → causes → fixes).
Workflow documentation (writing/publishing posts, deploying the site) lives
in [`../BLOG.md`](../BLOG.md).

## Quick facts

| Item | Value |
| --- | --- |
| Sanity project ID | `cqeu4nnj` (public identifier — safe to commit) |
| Dataset | `production` |
| Hosted studio | https://ahimsa-blog.sanity.studio (login: Sanity account, member of the project) |
| Studio hostname | configured via `studioHost` in `sanity.cli.js` |
| Sanity account/project admin | https://www.sanity.io/manage (invite writers there, role **Editor**) |
| Sanity CLI login token | `~/.config/sanity` (per machine, never commit) |

## Architecture

```
Sanity project cqeu4nnj (source of truth for blog content)
        │
        ├── cms/                    this studio (dev tool, NOT deployed with the site)
        │     npm run cms:dev       local editing at localhost:3333
        │     npm run cms:deploy    publishes studio to ahimsa-blog.sanity.studio
        │
        └── scripts/build-blog.mjs  static generator (repo root)
              queries published posts → validates → renders
              dist/blog/index.html, dist/blog/<slug>/index.html,
              dist/blog/rss.xml, dist/sitemap.xml
              (templates: blog/templates/*.html, styles: blog/blog.css)
                      │
                      └── npm run build → npm run deploy (Cloudflare Workers, ./dist)
```

Public pages never contact Sanity at runtime — only image URLs point at
`cdn.sanity.io`. Unauthenticated Content Lake queries return **published
documents only** (drafts are invisible without auth); the generator also
requires `publishedAt <= now()`, so a future date schedules a post.

## File map

| Path | Role |
| --- | --- |
| `cms/sanity.config.js` | Studio config (project/dataset baked in, env-overridable), plugins, schema |
| `cms/sanity.cli.js` | CLI config (`api.projectId`, `studioHost`, `autoUpdates`) |
| `cms/structure.js` | Desk structure — root list: Статии / Автори / Категории |
| `cms/schemas/post.js` | Post type: title, slug, excerpt, coverImage (alt/caption), body, publishedAt, author, categories, seoTitle, seoDescription, canonicalUrl |
| `cms/schemas/author.js` | Author: name, optional picture |
| `cms/schemas/category.js` | Category: title, optional description |
| `cms/schemas/blockContent.js` | Portable Text: normal/h2/h3/h4/blockquote, bullet+number lists, default marks (bold/italic/link), inline image (alt/caption), custom `codeBlock` object |
| `blog/templates/` | `layout.html` (shared shell = site header/footer + meta), `index.html`, `article.html` — `{{placeholder}}` substitution |
| `blog/blog.css` | Blog-only styles, scoped, built on the root `style.css` tokens |
| `blog/fixtures/sample-posts.json` | Offline generator input shaped exactly like the GROQ projection |
| `scripts/build-blog.mjs` | The generator: env → query → validate → render → write |
| `.env` (repo root) | Generator config: `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SITE_URL` |

## Decisions and rationale

- **Studio separate from `/admin`**: the admin app uses HashRouter (Studio
  URLs would be `/admin/#/cms`, not clean paths), Sanity's dependency tree
  would land in the production admin bundle, and the Studio always requires
  its own Sanity login anyway — embedding buys nothing. Zero admin changes.
- **Sanity-hosted studio (`sanity deploy`)**: free hosting, multiple writers
  invited as project members, no infra of ours. Re-deploy only when
  schemas/config change — content edits never need a re-deploy.
- **Project ID baked into configs with env override**
  (`process.env.SANITY_STUDIO_PROJECT_ID || 'cqeu4nnj'`): it's a public
  identifier (present in every image URL and the studio URL), and the CLI
  does **not** apply `cms/.env` when reading `sanity.cli.js` — env-only
  config broke `sanity deploy`.
- **No `"type": "module"` in `cms/package.json`**: the Sanity CLI loads
  `sanity.cli.js` through an esbuild-register CJS require hook; ESM package
  scope breaks it (see gotchas). Official Sanity scaffolds omit the field.
- **Body styles limited to h2–h4**: the article title is the single `h1`;
  content headings start at h2 for a correct heading hierarchy.
- **`codeBlock` as a plain custom object** (language dropdown + text field):
  dependency-free; enough for a meditation blog.
- **Images via Sanity's asset pipeline/CDN** (`@sanity/image-url`, on-the-fly
  widths: 800 cards, 1200 og/inline, 1600 cover) — never copied into the repo.
- **`@portabletext/to-html` with the `components` API** (not the legacy
  `serializers` API) and `@sanity/client` v8 / `@sanity/image-url` v2
  (`createImageUrlBuilder` named export — the default export is deprecated).

## Gotchas hit during setup (symptom → cause → fix)

1. `Error reading "…/sanity.cli.js": require is not defined in ES module
   scope … package.json contains "type": "module"`
   → the CLI's esbuild-register require hook can't load ESM-scoped `.js`
   → **removed `"type": "module"` from `cms/package.json`** (studio files are
   Vite-bundled and don't need it)
2. `sanity.cli.js does not contain a project identifier ("api.projectId")`
   → the CLI doesn't load `cms/.env` when reading the CLI config (dotenv only
   applies to the studio runtime)
   → **projectId baked into `sanity.cli.js` + `sanity.config.js` as a
   default**; env vars remain optional overrides
3. `The requested module 'sanity/cli' does not provide an export named
   'defineCliConfig'`
   → `sanity/cli`'s runtime CJS export surface doesn't expose that name (the
   type declarations lie)
   → **`sanity.cli.js` is a plain `export default {…}` object**, no imports
4. Studio error: `List items must be of type "listItem", got "object"`
   → used `S.documentTypeList()` (a standalone pane) inside
   `S.list().items([...])`
   → **`S.documentTypeListItem('post')`** etc. in `cms/structure.js`.
   Note: `sanity build` cannot catch this — the structure serializes only in
   the browser.
5. `EACCES … mkdir '~/.config/sanity'` / npm cache EACCES
   → `~/.config` (and some `~/.npm` entries) were root-owned on this machine
   → `sudo chown -R $(whoami):staff ~/.config ~/.npm`
   (temporary workaround: `XDG_CONFIG_HOME=<writable dir>` per command)
6. `https://ahimsa-blog.sanity.studio` returning `302` to `www.sanity.io/…`
   → normal: the vanity URL redirects to Sanity's serving/auth shell;
   unauthenticated visitors get a login screen
7. `sanity deploy` also deploys the schema registry ("Deployed 1/1 schemas") —
   informational, not an error.

## Runbooks

**Change the post schema** (add/remove a field)
1. Edit `cms/schemas/post.js`.
2. `npm run cms:deploy` (studio + schema registry update).
3. If the field should appear on the site, extend the GROQ projection and
   rendering in `scripts/build-blog.mjs` (and `blog/templates/*.html` if
   structural), then `npm run build`.
4. Existing posts keep working — new fields are optional until filled in.

**Point the studio at a different project/dataset**
- Create `cms/.env` with `SANITY_STUDIO_PROJECT_ID` / `SANITY_STUDIO_DATASET`
  (overrides the baked defaults), and update the baked defaults in both
  config files for permanence.

**Test the generator without Sanity access**
- `BLOG_FIXTURE=blog/fixtures/sample-posts.json npm run build`
- The fixture must mirror the projection in `POSTS_QUERY` (including resolved
  `author`, `categories`, `coverAsset`).

**Writers onboarding**
- manage.sanity.io → project → Members → Invite (role **Editor**) → they open
  https://ahimsa-blog.sanity.studio and log in with their own account.

**Local preview of generated pages**
- `npm run build && npm run preview` (wrangler dev serves `dist/` exactly as
  production, including `/blog/<slug>/` directory URLs and the 404 fallback).

## What was tested

- Generator: error paths (missing env, bogus project ID, duplicate slugs,
  missing/invalid fields) all fail loudly with `exit 1` and write nothing;
  fixture + empty-state generation; full `npm run build`.
- Serving: `wrangler dev` + curl — `/blog/`, `/blog/<slug>/`, `/blog`,
  `/blog/rss.xml`, `/sitemap.xml`, `/robots.txt`, `/admin/` all correct
  (`/blog` → 307 trailing-slash redirect is Cloudflare's canonical behavior).
- Studio: `sanity build` (config/schema compile), `sanity deploy` to
  https://ahimsa-blog.sanity.studio, structure verified after the
  `documentTypeListItem` fix.

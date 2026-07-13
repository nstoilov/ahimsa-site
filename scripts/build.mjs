import { rm, mkdir, cp, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'dist')

// Top-level entries excluded from the copy into dist/.
// Everything else at the repo root (including .well-known/) is copied.
const exclude = new Set([
  'node_modules',
  'dist',
  'admin',
  'scripts',
  '.git',
  '.wrangler',
  '.gitignore',
  '.DS_Store',
  'wrangler.jsonc',
  'package.json',
  'package-lock.json',
  'CNAME',
  '_config.yml',
])

// 1. Wipe dist/ so output reflects the current source tree exactly.
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

// 2. Copy the marketing site into dist/, preserving dotfiles (.well-known/).
const entries = await readdir(root, { withFileTypes: true })
for (const entry of entries) {
  if (exclude.has(entry.name)) continue
  if (entry.name.startsWith('.dev.vars') || entry.name.startsWith('.env')) continue
  const src = join(root, entry.name)
  const dest = join(dist, entry.name)
  await cp(src, dest, { recursive: true, force: true })
}

console.log('✓ Marketing site copied into dist/')

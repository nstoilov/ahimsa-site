# Prompt: Granted Access support in the Ahimsa mobile app

## Context

The admin panel (this repo, `admin/`) manages a Supabase table `public.granted_access` that grants email-based subscriber access without a subscription: a logged-in user whose email is in the table gets unlocked content until an expiry date. The mobile app currently does NOT read this table — this prompt adds that.

**Supabase project:** `zskpabenylubupwvaavh` (the same one the app already uses).

### Table schema (`public.granted_access`)

| Column | Type | Notes |
| --- | --- | --- |
| `email` | `text` PK | Stored lowercase. Match against the user's auth email case-insensitively. |
| `expires_at` | `date` | Access is valid through the END of this day (inclusive): `today <= expires_at`. |
| `access_type` | `text` | `'all'` or `'categories'`. **New explicit column** — this is the source of truth for scope. |
| `categories` | `text[]` | Only used when `access_type = 'categories'`; NULL when `'all'`. |
| `granted_by` | `text` | Admin email (audit). |
| `created_at` | `timestamptz` | — |

**Meaning of `access_type`:**

- `'all'` → full subscriber access: everything unlocked (no paywall, no lock icons, breathing exercises included). Behaves exactly like an active subscription. `categories` is NULL and must be ignored.
- `'categories'` → only entries whose category is in the `categories` array are unlocked. Match against `entries.category` for audio entries and `entries.video_category` for video entries.

## Required changes in the mobile app

### 1. Fetch the user's grant

RLS lets an authenticated user read only their own row, so query without filters:

```ts
const { data } = await supabase
  .from('granted_access')
  .select('email, expires_at, access_type, categories')
  .maybeSingle()
```

Parse the result into an in-memory grant object:

```ts
type GrantedAccess = {
  expiresAt: string            // YYYY-MM-DD
  accessType: 'all' | 'categories'
  categories: string[] | null  // null when accessType === 'all'
}
```

No row / expired (`today > expires_at`, compare as calendar dates in the user's local timezone) → no grant.

### 2. Expose an `isEntryUnlocked` / entitlement check

Wherever the app currently decides "subscriber vs locked", incorporate the grant:

1. Active subscription → unlocked (unchanged).
2. Grant with `access_type === 'all'` and not expired → unlocked.
3. Grant with `access_type === 'categories'` and not expired → unlocked iff the entry's category (audio: `entry.category`; video: `entry.video_category`) is in `grant.categories`.
4. Otherwise → existing free/paid logic.

The grant never *locks* anything that is already free or subscribed — it only unlocks.

### 3. When to re-check

The admin panel says the app should re-check on launch, on login, and when returning to the foreground. Cache the parsed grant in memory (not AsyncStorage-only) so foregrounding refreshes it; a stale cache must not keep expired grants alive past their day.

### 4. UI treatment

- `'all'` grants: user should see the same UI as a subscriber (no paywall, no lock icons, no "upgrade" nudges).
- `'categories'` grants: keep lock icons on entries outside the scope. Do NOT show a paywall for locked entries if the user taps them from within an unlocked context — standard locked-entry behavior applies.

## Backward compatibility

- Rows written before this change have `categories IS NULL` and were backfilled to `access_type = 'all'` by the migration. **Treat `categories = null` as `access_type = 'all'`** defensively in case the migration hasn't run yet.
- If the app ships before reading this table, nothing breaks — the table is additive and unused.

## What NOT to change

- Do NOT write to `granted_access` from the app (RLS only allows own-row read; writes are admin-only).
- Do NOT modify subscription/RevenueCat logic — the grant is a separate, additive entitlement check that runs alongside it.
- Do NOT change how `entries` / `category_order` are read.

## Testing checklist

1. No row for the user → behavior identical to today.
2. Row with `access_type = 'all'`, future `expires_at` → everything unlocked, no paywall.
3. Row with `access_type = 'categories'` listing e.g. `["Въведение"]` → only that category's entries unlock (audio via `category`, video via `video_category`).
4. Row with `expires_at = today` → still unlocked (end of day inclusive); `yesterday` → locked.
5. Deleting the row in the admin panel → user loses access on the next re-check.

## Deliverables

Summary of where the grant fetch + entitlement check live in the app, and confirmation of the checklist above.

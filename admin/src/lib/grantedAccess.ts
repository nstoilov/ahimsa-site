import { supabase } from './supabase'

// granted_access: email -> expires_at (+ access scope). A logged-in app user
// whose email is in this table gets subscriber access while
// today <= expires_at (the check runs in the mobile app).
//
// access_type = 'all'         => full access to everything (same as a
//                                subscription; categories is NULL)
// access_type = 'categories'  => only entries whose category is listed in
//                                categories are unlocked.
// Emails are stored lowercase (normalized on write; RLS compares
// case-insensitively as a safety net).dm

export type AccessType = 'all' | 'categories'

export type GrantedAccess = {
  email: string
  expires_at: string
  access_type: AccessType
  categories: string[] | null
  granted_by: string | null
  created_at: string
}

export type AccessScope = {
  access_type: AccessType
  categories: string[] | null
}

export const FULL_ACCESS: AccessScope = { access_type: 'all', categories: null }

export async function fetchGrantedAccess(): Promise<GrantedAccess[]> {
  const { data, error } = await supabase
    .from('granted_access')
    .select('*')
    .order('expires_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as GrantedAccess[]
}

export async function saveGrantedAccess(
  email: string,
  expiresAt: string,
  scope: AccessScope,
  grantedBy: string,
): Promise<GrantedAccess> {
  const { data, error } = await supabase
    .from('granted_access')
    .upsert({
      email: email.trim().toLowerCase(),
      expires_at: expiresAt,
      access_type: scope.access_type,
      categories: scope.access_type === 'all' ? null : scope.categories,
      granted_by: grantedBy,
    })
    .select()
    .single()
  if (error) throw error
  return data as GrantedAccess
}

export async function deleteGrantedAccess(email: string): Promise<void> {
  const { error } = await supabase.from('granted_access').delete().eq('email', email)
  if (error) throw error
}

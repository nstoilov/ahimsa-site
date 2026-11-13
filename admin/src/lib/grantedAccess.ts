import { supabase } from './supabase'

// granted_access: email -> expires_at (+ optional category scope). A
// logged-in app user whose email is in this table gets subscriber access
// while today <= expires_at (the check runs in the mobile app).
// `categories` is null => ALL categories (full subscriber access, same as a
// subscription); a non-empty array => only entries in those categories are
// unlocked. Emails are stored lowercase (normalized on write; RLS compares
// case-insensitively as a safety net).

export type GrantedAccess = {
  email: string
  expires_at: string
  categories: string[] | null
  granted_by: string | null
  created_at: string
}

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
  categories: string[] | null,
  grantedBy: string,
): Promise<GrantedAccess> {
  const { data, error } = await supabase
    .from('granted_access')
    .upsert({
      email: email.trim().toLowerCase(),
      expires_at: expiresAt,
      categories,
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

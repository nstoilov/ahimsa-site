import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type AuthContextValue = {
  session: Session | null
  user: User | null
  loading: boolean
  adminChecking: boolean
  isPasswordRecovery: boolean
  isAdmin: boolean
  adminCategories: string[] | null
  isFullAdmin: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  clearPasswordRecovery: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function parseAdminCategories(raw: string | null): string[] | null {
  if (!raw) return null
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return list.length > 0 ? list : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [adminChecking, setAdminChecking] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminCategories, setAdminCategories] = useState<string[] | null>(null)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      setLoading(false)
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true)
      } else if (event === 'SIGNED_OUT') {
        setIsPasswordRecovery(false)
        setIsAdmin(false)
        setAdminCategories(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const email = session?.user?.email
    if (!email) {
      setIsAdmin(false)
      setAdminCategories(null)
      setAdminChecking(false)
      return
    }
    setAdminChecking(true)
    let cancelled = false
    supabase
      .from('admins')
      .select('email, category')
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setIsAdmin(false)
          setAdminCategories(null)
        } else {
          setIsAdmin(data !== null)
          setAdminCategories(
            data !== null ? parseAdminCategories(data.category) : null,
          )
        }
        setAdminChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    adminChecking,
    isPasswordRecovery,
    isAdmin,
    adminCategories,
    isFullAdmin: isAdmin && adminCategories === null,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
    clearPasswordRecovery: () => setIsPasswordRecovery(false),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx === undefined) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}

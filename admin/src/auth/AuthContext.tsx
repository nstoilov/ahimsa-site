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
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  clearPasswordRecovery: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [adminChecking, setAdminChecking] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
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
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const email = session?.user?.email
    if (!email) {
      setIsAdmin(false)
      setAdminChecking(false)
      return
    }
    setAdminChecking(true)
    let cancelled = false
    supabase
      .from('admins')
      .select('email')
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setIsAdmin(false)
        } else {
          setIsAdmin(data !== null)
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

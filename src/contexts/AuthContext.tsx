import { createContext, useCallback, useContext, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'

type OAuthProvider = 'google' | 'github' | 'apple'

type AuthApi = {
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, username?: string) => Promise<void>
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>
}

const Ctx = createContext<AuthApi | null>(null)

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string
)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signInWithOAuth = useCallback(async (provider: OAuthProvider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin }
    })
    if (error) throw error
  }, [])

  const signUp = useCallback(async (email: string, password: string, username?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } }
    })
    if (error) throw error

    const user = data.user
    if (!user) return

    const { error: insertErr } = await supabase.from('users').insert({
      id: user.id,
      email: user.email,
      username: username || null,
      plan_type: 'free',
      marketing_opt_in: false
    })
    if (insertErr && insertErr.code !== '23505') throw insertErr
  }, [])

  const value = useMemo(() => ({ signIn, signUp, signInWithOAuth }), [signIn, signUp, signInWithOAuth])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

export default AuthProvider

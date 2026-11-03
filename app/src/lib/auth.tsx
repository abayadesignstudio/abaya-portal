import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile } from './supabase'

type Auth = { session: Session | null; profile: Profile | null; loading: boolean; signOut: () => Promise<void> }
const Ctx = createContext<Auth>({ session: null, profile: null, loading: true, signOut: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let live = true
    if (!session) { setProfile(null); setLoading(false); return }
    setLoading(true)
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(({ data }) => {
      if (live) { setProfile(data as Profile | null); setLoading(false) }
    })
    return () => { live = false }
  }, [session])

  const signOut = async () => { await supabase.auth.signOut(); setProfile(null) }
  return <Ctx.Provider value={{ session, profile, loading, signOut }}>{children}</Ctx.Provider>
}
export const useAuth = () => useContext(Ctx)

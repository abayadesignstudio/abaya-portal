import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile } from './supabase'

type Auth = { session: Session | null; profile: Profile | null; loading: boolean; recovering: boolean; endRecovery: () => void; signOut: () => Promise<void>; refreshProfile: () => void }
const Ctx = createContext<Auth>({ session: null, profile: null, loading: true, recovering: false, endRecovery: () => {}, signOut: async () => {}, refreshProfile: () => {} })

/**
 * Sign-in state for the whole portal.
 *
 * Supabase re-announces the session whenever the tab regains focus and every time it refreshes the access
 * token (roughly hourly). Those announcements must NOT put the app back into "Loading…": App.tsx replaces
 * every screen while loading, which used to throw away open forms and unsaved input whenever you switched
 * to another window. So "loading" is only true until the first profile for a signed-in user has arrived;
 * later announcements for the same user refresh the profile quietly in the background.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const loadedFor = useRef<string | null>(null) // user id whose profile is currently loaded
  const [bump, setBump] = useState(0) // refreshProfile(): re-read the profile after the person edits it
  const [recovering, setRecovering] = useState(false) // opened a password-reset link: ask for a new password first

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      // keep the same object when nothing that matters changed, so screens don't re-render for nothing
      setSession((old) => (old && s && old.user.id === s.user.id && old.access_token === s.access_token ? old : s))
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id ?? null
  useEffect(() => {
    let live = true
    if (!uid) { loadedFor.current = null; setProfile(null); setLoading(false); return }
    const quiet = loadedFor.current === uid // same user: background refresh, no loading screen
    if (!quiet) setLoading(true)
    supabase.from('profiles').select('*').eq('id', uid).maybeSingle().then(({ data, error }) => {
      if (!live) return
      if (!(quiet && error)) setProfile((old) => (old && data && JSON.stringify(old) === JSON.stringify(data) ? old : (data as Profile | null)))
      loadedFor.current = uid
      setLoading(false)
    })
    return () => { live = false }
  }, [uid, session?.access_token, bump])

  const signOut = async () => { await supabase.auth.signOut({ scope: 'local' }); /* this device only */ loadedFor.current = null; setProfile(null) }
  return <Ctx.Provider value={{ session, profile, loading, recovering, endRecovery: () => setRecovering(false), signOut, refreshProfile: () => setBump((n) => n + 1) }}>{children}</Ctx.Provider>
}
export const useAuth = () => useContext(Ctx)

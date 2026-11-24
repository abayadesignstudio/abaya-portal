/** Bridge to the Abaya iPhone app (a native shell around the portal). Does nothing in a normal browser. */
type Handler = { postMessage: (m: unknown) => void }
const handler = (): Handler | undefined => (window as unknown as { webkit?: { messageHandlers?: { abaya?: Handler } } }).webkit?.messageHandlers?.abaya
export const isNativeApp = () => !!handler()
export const toNative = (m: Record<string, unknown>) => { try { handler()?.postMessage(m) } catch { /* not in the app */ } }

/** Shell → page messages ({ type, … }). Returns an unsubscribe function. */
export const onNative = (cb: (m: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const f = (e: Event) => cb((e as CustomEvent).detail ?? {})
  window.addEventListener('abaya-native', f)
  return () => window.removeEventListener('abaya-native', f)
}

/** Lets the app's native screens use the signed-in session (they call Supabase directly with it).
 *  The app reads it with callAsyncJavaScript('return await window.abayaNativeAuth()'). */
export const exposeNativeAuth = (getSession: () => Promise<{ access_token: string; user: { id: string } } | null>) => {
  if (!isNativeApp()) return
  ;(window as unknown as { abayaNativeAuth?: () => Promise<string> }).abayaNativeAuth = async () => {
    const s = await getSession()
    return s ? JSON.stringify({ token: s.access_token, me: s.user.id, url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }) : ''
  }
}

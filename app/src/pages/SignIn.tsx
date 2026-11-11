import { useState } from 'react'
import { supabase } from '../lib/supabase'

// The team signs in with their Google work account (the default). Email + password, a one-time email link and
// "Forgot password?" stay available under "Sign in with email" — clients use those, and they're the fallback for staff.
type Mode = 'google' | 'password' | 'link' | 'forgot'
const back = () => window.location.origin + window.location.pathname
const LAST = 'abaya.signin'
const lastWay = (): Mode => { try { return localStorage.getItem(LAST) === 'email' ? 'password' : 'google' } catch { return 'google' } }
const rememberWay = (w: 'google' | 'email') => { try { localStorage.setItem(LAST, w) } catch { /* private mode */ } }
// an error Google/Supabase sent back in the address after a failed sign-in
const urlError = () => { const q = new URLSearchParams(window.location.search + '&' + window.location.hash.replace(/^#\/?/, '')); return q.get('error_description') }

export default function SignIn() {
  const [mode, setMode] = useState<Mode>(lastWay)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [sent, setSent] = useState('')
  const [err, setErr] = useState(() => { const e = urlError(); return e ? `Google sign-in didn’t work: ${e.replace(/\+/g, ' ')}` : '' })
  const [busy, setBusy] = useState(false)
  const go = (m: Mode) => { setMode(m); setErr(''); setSent(''); rememberWay(m === 'google' ? 'google' : 'email') }
  const google = async () => {
    setErr(''); setBusy(true); rememberWay('google')
    const off = 'Google sign-in isn’t switched on yet. Use “Sign in with email” for now.'
    // ask Supabase first, so a switched-off provider shows a message here instead of a raw error page
    const on = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string } })
      .then((r) => r.json()).then((j) => !!j?.external?.google).catch(() => true)
    if (!on) { setBusy(false); setErr(off); return }
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back(), skipBrowserRedirect: true, queryParams: { hd: 'abayadesignstudio.com', prompt: 'select_account' } } })
    if (error || !data?.url) { setBusy(false); setErr(error?.message ?? off); return }
    window.location.assign(data.url)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    const em = email.trim()
    if (mode === 'password') {
      const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw })
      if (error) setErr(/invalid/i.test(error.message)
        ? 'That email and password don’t match. If you haven’t set a password yet, use “Email me a sign-in link” below, then set one under your name in the portal.'
        : error.message)
    } else if (mode === 'link') {
      const { error } = await supabase.auth.signInWithOtp({ email: em, options: { emailRedirectTo: back() } })
      if (error) setErr(/signups? not allowed|not found/i.test(error.message) ? 'That email isn’t set up for the portal. Ask Abaya Design Studio to add it.' : error.message)
      else setSent(`We sent a sign-in link to ${em}. Open it on this device.`)
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: back() })
      if (error) setErr(error.message)
      else setSent(`If ${em} has a portal account, we sent it a link to choose a new password.`)
    }
    setBusy(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--navy)', padding: 16 }}>
      <div className="card pad stack" style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ fontFamily: "'EB Garamond', Georgia, serif", textAlign: 'center', color: 'var(--navy)' }}>
          <div style={{ fontSize: 30, letterSpacing: '.18em' }}>ABAYA</div>
          <div style={{ fontSize: 11, letterSpacing: '.32em' }}>DESIGN STUDIO</div>
        </div>
        <h1 style={{ fontSize: 22, textAlign: 'center' }}>{mode === 'forgot' ? 'Reset your password' : 'Sign in to the portal'}</h1>
        {mode === 'google' ? (
          <div className="stack" style={{ gap: 14 }}>
            <button type="button" className="btn gsi" onClick={google} disabled={busy}>
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
              {busy ? 'Opening Google…' : 'Sign in with Google'}</button>
            <p className="muted" style={{ margin: 0, fontSize: 13.5, textAlign: 'center' }}>Abaya team: use your @abayadesignstudio.com Google account.</p>
            {err && <p className="err" role="alert">{err}</p>}
            <div className="gsi-or"><span>or</span></div>
            <button type="button" className="btn secondary" onClick={() => go('password')}>Sign in with email</button>
            <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: 'center' }}>Clients sign in with email.</p>
          </div>
        ) : sent ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="ok" role="status"><strong>Check your email.</strong> {sent}</div>
            <button type="button" className="linkbtn" style={{ textDecoration: 'underline' }} onClick={() => go('password')}>Back to sign in</button>
          </div>
        ) : (
          <form onSubmit={submit} className="stack">
            <div><label className="l" htmlFor="em">Email</label>
              <input id="em" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            {mode === 'password' && <div>
              <div className="row between"><label className="l" htmlFor="pw">Password</label>
                <button type="button" className="linkbtn" style={{ fontSize: 13, textDecoration: 'underline', marginBottom: 5 }} onClick={() => go('forgot')}>Forgot password?</button></div>
              <div style={{ position: 'relative' }}>
                <input id="pw" className="input" type={show ? 'text' : 'password'} autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} style={{ paddingRight: 64 }} />
                <button type="button" className="linkbtn" aria-pressed={show} onClick={() => setShow(!show)} style={{ position: 'absolute', right: 10, top: 12, fontSize: 13 }}>{show ? 'Hide' : 'Show'}</button>
              </div></div>}
            <button className="btn" disabled={busy}>{busy ? 'Please wait…' : mode === 'password' ? 'Sign in' : mode === 'link' ? 'Email me a sign-in link' : 'Email me a reset link'}</button>
            {err && <p className="err" role="alert">{err}</p>}
            <p className="muted" style={{ margin: 0, fontSize: 14, textAlign: 'center' }}>
              {mode === 'password'
                ? <>No password yet? <button type="button" className="linkbtn" style={{ textDecoration: 'underline' }} onClick={() => go('link')}>Email me a sign-in link</button></>
                : <button type="button" className="linkbtn" style={{ textDecoration: 'underline' }} onClick={() => go('password')}>Sign in with a password</button>}
            </p>
            <button type="button" className="linkbtn" style={{ textDecoration: 'underline', fontSize: 14, alignSelf: 'center' }} onClick={() => go('google')}>Abaya team: sign in with Google</button>
          </form>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Staff sign in with email + password. A one-time email link is still offered (clients use it, and it's the
// way in for anyone who hasn't set a password yet). "Forgot password?" emails a reset link.
type Mode = 'password' | 'link' | 'forgot'
const back = () => window.location.origin + window.location.pathname

export default function SignIn() {
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [sent, setSent] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const go = (m: Mode) => { setMode(m); setErr(''); setSent('') }

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
        {sent ? (
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
                ? <>No password yet, or a client? <button type="button" className="linkbtn" style={{ textDecoration: 'underline' }} onClick={() => go('link')}>Email me a sign-in link</button></>
                : <button type="button" className="linkbtn" style={{ textDecoration: 'underline' }} onClick={() => go('password')}>Sign in with a password</button>}
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

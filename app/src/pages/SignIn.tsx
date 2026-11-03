import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    })
    setBusy(false)
    if (error) setErr(error.message); else setSent(true)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--navy)', padding: 16 }}>
      <div className="card pad stack" style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ fontFamily: "'EB Garamond', Georgia, serif", textAlign: 'center', color: 'var(--navy)' }}>
          <div style={{ fontSize: 30, letterSpacing: '.18em' }}>ABAYA</div>
          <div style={{ fontSize: 11, letterSpacing: '.32em' }}>DESIGN STUDIO</div>
        </div>
        <h1 style={{ fontSize: 22, textAlign: 'center' }}>Sign in to the portal</h1>
        {sent ? (
          <div className="ok" role="status"><strong>Check your email.</strong> We sent a sign-in link to {email}. Open it on this device.</div>
        ) : (
          <form onSubmit={send} className="stack">
            <div><label className="l" htmlFor="em">Email</label>
              <input id="em" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
            {err && <p className="err" role="alert">{err}</p>}
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Clients and staff use the same page. No password needed.</p>
          </form>
        )}
      </div>
    </div>
  )
}

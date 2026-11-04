import { useState } from 'react'
import { supabase } from '../lib/supabase'

/** Shared "choose a password" form: used on My account and after a reset link. */
export function PasswordForm({ onDone, submitLabel = 'Save password' }: { onDone: () => void; submitLabel?: string }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (pw.length < 8) return setErr('Use at least 8 characters.')
    if (pw !== pw2) return setErr('The two passwords don’t match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setErr(/same/i.test(error.message) ? 'That’s already your password. Choose a different one.' : error.message)
    setPw(''); setPw2(''); onDone()
  }
  return (
    <form onSubmit={save} className="stack" style={{ gap: 10, maxWidth: 420 }}>
      <div><label className="l" htmlFor="np1">New password</label>
        <input id="np1" className="input" type={show ? 'text' : 'password'} autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby="np-h" />
        <p id="np-h" className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>At least 8 characters. A short phrase is easier to remember than a jumble.</p></div>
      <div><label className="l" htmlFor="np2">Type it again</label>
        <input id="np2" className="input" type={show ? 'text' : 'password'} autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
      <label className="row" style={{ gap: 8, fontSize: 14 }}><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} style={{ width: 18, height: 18 }} /> Show password</label>
      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div><button className="btn" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button></div>
    </form>
  )
}

/** Shown after opening a password-reset link. */
export default function SetPassword({ onDone }: { onDone: () => void }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--navy)', padding: 16 }}>
      <div className="card pad stack" style={{ width: '100%', maxWidth: 440 }}>
        <h1 style={{ fontSize: 22 }}>Choose a new password</h1>
        <PasswordForm onDone={onDone} submitLabel="Save and continue" />
      </div>
    </div>
  )
}

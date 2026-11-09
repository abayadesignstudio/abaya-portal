import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { PasswordForm } from './SetPassword'
import Avatar from '../components/Avatar'

/** My account: photo, sign-in email, Google Calendar and password. Shown at the top of Settings (embedded) and at #/account. */
export default function Account({ embedded }: { embedded?: boolean }) {
  const { profile, session } = useAuth()
  const [done, setDone] = useState(false)
  return (
    <div className="stack" style={embedded ? undefined : { maxWidth: 640 }}>
      {!embedded && <h1>My account</h1>}
      <PhotoSection />
      <section className="card pad stack" aria-labelledby="acc-h">
        <h2 id="acc-h" style={{ margin: 0 }}>{profile?.full_name || 'Your account'}</h2>
        <p className="muted" style={{ margin: 0 }}>Signed in as <strong>{session?.user.email}</strong>. You sign in with this email.</p>
      </section>
      <GoogleSection />
      <section className="card pad stack" aria-labelledby="pw-h">
        <h2 id="pw-h" style={{ margin: 0 }}>Password</h2>
        <p className="muted" style={{ margin: 0 }}>Set a password to sign in with your email and password instead of waiting for an emailed link. You can change it here anytime; the email link still works if you forget it.</p>
        {done && <p className="ok" role="status" style={{ margin: 0 }}>Password saved. Next time, sign in with your email and this password.</p>}
        <PasswordForm onDone={() => setDone(true)} />
      </section>
    </div>
  )
}

/** Connect Google: my portal tasks go to Google Tasks, and my Google Calendar meetings show on the portal calendar. */
function GoogleSection() {
  const loc = useLocation()
  const [conn, setConn] = useState<{ google_email: string | null; connected_at: string } | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const load = async () => { const { data } = await supabase.rpc('my_google_connection'); setConn(((data as unknown[]) ?? [])[0] as typeof conn ?? null) }
  useEffect(() => { load() }, [])
  useEffect(() => {
    const r = new URLSearchParams(loc.search).get('google')
    if (r) { load(); setBusy(false) }
    if (r === 'connected') setMsg({ ok: true, t: 'Google connected. Your tasks now go to Google Calendar (under Tasks), and your meetings show on the portal calendar.' })
    else if (r === 'cancelled') setMsg({ ok: false, t: 'Google wasn’t connected (you cancelled on Google’s page).' })
    else if (r === 'error') setMsg({ ok: false, t: 'Google couldn’t be connected. Try again; if it keeps failing, Google sync may not be fully set up yet.' })
  }, [loc.search])
  const connect = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.functions.invoke('google-oauth', { body: { return_to: window.location.origin + window.location.pathname } })
    if (error || !data?.url) {
      let code = ''
      try { code = (await (error as { context?: Response })?.context?.json())?.code ?? '' } catch { /* not JSON */ }
      setBusy(false)
      return setMsg({ ok: false, t: code === 'google_not_configured' ? 'Google sync isn’t switched on yet: an admin needs to finish the one-time Google setup first.' : 'Couldn’t reach Google. Try again in a moment.' })
    }
    window.location.href = data.url
  }
  const disconnect = async () => {
    if (!window.confirm('Disconnect Google? Your portal tasks stop going to Google (ones already there stay), and your meetings stop showing on the portal calendar.')) return
    setBusy(true); await supabase.rpc('disconnect_google'); setBusy(false); setMsg({ ok: true, t: 'Google disconnected.' }); load()
  }
  return (
    <section className="card pad stack" aria-labelledby="gg-h">
      <h2 id="gg-h" style={{ margin: 0 }}>Google Calendar</h2>
      <p className="muted" style={{ margin: 0 }}>Connect your Google account and every task assigned to you in the portal also shows in Google Calendar (as a Google Task); checking it off in the portal checks it off there too. Your Google Calendar meetings also show on the portal’s Home calendar, with titles, for the whole team. Events you mark Private in Google show only as “Busy”.</p>
      {conn === undefined ? <p className="muted" style={{ margin: 0 }}>Checking…</p>
        : conn ? <p style={{ margin: 0 }}><span className="badge b-paid">Connected</span> {conn.google_email ?? 'Google account'} · since {new Date(conn.connected_at).toLocaleDateString()}</p>
        : <p style={{ margin: 0 }}><span className="badge">Not connected</span></p>}
      {msg && <p className={msg.ok ? 'ok' : 'err'} role={msg.ok ? 'status' : 'alert'} style={{ margin: 0 }}>{msg.t}</p>}
      <div className="row" style={{ gap: 8 }}>
        {conn ? <button type="button" className="btn secondary" disabled={busy} onClick={disconnect}>Disconnect Google</button>
          : <button type="button" className="btn" disabled={busy || conn === undefined} onClick={connect}>{busy ? 'Opening Google…' : 'Connect Google'}</button>}
      </div>
    </section>
  )
}

/** Profile picture: cropped to a centered square and shrunk to 400px in the browser, stored in avatars/<my id>/. */
function PhotoSection() {
  const { profile, refreshProfile } = useAuth()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const square = (file: File) => new Promise<Blob>((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file)
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight), out = Math.min(400, side)
      const c = document.createElement('canvas'); c.width = c.height = out
      c.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out)
      URL.revokeObjectURL(url)
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t read that image.'))), 'image/jpeg', 0.9)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t an image this browser can read. Try a JPG or PNG.')) }
    img.src = url
  })
  const clearOld = async () => {
    const { data } = await supabase.storage.from('avatars').list(profile!.id)
    if (data?.length) await supabase.storage.from('avatars').remove(data.map((f) => `${profile!.id}/${f.name}`))
  }
  const upload = async (file: File | undefined) => {
    if (!file || !profile) return
    setBusy(true); setMsg(null)
    try {
      const blob = await square(file)
      await clearOld()
      const path = `${profile.id}/${Date.now()}.jpg`
      const up = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (up.error) throw up.error
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      const r = await supabase.from('profiles').update({ avatar_url: url }).eq('id', profile.id)
      if (r.error) throw r.error
      refreshProfile(); setMsg({ ok: true, t: 'Photo updated.' })
    } catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) }) }
    setBusy(false)
  }
  const remove = async () => {
    if (!profile) return
    setBusy(true); setMsg(null)
    await clearOld()
    const r = await supabase.from('profiles').update({ avatar_url: null }).eq('id', profile.id)
    setBusy(false)
    if (r.error) setMsg({ ok: false, t: r.error.message }); else { refreshProfile(); setMsg({ ok: true, t: 'Photo removed.' }) }
  }
  return (
    <section className="card pad stack" aria-labelledby="ph-h">
      <h2 id="ph-h" style={{ margin: 0 }}>Profile picture</h2>
      <div className="row" style={{ gap: 18 }}>
        <Avatar url={profile?.avatar_url} name={profile?.full_name || profile?.email} initials={profile?.initials} size={88} />
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <label className={'btn small' + (busy ? ' disabled' : '')} style={{ cursor: busy ? 'default' : 'pointer' }}>
              {busy ? 'Saving…' : profile?.avatar_url ? 'Change photo' : 'Upload photo'}
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="sr" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            {profile?.avatar_url && <button type="button" className="btn small secondary" disabled={busy} onClick={remove}>Remove</button>}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>JPG, PNG or WebP. It’s cropped to a centered square and shown as a circle.</p>
        </div>
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'err'} role={msg.ok ? 'status' : 'alert'} style={{ margin: 0 }}>{msg.t}</p>}
    </section>
  )
}

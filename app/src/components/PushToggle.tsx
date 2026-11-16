import { useEffect, useState } from 'react'
import { pushState, turnOffPush, turnOnPush, type PushState } from '../lib/push'

/** "Notifications on this device" — lock-screen notifications for updates, payments and assignments. */
export default function PushToggle({ compact = false }: { compact?: boolean }) {
  const [s, setS] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { pushState().then(setS).catch(() => setS('unsupported')) }, [])
  if (!s || s === 'unsupported') return null
  const flip = async () => {
    setBusy(true); setErr('')
    try { setS(s === 'on' ? await turnOffPush() : await turnOnPush()) } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const note = s === 'needs-install' ? 'On iPhone: tap Share → Add to Home Screen, open the portal from the new icon, then turn this on.'
    : s === 'blocked' ? 'Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.'
    : s === 'on' ? 'You’ll get lock-screen notifications on this device.' : 'Get lock-screen notifications on this device.'
  return (
    <div className={compact ? 'push-tg compact' : 'push-tg'}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>Notifications on this device</strong>
        <span className="muted" style={{ display: 'block', fontSize: 12.5, lineHeight: 1.35 }}>{note}</span>
        {err && <span className="err" role="alert" style={{ display: 'block', fontSize: 12.5 }}>{err}</span>}
      </div>
      {(s === 'on' || s === 'off') && <button type="button" className={'btn small' + (s === 'on' ? ' secondary' : '')} disabled={busy} onClick={flip}>{busy ? '…' : s === 'on' ? 'Turn off' : 'Turn on'}</button>}
    </div>
  )
}

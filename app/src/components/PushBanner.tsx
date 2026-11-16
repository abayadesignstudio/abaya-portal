import { useEffect, useState } from 'react'
import { pushState, type PushState } from '../lib/push'
import PushToggle from './PushToggle'

/** Clients: a one-time card offering lock-screen notifications (dismissible; hidden once they're on). */
export default function PushBanner() {
  const [s, setS] = useState<PushState | null>(null)
  const [hide, setHide] = useState(() => { try { return localStorage.getItem('abaya.push.dismissed') === '1' } catch { return false } })
  useEffect(() => { pushState().then(setS).catch(() => setS('unsupported')) }, [])
  if (hide || !s || s === 'unsupported' || s === 'on' || s === 'blocked') return null
  const close = () => { setHide(true); try { localStorage.setItem('abaya.push.dismissed', '1') } catch { /* private mode */ } }
  return (
    <div className="card pad" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}><PushToggle /></div>
      <button type="button" className="linkbtn" aria-label="Dismiss" onClick={close} style={{ fontSize: 20, lineHeight: 1 }}>×</button>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useTimer } from './useTimer'
import { TimerPanel, PlayIcon } from './Timer'
import './mobile-timer.css'

/** Phone timer (≤900px): a fixed bar at the bottom of the screen that opens a full-screen sheet.
 *  Shares state with the sidebar popover through useTimer, so starting on one shows on the other. */
export default function MobileTimer({ me }: { me: string }) {
  const api = useTimer(me)
  const [open, setOpen] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)
  const running = api.running
  const proj = running ? api.projects.find((p) => p.id === running.project_id) : null
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    sheet.current?.querySelector<HTMLElement>('select, button')?.focus()
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open])

  return (
    <div className="mtimer">
      <div className="mtimer-bar" role="region" aria-label="Timer">
        <button type="button" className="mtimer-open" onClick={() => setOpen(true)} aria-expanded={open}>
          <span className="num mtimer-clock" style={{ color: running ? (api.paused ? '#b54708' : '#039855') : '#5f6368' }}>{api.clock}</span>
          <span className="mtimer-label">{running ? (proj ? (proj.number === 'OH' ? `Overhead${running.activity ? ' · ' + running.activity : ''}` : `${proj.number} · ${proj.name}`) : 'Running') : 'No timer running'}</span>
        </button>
        {running && <button type="button" className="btn secondary mtimer-go" disabled={api.busy} onClick={() => (api.paused ? api.resume() : api.pause())}>{api.paused ? '▶ Resume' : '❚❚ Pause'}</button>}
        {running
          ? <button type="button" className="btn mtimer-go" disabled={api.busy} onClick={() => api.stop()} aria-label="End and log time"><PlayIcon running /> End</button>
          : <button type="button" className="btn mtimer-go" onClick={() => setOpen(true)}><PlayIcon running={false} /> Start</button>}
      </div>
      {open && (
        <div ref={sheet} className="mtimer-sheet" role="dialog" aria-modal="true" aria-label="Time entry">
          <div className="row between" style={{ padding: '14px 18px', background: 'var(--navy)', color: '#ede6d6' }}>
            <strong style={{ fontSize: 18 }}>Timer</strong>
            <button type="button" className="btn small secondary" onClick={() => setOpen(false)}>Close</button>
          </div>
          <TimerPanel api={api} idPrefix="mtm-" onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

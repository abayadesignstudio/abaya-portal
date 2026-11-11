import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TimerApi, TodayTask } from './useTimer'
import { sectorColor } from './Combobox'

// Document Picture-in-Picture: a small always-on-top window (Chrome / Edge on a computer).
type DocPip = { requestWindow: (o: { width: number; height: number }) => Promise<Window>; window: Window | null }
const pipApi = () => (window as unknown as { documentPictureInPicture?: DocPip }).documentPictureInPicture
export const pipSupported = () => !!pipApi()

/** Open/close the floating timer window. The window shows the same live timer (shared state). */
export function useTimerPip() {
  const [win, setWin] = useState<Window | null>(null)
  const open = async () => {
    const api = pipApi(); if (!api) return
    if (api.window) { api.window.focus(); return }
    const w = await api.requestWindow({ width: 320, height: 200 })
    // bring the portal's styles and fonts into the little window
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((n) => w.document.head.appendChild(n.cloneNode(true)))
    w.document.title = 'Timer'
    w.document.body.className = 'pip-body'
    w.addEventListener('pagehide', () => setWin(null))
    setWin(w)
  }
  const close = () => { win?.close(); setWin(null) }
  useEffect(() => () => { pipApi()?.window?.close() }, [])
  return { win, open, close }
}

const taskName = (t: { projects?: { number: string; name: string } | null; activity?: string | null }) =>
  t.projects?.number === 'OH' ? `Overhead${t.activity ? ' · ' + t.activity : ''}` : t.projects ? `${t.projects.number} · ${t.projects.name}` : ''

/** What the floating window shows: the clock, the task, and play/pause, end & log, and restart. */
export function TimerPipView({ api, win, onBack }: { api: TimerApi; win: Window; onBack: () => void }) {
  const r = api.running
  const proj = r ? api.projects.find((p) => p.id === r.project_id) : null
  const [pick, setPick] = useState('')
  const today = api.today
  const chosen: TodayTask | undefined = today.find((t) => t.key === pick) ?? today[0]
  const label = r ? (proj ? taskName({ projects: proj, activity: r.activity }) : 'Running') : chosen ? taskName(chosen) : 'No timer running'
  return createPortal(
    <div className={'pip' + (r ? (api.paused ? ' paused' : ' run') : '')}>
      <button type="button" className="pip-back" onClick={onBack} aria-label="Back to the portal" title="Back to the portal">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M15 9l-6 6M9 10v5h5" /></svg></button>
      <div className="pip-clock num">{r ? api.clock : chosen ? toClock(chosen.minutes) : '00:00:00'}</div>
      {!r && today.length > 1
        ? <select className="pip-task" aria-label="Task" value={chosen?.key ?? ''} onChange={(e) => setPick(e.target.value)}>{today.map((t) => <option key={t.key} value={t.key}>{taskName(t)}</option>)}</select>
        : <div className="pip-label" title={label}>{proj && proj.number !== 'OH' && <span className="pip-chip" style={{ background: sectorColor(proj.sector) }} />}{label}</div>}
      <div className="pip-btns">
        {r ? <>
          <button type="button" className="pip-btn main" disabled={api.busy} onClick={() => (api.paused ? api.resume() : api.pause())} aria-label={api.paused ? 'Resume' : 'Pause'} title={api.paused ? 'Resume' : 'Pause'}>
            {api.paused ? <Play /> : <svg width="14" height="16" viewBox="0 0 12 13" aria-hidden="true"><rect x="1" width="3.6" height="13" rx="1" fill="currentColor" /><rect x="7.4" width="3.6" height="13" rx="1" fill="currentColor" /></svg>}</button>
          <button type="button" className="pip-btn" disabled={api.busy} onClick={() => api.stop()} aria-label="End and log the time" title="End & log">
            <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" rx="2" fill="currentColor" /></svg></button>
          <button type="button" className="pip-btn" disabled={api.busy} onClick={() => { if (win.confirm('Restart this timer from 00:00? The time so far won’t be logged.')) api.restart() }} aria-label="Restart from zero" title="Restart">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 12a8 8 0 108-8H8M8 1L5 4l3 3" /></svg></button>
        </> : chosen
          ? <button type="button" className="pip-btn main" disabled={api.busy} onClick={() => api.pickUp(chosen)} aria-label={`Start ${taskName(chosen)}`} title="Start"><Play /></button>
          : <span className="pip-hint">Start a timer in the portal first.</span>}
      </div>
    </div>, win.document.body)
}
const Play = () => <svg width="15" height="16" viewBox="0 0 12 13" aria-hidden="true"><path d="M2 1l9 5.5L2 12z" fill="currentColor" /></svg>
const toClock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`

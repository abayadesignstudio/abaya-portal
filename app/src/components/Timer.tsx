import { useEffect, useRef, useState } from 'react'
import { PHASE_NAME } from '../lib/supabase'
import { ACTIVITIES, OVERHEAD, ROLES } from '../lib/time'
import { useTimer, uniqueRecent, type TimerApi, type TimerFields } from './useTimer'
import Combobox, { sectorColor } from './Combobox'

/** The time-entry form and recent list, shared by the sidebar popover and the phone sheet. */
export function TimerPanel({ api, idPrefix, onDone, onCancel }: { api: TimerApi; idPrefix: string; onDone: () => void; onCancel: () => void }) {
  const [view, setView] = useState<'form' | 'recent'>('form')
  const { v, setField, setV, err, busy, running, clock, projects, proj, isOverhead } = api
  const set = (k: keyof TimerFields) => (e: React.ChangeEvent<HTMLSelectElement | HTMLTextAreaElement>) => setField(k, e.target.value)
  const recents = uniqueRecent(api.recent)
  const id = (s: string) => idPrefix + s
  return (
    <>
      <div className="row between" style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)' }}>
        <button type="button" className="linkbtn" onClick={() => { if (view === 'form') api.refreshRecent(); setView(view === 'form' ? 'recent' : 'form') }}>{view === 'form' ? '‹ Recent entries' : '‹ Back'}</button>
        <button type="button" className="linkbtn" onClick={api.reset}>Reset</button>
      </div>
      {view === 'recent' ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 8, maxHeight: 420, overflowY: 'auto' }}>
          {recents.length === 0 && <li className="muted" style={{ padding: 12 }}>No entries yet.</li>}
          {recents.map((r, i) => <li key={i}><button type="button" className="recent" onClick={() => { setV({ project_id: r.project_id, phase_id: r.phase_id ?? '', role_label: r.role_label ?? '', activity: r.activity ?? '', note: '' }); setView('form') }}>
            <strong>{r.projects?.number === 'OH' ? 'Overhead' : `${r.projects?.number} · ${r.projects?.name}`}</strong><span className="muted">{[r.phases?.code, r.role_label, r.activity].filter(Boolean).join(' · ') || '—'}</span></button></li>)}
        </ul>
      ) : (
        <div className="stack" style={{ padding: 18, gap: 10 }}>
          <h2 style={{ fontSize: 22 }}>{running ? <>Running <span className="num" style={{ color: '#039855' }}>{clock}</span></> : 'Time entry'}</h2>
          <Combobox id={id('p')} label="Project" placeholder="Search projects" value={v.project_id} onChange={(x) => setField('project_id', x)}
            options={projects.map((p) => p.number === 'OH' ? { value: p.id, label: 'Overhead', search: 'OH overhead' } : { value: p.id, chip: p.number, color: sectorColor(p.sector), label: p.name })} />
          {!isOverhead && <Combobox id={id('ph')} label="Phase" placeholder={proj && proj.phases.length === 0 ? 'No phases set up yet' : 'Phase'} disabled={!proj || proj.phases.length === 0}
            value={v.phase_id} onChange={(x) => setField('phase_id', x)}
            options={(proj?.phases ?? []).map((x) => ({ value: x.id, chip: x.code, color: 'var(--navy, #02253d)', label: PHASE_NAME[x.code] ?? x.code }))} />}
          <div className="tm-pair">
            <div><label className="sr" htmlFor={id('r')}>Role</label><select id={id('r')} className="input" value={v.role_label} onChange={set('role_label')}><option value="">Role</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
            <div><label className="sr" htmlFor={id('a')}>Activity</label><select id={id('a')} className="input" value={v.activity} onChange={set('activity')}><option value="">{isOverhead ? 'Overhead type' : 'Activity'}</option>{(isOverhead ? OVERHEAD : ACTIVITIES).map((a) => <option key={a}>{a}</option>)}</select></div>
          </div>
          <label className="sr" htmlFor={id('n')}>Note</label>
          <textarea id={id('n')} className="input" rows={2} placeholder="Add a note (optional)" value={v.note} onChange={set('note')} style={{ background: '#f6f5f2', border: 0 }} />
          {err && <p className="err" role="alert">{err}</p>}
          {!running ? (
            <div className="row between"><button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
              <button type="button" className="btn" disabled={!v.project_id || busy} onClick={async () => { if (await api.start()) onDone() }}>Start timer</button></div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              <div className="tm-pair"><button type="button" className="btn" disabled={busy} onClick={async () => { if (await api.stop()) onDone() }}>■ Stop &amp; log</button>
                <button type="button" className="btn secondary" disabled={busy} onClick={api.switchTask} title="Logs the running time, then starts the task above">Switch task</button></div>
              <div className="row between"><button type="button" className="linkbtn" disabled={busy} onClick={async () => { if (await api.save()) onDone() }}>Save changes</button>
                <button type="button" className="linkbtn" style={{ color: 'var(--red)' }} disabled={busy} onClick={api.discard}>Discard time</button></div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

export function PlayIcon({ running }: { running: boolean }) {
  return (
    <span aria-hidden="true" style={{ width: 28, height: 28, flex: 'none', borderRadius: '50%', background: running ? '#039855' : '#9a8f63', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {running ? <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="1" fill="#fff" /></svg>
        : <svg width="12" height="12" viewBox="0 0 12 12" style={{ marginLeft: 2 }}><path d="M1 0.8 L11 6 L1 11.2 Z" fill="#02253d" /></svg>}
    </span>)
}

/** Sidebar button + popover (desktop). The phone bar (MobileTimer) shares the same state via useTimer. */
export default function SidebarTimer({ me }: { me: string }) {
  const api = useTimer(me)
  const [open, setOpen] = useState(false)
  const pop = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => { if (pop.current && !pop.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('keydown', onKey); const tm = setTimeout(() => window.addEventListener('mousedown', onClick))
    return () => { clearTimeout(tm); window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [open])
  const running = !!api.running
  return (
    <div style={{ position: 'relative', padding: '0 16px 12px' }}>
      <button type="button" className="timer-btn" onClick={() => setOpen(!open)} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 52, padding: '0 14px', borderRadius: 10, border: '1px solid rgba(154,143,99,.5)', background: running ? 'rgba(3,152,85,.18)' : 'rgba(237,230,214,.05)', color: '#ede6d6', font: '700 16px Arial', cursor: 'pointer' }}>
        <PlayIcon running={running} />
        {running ? <span className="num">{api.clock}</span> : 'Timer'}
      </button>
      {open && (
        <div ref={pop} role="dialog" aria-label="Time entry" style={{ position: 'fixed', left: 244, bottom: 16, width: 420, maxWidth: 'calc(100vw - 260px)', zIndex: 30, background: '#fff', color: 'var(--text)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,.28)' }}>
          <TimerPanel api={api} idPrefix="tm-" onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

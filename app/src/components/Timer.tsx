import { useEffect, useRef, useState } from 'react'
import { PHASE_NAME } from '../lib/supabase'
import { ACTIVITIES, OVERHEAD, ROLES, iso, announceTimeChange } from '../lib/time'
import { supabase } from '../lib/supabase'
import { useTimer, uniqueRecent, EMPTY_FIELDS, type TimerApi, type TimerFields } from './useTimer'
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


/** "1.5", "1:30", "90m", "2h" → minutes (0 if unreadable). */
export function parseDuration(s: string): number {
  const t = s.trim().toLowerCase()
  if (!t) return 0
  let m = /^(\d+):(\d{1,2})$/.exec(t); if (m) return +m[1] * 60 + +m[2]
  m = /^(\d+(?:\.\d+)?)\s*m(in)?s?$/.exec(t); if (m) return Math.round(+m[1])
  m = /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?)?$/.exec(t); if (m) return Math.round(+m[1] * 60)
  return 0
}
const fmtHours = (min: number) => (min / 60).toFixed(2).replace(/\.?0+$/, '')

/** Manual time entry: project, phase, role, activity, date, duration, note. Saves a finished entry. */
export function ManualPanel({ api, me, idPrefix, onDone, onCancel }: { api: TimerApi; me: string; idPrefix: string; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState<TimerFields>(EMPTY_FIELDS)
  const [date, setDate] = useState(iso(new Date()))
  const [dur, setDur] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const id = (x: string) => idPrefix + x
  const proj = api.projects.find((p) => p.id === f.project_id)
  const isOverhead = proj?.number === 'OH'
  const set = (k: keyof TimerFields, v: string) => setF((o) => ({ ...o, [k]: v, ...(k === 'project_id' ? { phase_id: '', activity: '' } : {}) }))
  const minutes = parseDuration(dur)
  const bump = (m: number) => setDur(fmtHours(Math.max(0, minutes + m)))
  const save = async () => {
    if (!f.project_id) return setErr('Choose a project.')
    if (!(minutes > 0)) return setErr('Enter how long you worked, e.g. 1.5 or 1:30.')
    if (minutes > 24 * 60) return setErr('That’s more than 24 hours. Split it across days.')
    setBusy(true); setErr('')
    const row = { project_id: f.project_id, phase_id: f.phase_id || null, role_label: f.role_label || null, activity: f.activity || null, note: f.note || null }
    const { error } = await supabase.from('time_entries').insert({ profile_id: me, ...row, work_date: date, minutes })
    if (!error) await supabase.from('timesheet_rows').insert({ profile_id: me, project_id: row.project_id, phase_id: row.phase_id, role_label: row.role_label, activity: row.activity })
    setBusy(false)
    if (error) return setErr(error.message)
    announceTimeChange(); api.refreshRecent(); onDone()
  }
  return (
    <div className="stack" style={{ padding: 18, gap: 10 }}>
      <h2 style={{ fontSize: 22, margin: 0 }}>Manual entry</h2>
      <Combobox id={id('p')} label="Project" placeholder="Search projects" value={f.project_id} onChange={(x) => set('project_id', x)}
        options={api.projects.map((p) => p.number === 'OH' ? { value: p.id, label: 'Overhead', search: 'OH overhead' } : { value: p.id, chip: p.number, color: sectorColor(p.sector), label: p.name })} />
      {!isOverhead && <Combobox id={id('ph')} label="Phase" placeholder={proj && proj.phases.length === 0 ? 'No phases set up yet' : 'Phase'} disabled={!proj || proj.phases.length === 0}
        value={f.phase_id} onChange={(x) => set('phase_id', x)}
        options={(proj?.phases ?? []).map((x) => ({ value: x.id, chip: x.code, color: 'var(--navy, #02253d)', label: PHASE_NAME[x.code] ?? x.code }))} />}
      <div className="tm-pair">
      <div><label className="sr" htmlFor={id('r')}>Role</label><select id={id('r')} className="input" value={f.role_label} onChange={(e) => set('role_label', e.target.value)}><option value="">Role</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
      <div><label className="sr" htmlFor={id('a')}>Activity</label><select id={id('a')} className="input" value={f.activity} onChange={(e) => set('activity', e.target.value)}><option value="">{isOverhead ? 'Overhead type' : 'Activity'}</option>{(isOverhead ? OVERHEAD : ACTIVITIES).map((a) => <option key={a}>{a}</option>)}</select></div>
      </div>
      <div><label className="l" htmlFor={id('d')}>Date</label><input id={id('d')} type="date" className="input" value={date} max={iso(new Date())} onChange={(e) => setDate(e.target.value)} /></div>
      <div><label className="l" htmlFor={id('h')}>Hours</label><input id={id('h')} className="input num" inputMode="decimal" placeholder="e.g. 1.5 or 1:30" value={dur} onChange={(e) => setDur(e.target.value)} aria-describedby={id('hh')} />
        <div className="row" style={{ gap: 6, marginTop: 6 }} id={id('hh')}>
          {([[15, '+15 min'], [30, '+30 min'], [60, '+1 hr']] as const).map(([m, l]) => <button key={m} type="button" className="btn small secondary" style={{ flex: 1, padding: 0 }} onClick={() => bump(m)}>{l}</button>)}
        </div>
        {minutes > 0 && <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>{Math.floor(minutes / 60)} h {minutes % 60} min</p>}</div>
      <label className="sr" htmlFor={id('n')}>Note</label>
      <textarea id={id('n')} className="input" rows={2} placeholder="Add a note (optional)" value={f.note} onChange={(e) => set('note', e.target.value)} style={{ background: '#f6f5f2', border: 0 }} />
      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className="row between"><button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Log time'}</button></div>
    </div>
  )
}

export function PlayIcon({ running }: { running: boolean }) {
  return (
    <span aria-hidden="true" style={{ width: 28, height: 28, flex: 'none', borderRadius: '50%', background: running ? '#039855' : '#9a8f63', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {running ? <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="1" fill="#fff" /></svg>
        : <svg width="12" height="12" viewBox="0 0 12 12" style={{ marginLeft: 2 }}><path d="M1 0.8 L11 6 L1 11.2 Z" fill="#02253d" /></svg>}
    </span>)
}

/** Sidebar timer (desktop). The circle starts the timer (or stops and logs it while running); the clock opens the
 *  running entry; "+" opens a manual entry. Panels open over the page, beside the sidebar, level with the button.
 *  The phone bar (MobileTimer) shares the same timer state via useTimer. */
export default function SidebarTimer({ me }: { me: string }) {
  const api = useTimer(me)
  const [open, setOpen] = useState<null | 'timer' | 'manual'>(null)
  const [flash, setFlash] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    const onClick = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(null) }
    window.addEventListener('keydown', onKey); const tm = setTimeout(() => window.addEventListener('mousedown', onClick))
    return () => { clearTimeout(tm); window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [open])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), 3500); return () => clearTimeout(t) }, [flash])
  const running = !!api.running
  const circle = async () => {
    if (running) { if (await api.stop()) { setOpen(null); setFlash('Time logged.') } else setOpen('timer'); return }
    setOpen(open === 'timer' ? null : 'timer')
  }
  return (
    <div ref={box} className="stimer">
      {open && (
        <div className="stimer-pop" role="dialog" aria-label={open === 'manual' ? 'Manual time entry' : 'Timer'}>
          {open === 'manual'
            ? <ManualPanel api={api} me={me} idPrefix="tmm-" onDone={() => { setOpen(null); setFlash('Time logged.') }} onCancel={() => setOpen(null)} />
            : <TimerPanel api={api} idPrefix="tm-" onDone={() => setOpen(null)} onCancel={() => setOpen(null)} />}
        </div>)}
      <div className={'stimer-bar' + (running ? ' on' : '')}>
        <button type="button" className="stimer-go" onClick={circle} aria-label={running ? 'Stop and log the timer' : 'Start a timer'} title={running ? 'Stop & log' : 'Start a timer'}>
          <PlayIcon running={running} />
        </button>
        {running
          ? <button type="button" className="stimer-clock num" onClick={() => setOpen(open === 'timer' ? null : 'timer')} aria-expanded={open === 'timer'} title="Edit or switch the running entry">{api.clock}</button>
          : <span className="stimer-label">{flash || 'Timer'}</span>}
        <button type="button" className="stimer-add" onClick={() => setOpen(open === 'manual' ? null : 'manual')} aria-expanded={open === 'manual'} aria-label="Add a manual time entry" title="Manual entry">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  )
}

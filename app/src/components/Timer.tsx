import { useEffect, useRef, useState } from 'react'
import { PHASE_NAME } from '../lib/supabase'
import { ACTIVITIES, OVERHEAD, ROLES, iso, announceTimeChange } from '../lib/time'
import { supabase } from '../lib/supabase'
import { useTimer, uniqueRecent, EMPTY_FIELDS, type TimerApi, type TimerFields, type TodayTask } from './useTimer'
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
          <h2 style={{ fontSize: 22 }}>{running ? <>{api.paused ? 'Paused' : 'Running'} <span className="num" style={{ color: api.paused ? '#b54708' : '#039855' }}>{clock}</span></> : 'Time entry'}</h2>
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
              <div className="tm-pair">
                {api.paused
                  ? <button type="button" className="btn secondary" disabled={busy} onClick={api.resume}>▶ Resume</button>
                  : <button type="button" className="btn secondary" disabled={busy} onClick={api.pause}>❚❚ Pause</button>}
                <button type="button" className="btn" disabled={busy} onClick={async () => { if (await api.stop()) onDone() }}>■ End &amp; log</button></div>
              <button type="button" className="btn secondary" disabled={busy} onClick={api.switchTask} title="Logs the running time, then starts the task above">Switch task</button>
              <div className="row between"><button type="button" className="linkbtn" disabled={busy} onClick={async () => { if (await api.save()) onDone() }}>Save changes</button>
                <span className="row" style={{ gap: 14 }}>
                  <button type="button" className="linkbtn" disabled={busy} onClick={() => { if (window.confirm('Restart this timer from 00:00? The time so far won’t be logged.')) api.restart() }}>Restart</button>
                  <button type="button" className="linkbtn" style={{ color: 'var(--red)' }} disabled={busy} onClick={api.discard}>Discard time</button></span></div>
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

export function PlayIcon({ running, pause }: { running: boolean; pause?: boolean }) {
  return (
    <span aria-hidden="true" style={{ width: 28, height: 28, flex: 'none', borderRadius: '50%', background: running ? '#039855' : '#9a8f63', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {pause ? <svg width="10" height="11" viewBox="0 0 10 11"><rect width="3.4" height="11" rx="1" fill="#fff" /><rect x="6.6" width="3.4" height="11" rx="1" fill="#fff" /></svg>
        : running ? <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="1" fill="#fff" /></svg>
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
    // a click that removed its own element (e.g. choosing an option closes the dropdown list) isn't an outside click
    const onClick = (e: MouseEvent) => { const t = e.target as Node; if (box.current && t.isConnected && !box.current.contains(t)) setOpen(null) }
    window.addEventListener('keydown', onKey); const tm = setTimeout(() => window.addEventListener('mousedown', onClick))
    return () => { clearTimeout(tm); window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [open])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), 3500); return () => clearTimeout(t) }, [flash])
  const running = !!api.running
  // the circle: start (opens the form) · pause while running · resume while paused
  const circle = async () => {
    if (running) { if (api.paused) await api.resume(); else await api.pause(); return }
    setOpen(open === 'timer' ? null : 'timer')
  }
  const end = async () => { if (await api.stop()) { setOpen(null); setFlash('Time logged.') } else setOpen('timer') }
  return (
    <div ref={box} className="stimer">
      <TodayList api={api} onPicked={(t) => setFlash(`Started ${taskName(t)}`)} />
      {open && (
        <div className="stimer-pop" role="dialog" aria-label={open === 'manual' ? 'Manual time entry' : 'Timer'}>
          {open === 'manual'
            ? <ManualPanel api={api} me={me} idPrefix="tmm-" onDone={() => { setOpen(null); setFlash('Time logged.') }} onCancel={() => setOpen(null)} />
            : <TimerPanel api={api} idPrefix="tm-" onDone={() => setOpen(null)} onCancel={() => setOpen(null)} />}
        </div>)}
      <div className={'stimer-bar' + (running ? (api.paused ? ' paused' : ' on') : '')}>
        <button type="button" className="stimer-go" onClick={circle} disabled={api.busy}
          aria-label={!running ? 'Start a timer' : api.paused ? 'Resume the timer' : 'Pause the timer'} title={!running ? 'Start a timer' : api.paused ? 'Resume' : 'Pause'}>
          <PlayIcon running={running && !api.paused} pause={running && !api.paused} />
        </button>
        {running
          ? <button type="button" className="stimer-clock num" onClick={() => setOpen(open === 'timer' ? null : 'timer')} aria-expanded={open === 'timer'} title="Edit or switch the running entry">
              {api.clock}{api.paused && <small className="stimer-paused">Paused</small>}</button>
          : <span className="stimer-label">{flash || 'Timer'}</span>}
        {running && <button type="button" className="stimer-end" onClick={end} disabled={api.busy} aria-label="End and log the time" title="End & log">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /></svg></button>}
        <button type="button" className="stimer-add" onClick={() => setOpen(open === 'manual' ? null : 'manual')} aria-expanded={open === 'manual'} aria-label="Add a manual time entry" title="Manual entry">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  )
}

const taskName = (t: TodayTask) => t.projects?.number === 'OH' ? `Overhead${t.activity ? ' · ' + t.activity : ''}` : `${t.projects?.number ?? ''} ${t.phases?.code ?? ''}`.trim()
const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`

/** Above the timer: what I've logged today, one line per task, with ▶ to pick it back up. */
function TodayList({ api, onPicked }: { api: TimerApi; onPicked: (t: TodayTask) => void }) {
  const r = api.running
  const isCurrent = (t: TodayTask) => !!r && r.project_id === t.project_id && (r.phase_id ?? null) === t.phase_id && (r.role_label ?? null) === t.role_label && (r.activity ?? null) === t.activity
  const list = api.today
  // the running timer's task: its line counts the clock too, so the list and the timer below read as one timer
  const liveMin = r ? Math.floor(api.elapsed / 60000) : 0
  const hasCurrentRow = list.some(isCurrent)
  if (!list.length && !r) return null
  const proj = r ? api.projects.find((p) => p.id === r.project_id) : null
  const rows: (TodayTask & { current?: boolean })[] = list.map((t) => (isCurrent(t) ? { ...t, minutes: t.minutes + liveMin, current: true } : t))
  if (r && !hasCurrentRow && proj) rows.unshift({ key: 'running', project_id: r.project_id, phase_id: r.phase_id, role_label: r.role_label, activity: r.activity, minutes: liveMin, last: '', current: true,
    projects: { number: proj.number, name: proj.name, sector: proj.sector ?? null }, phases: r.phase_id ? { code: proj.phases.find((x) => x.id === r.phase_id)?.code ?? '' } : null })
  const total = rows.reduce((a, t) => a + t.minutes, 0)
  return (
    <section className="stoday" aria-label="Logged today">
      <div className="stoday-h"><span>Today</span><span className="num">{hm(total)}</span></div>
      <ul>{rows.map((t) => {
        const oh = t.projects?.number === 'OH'
        return <li key={t.key} className={t.current ? (api.paused ? 'on paused' : 'on') : ''}>
          <span className="stoday-txt">
            <span className="stoday-chip" style={{ background: oh ? '#6b7280' : sectorColor(t.projects?.sector ?? null) }}>{oh ? 'OH' : t.projects?.number}</span>
            <span className="stoday-name" title={[t.projects?.name, t.phases?.code, t.role_label, t.activity].filter(Boolean).join(' · ')}>
              {oh ? (t.activity || 'Overhead') : t.projects?.name}{!oh && (t.phases?.code || t.activity) ? <span className="stoday-sub"> · {[t.phases?.code, t.activity].filter(Boolean).join(' · ')}</span> : null}</span>
          </span>
          <span className="num stoday-t">{hm(t.minutes)}</span>
          {t.current
            ? <button type="button" className="stoday-go stop" disabled={api.busy} onClick={() => api.stop()} aria-label={`End and log ${taskName(t)}`} title="End & log">
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="1.5" fill="currentColor" /></svg></button>
            : <button type="button" className="stoday-go" disabled={api.busy} onClick={async () => { if (await api.pickUp(t)) onPicked(t) }}
                aria-label={`Start a timer on ${taskName(t)}${r ? ' (ends and logs the current timer first)' : ''}`} title={r ? 'End the current timer and switch to this' : 'Pick this back up'}>
                <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true"><path d="M0.5 0.6L8.5 5 0.5 9.4z" fill="currentColor" /></svg></button>}
        </li>
      })}</ul>
    </section>)
}

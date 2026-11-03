import { useEffect, useMemo, useState } from 'react'
import { supabase, PHASE_NAME, SECTOR_COLOR } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'

type Proj = { id: string; number: string; name: string; sector: string | null; phases: { id: string; code: string }[] }
type Timer = { project_id: string; phase_id: string | null; role_label: string | null; activity: string | null; note: string | null; started_at: string; banked_minutes: number }
type Entry = { id: string; work_date: string; minutes: number; note: string | null; activity: string | null; billable: boolean; project_id: string; phase_id: string | null }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`
const parseDur = (s: string) => { const t = s.trim(); if (/^\d+:\d{1,2}$/.test(t)) { const [h, m] = t.split(':').map(Number); return h * 60 + m } const n = parseFloat(t); return isFinite(n) ? Math.round(n * 60) : 0 }
const ACTIVITIES = ['Design', 'Drafting', 'Client meeting', 'Coordination', 'Site visit', 'Code research', 'Admin']

export default function Time() {
  const { profile } = useAuth()
  const me = profile!.id
  const projects = useLoad(async () => must(await supabase.from('projects').select('id, number, name, sector, phases(id, code)').in('status', ['active', 'paused']).order('number', { ascending: false })) as unknown as Proj[])
  const timer = useLoad(async () => must(await supabase.from('timers').select('*').eq('profile_id', me).maybeSingle()) as Timer | null, [me])
  const [week, setWeek] = useState(() => mondayOf(new Date()))
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(week); d.setDate(d.getDate() + i); return d }), [week])
  const entries = useLoad(async () => must(await supabase.from('time_entries').select('id, work_date, minutes, note, activity, billable, project_id, phase_id')
    .eq('profile_id', me).gte('work_date', iso(days[0])).lte('work_date', iso(days[6])).order('created_at')) as Entry[], [me, week])
  const pById = Object.fromEntries((projects.data ?? []).map((p) => [p.id, p]))
  const phaseCode = (pid: string, phid: string | null) => pById[pid]?.phases.find((x) => x.id === phid)?.code
  const total = (entries.data ?? []).reduce((a, e) => a + e.minutes, 0)

  return (
    <div className="stack">
      <h1>Time</h1>
      <TimerCard me={me} projects={projects.data ?? []} timer={timer.data ?? null} onChange={() => { timer.reload(); entries.reload() }} />
      <section className="card pad stack">
        <div className="row between">
          <h2>Week of {days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} <span className="muted" style={{ fontWeight: 400 }}>· {hhmm(total)} hrs</span></h2>
          <div className="row">
            <button className="btn small secondary" aria-label="Previous week" onClick={() => { const d = new Date(week); d.setDate(d.getDate() - 7); setWeek(d) }}>‹</button>
            <button className="btn small secondary" onClick={() => setWeek(mondayOf(new Date()))}>This week</button>
            <button className="btn small secondary" aria-label="Next week" onClick={() => { const d = new Date(week); d.setDate(d.getDate() + 7); setWeek(d) }}>›</button>
          </div>
        </div>
        {days.map((d) => {
          const list = (entries.data ?? []).filter((e) => e.work_date === iso(d))
          const sum = list.reduce((a, e) => a + e.minutes, 0)
          return (
            <div key={iso(d)} style={{ borderTop: '1px solid #efece6', paddingTop: 10 }}>
              <div className="row between"><strong>{d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</strong><span className="num muted">{hhmm(sum)}</span></div>
              {list.map((e) => { const p = pById[e.project_id]; return (
                <div key={e.id} className="row" style={{ padding: '6px 0', gap: 8 }}>
                  {p && <span className="tag" style={{ background: SECTOR_COLOR[p.sector ?? 'internal'] }}>{p.number}</span>}
                  <span style={{ flex: 1, minWidth: 200 }}>{p?.name ?? 'Project'}{phaseCode(e.project_id, e.phase_id) && <span className="muted"> · {phaseCode(e.project_id, e.phase_id)}</span>}{e.activity && <span className="muted"> · {e.activity}</span>}{e.note && <em className="muted"> — {e.note}</em>}{!e.billable && <span className="pill" style={{ marginLeft: 6 }}>Non-billable</span>}</span>
                  <strong className="num">{hhmm(e.minutes)}</strong>
                  <button className="btn small danger" aria-label="Delete entry" onClick={async () => { await supabase.from('time_entries').delete().eq('id', e.id); entries.reload() }}>×</button>
                </div>) })}
            </div>)
        })}
        <ManualEntry me={me} projects={projects.data ?? []} defaultDate={iso(new Date())} onSaved={entries.reload} />
      </section>
    </div>
  )
}

function TaskFields({ projects, v, set, idp }: { projects: Proj[]; v: { project_id: string; phase_id: string; activity: string; note: string }; set: (k: string, x: string) => void; idp: string }) {
  const phases = projects.find((p) => p.id === v.project_id)?.phases ?? []
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,2fr) minmax(160px,1.2fr) minmax(140px,1fr) minmax(200px,2fr)', gap: 10 }}>
      <div><label className="l" htmlFor={idp + 'p'}>Project</label><select id={idp + 'p'} className="input" value={v.project_id} onChange={(e) => { set('project_id', e.target.value); set('phase_id', '') }}>
        <option value="">Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</select></div>
      <div><label className="l" htmlFor={idp + 'ph'}>Phase</label><select id={idp + 'ph'} className="input" value={v.phase_id} onChange={(e) => set('phase_id', e.target.value)}>
        <option value="">—</option>{phases.map((x) => <option key={x.id} value={x.id}>{x.code} · {PHASE_NAME[x.code]}</option>)}</select></div>
      <div><label className="l" htmlFor={idp + 'a'}>Activity</label><select id={idp + 'a'} className="input" value={v.activity} onChange={(e) => set('activity', e.target.value)}>
        <option value="">—</option>{ACTIVITIES.map((a) => <option key={a}>{a}</option>)}</select></div>
      <div><label className="l" htmlFor={idp + 'n'}>Note</label><input id={idp + 'n'} className="input" value={v.note} onChange={(e) => set('note', e.target.value)} /></div>
    </div>)
}

function TimerCard({ me, projects, timer, onChange }: { me: string; projects: Proj[]; timer: Timer | null; onChange: () => void }) {
  const [v, setV] = useState({ project_id: '', phase_id: '', activity: '', note: '' })
  const [now, setNow] = useState(Date.now())
  const [err, setErr] = useState('')
  useEffect(() => { if (!timer) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [timer])
  useEffect(() => { if (timer) setV({ project_id: timer.project_id, phase_id: timer.phase_id ?? '', activity: timer.activity ?? '', note: timer.note ?? '' }) }, [timer])
  const set = (k: string, x: string) => setV((o) => ({ ...o, [k]: x }))
  const elapsedMs = timer ? now - new Date(timer.started_at).getTime() + timer.banked_minutes * 60000 : 0
  const s = Math.max(0, Math.floor(elapsedMs / 1000))
  const clock = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const start = async () => {
    if (!v.project_id) return setErr('Choose a project first.')
    const { error } = await supabase.from('timers').upsert({ profile_id: me, project_id: v.project_id, phase_id: v.phase_id || null, activity: v.activity || null, note: v.note || null, started_at: new Date().toISOString(), banked_minutes: 0 })
    setErr(error?.message ?? ''); onChange()
  }
  const logCurrent = async () => {
    if (!timer) return
    const minutes = Math.max(1, Math.round(elapsedMs / 60000))
    const { error } = await supabase.from('time_entries').insert({ profile_id: me, project_id: v.project_id || timer.project_id, phase_id: (v.phase_id || timer.phase_id) || null,
      work_date: new Date().toISOString().slice(0, 10), minutes, activity: v.activity || null, note: v.note || null, started_at: timer.started_at, ended_at: new Date().toISOString() })
    if (error) { setErr(error.message); return false }
    await supabase.from('timers').delete().eq('profile_id', me); return true
  }
  const stop = async () => { if (await logCurrent()) { setV({ project_id: '', phase_id: '', activity: '', note: '' }); onChange() } }
  const reset = async () => { await supabase.from('timers').delete().eq('profile_id', me); onChange() }

  return (
    <section className="card pad stack" aria-label="Timer">
      <div className="row between"><h2>Timer</h2><span className="num" style={{ fontSize: 30, fontWeight: 700, color: timer ? '#039855' : 'var(--muted)' }} aria-live="polite">{clock}</span></div>
      <TaskFields projects={projects} v={v} set={set} idp="tm-" />
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row">
        {!timer && <button className="btn" onClick={start}>▶ Start timer</button>}
        {timer && <><button className="btn" onClick={stop}>■ Stop &amp; log</button>
          <button className="btn secondary" onClick={async () => { if (await logCurrent()) await start() }}>Switch task</button>
          <button className="btn secondary" onClick={reset}>Discard</button></>}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>The timer keeps running if you close the tab or switch to your phone. “Switch task” logs the current time and starts the new task.</p>
    </section>)
}

function ManualEntry({ me, projects, defaultDate, onSaved }: { me: string; projects: Proj[]; defaultDate: string; onSaved: () => void }) {
  const [v, setV] = useState({ project_id: '', phase_id: '', activity: '', note: '' })
  const [date, setDate] = useState(defaultDate); const [dur, setDur] = useState(''); const [billable, setBillable] = useState(true); const [err, setErr] = useState('')
  const save = async () => {
    const minutes = parseDur(dur)
    if (!v.project_id || minutes <= 0) return setErr('Choose a project and enter hours (e.g. 1.5 or 1:30).')
    const { error } = await supabase.from('time_entries').insert({ profile_id: me, project_id: v.project_id, phase_id: v.phase_id || null, work_date: date, minutes, activity: v.activity || null, note: v.note || null, billable })
    if (error) return setErr(error.message)
    setErr(''); setDur(''); setV({ ...v, note: '' }); onSaved()
  }
  return (
    <div className="stack" style={{ borderTop: '2px solid var(--line)', paddingTop: 14 }}>
      <h2 style={{ fontSize: 16 }}>Add time</h2>
      <TaskFields projects={projects} v={v} set={(k, x) => setV((o) => ({ ...o, [k]: x }))} idp="me-" />
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div><label className="l" htmlFor="me-d">Date</label><input id="me-d" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="l" htmlFor="me-h">Hours</label><input id="me-h" className="input num" style={{ width: 120 }} placeholder="1:30" value={dur} onChange={(e) => setDur(e.target.value)} /></div>
        <label className="row" style={{ gap: 6, minHeight: 44 }}><input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} style={{ width: 18, height: 18 }} />Billable</label>
        <button className="btn" onClick={save}>Add</button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
    </div>)
}

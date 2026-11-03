import { useMemo, useState } from 'react'
import { supabase, SECTOR_COLOR } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { workload, fmt, AVAILABLE_HRS, yearFraction, isoDate, parseDate, mondayOf } from './workload'
import './home.css'

type Person = { id: string; full_name: string | null; email: string; title: string | null; role: string; util_target: number | null; bill_rate: number | null }
type Ev = { id: string; profile_id: string; title: string; starts_on: string; ends_on: string; projects: { number: string; sector: string | null } | null }
type Dl = { id: string; assignee: string | null; title: string; due_date: string | null; status: string; created_at: string; projects: { number: string; sector: string | null } | null }
const NC = 30 // 6 weeks of weekdays

export default function Employees() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const year = new Date().getFullYear()
  const people = useLoad(async () => must(await supabase.from('profiles').select('id, full_name, email, title, role, util_target, bill_rate').in('role', ['admin', 'staff']).order('full_name')) as Person[])
  const time = useLoad(async () => must(await supabase.from('time_entries').select('profile_id, minutes, billable').gte('work_date', `${year}-01-01`)) as { profile_id: string; minutes: number; billable: boolean }[])
  const [start, setStart] = useState(() => { const m = mondayOf(new Date()); m.setDate(m.getDate() - 7); return m })
  const days = useMemo(() => Array.from({ length: NC }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + Math.floor(i / 5) * 7 + (i % 5)); return d }), [start])
  const end = days[NC - 1]
  const sched = useLoad(async () => {
    const ev = must(await supabase.from('calendar_events').select('id, profile_id, title, starts_on, ends_on, projects(number, sector)').lte('starts_on', isoDate(end)).gte('ends_on', isoDate(start))) as unknown as Ev[]
    const dl = must(await supabase.from('deliverables').select('id, assignee, title, due_date, status, created_at, projects(number, sector)').neq('status', 'done').not('assignee', 'is', null)) as unknown as Dl[]
    return { ev, dl }
  }, [start])
  const projects = useLoad(async () => must(await supabase.from('projects').select('id, number, name').in('status', ['active', 'paused']).order('number', { ascending: false })) as { id: string; number: string; name: string }[])

  const frac = yearFraction()
  const colOf = (s: string) => { const d = parseDate(s); const wk = Math.floor((mondayOf(d).getTime() - start.getTime()) / (7 * 86400000)); const wd = (d.getDay() + 6) % 7; return wk * 5 + Math.min(wd, 4) }
  const todayCol = colOf(isoDate(new Date()))

  return (
    <div className="stack">
      <div><h1>Employees</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>{year} · {Math.round(frac * 100)}% of the year gone · <em>{fmt(AVAILABLE_HRS)} available hours each (2,080 less 10 holidays and 10 PTO days)</em></p></div>
      {people.error && <p className="err">{people.error}</p>}
      <section className="em-cards" aria-label="Hours and utilization">
        {(people.data ?? []).map((p) => {
          const mine = (time.data ?? []).filter((t) => t.profile_id === p.id)
          const w = workload(p.util_target, mine.reduce((a, t) => a + t.minutes, 0), mine.filter((t) => t.billable).reduce((a, t) => a + t.minutes, 0))
          return <PersonCard key={p.id} p={p} w={w} canEdit={isAdmin} onSaved={people.reload} />
        })}
        {people.data && people.data.length === 0 && <p className="muted"><em>No staff have signed in yet.</em></p>}
      </section>

      <section className="card pad stack" aria-labelledby="em-cal">
        <div className="row between">
          <div><h2 id="em-cal">Schedule</h2><p className="muted" style={{ margin: '3px 0 0', fontSize: 13 }}>Portal calendar events and open deliverables. Google Calendar sync isn’t connected yet.</p></div>
          <div className="row">
            <button className="btn small secondary" aria-label="Earlier" onClick={() => { const d = new Date(start); d.setDate(d.getDate() - 7); setStart(d) }}>‹</button>
            <button className="btn small secondary" onClick={() => { const m = mondayOf(new Date()); m.setDate(m.getDate() - 7); setStart(m) }}>Today</button>
            <button className="btn small secondary" aria-label="Later" onClick={() => { const d = new Date(start); d.setDate(d.getDate() + 7); setStart(d) }}>›</button>
          </div>
        </div>
        {sched.error && <p className="err">{sched.error}</p>}
        <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 1000 }}>
          <div className="sched">
            <span />
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)' }}>{[0, 1, 2, 3, 4, 5].map((w) => <span key={w} style={{ padding: '0 6px 6px', fontSize: 13, fontWeight: 700, borderLeft: '1px solid #d6d1c6' }}>Week of {days[w * 5].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>)}</div>
              <div className="sched-cols">{days.map((d, i) => <span key={i} className="num" style={{ margin: '0 1px', padding: '3px 0', textAlign: 'center', fontSize: 11, borderRadius: 4, background: i === todayCol ? 'var(--navy)' : 'transparent', color: i === todayCol ? '#fff' : 'var(--muted)' }}>{'MTWTF'[i % 5]}<br />{d.getDate()}</span>)}</div>
            </div>
          </div>
          {(people.data ?? []).map((p) => {
            const bars = [
              ...(sched.data?.ev ?? []).filter((e) => e.profile_id === p.id).map((e) => ({ id: e.id, label: e.title, num: e.projects?.number, sector: e.projects?.sector, a: colOf(e.starts_on), b: colOf(e.ends_on) })),
              ...(sched.data?.dl ?? []).filter((d) => d.assignee === p.id && d.due_date).map((d) => ({ id: d.id, label: d.title, num: d.projects?.number, sector: d.projects?.sector, a: colOf(d.created_at.slice(0, 10)), b: colOf(d.due_date!) })),
            ].map((x) => ({ ...x, a: Math.max(0, x.a), b: Math.min(NC - 1, x.b) })).filter((x) => x.a <= x.b && x.b >= 0 && x.a < NC).sort((x, y) => x.a - y.a)
            const lanes: number[] = []
            const placed = bars.map((x) => { let l = lanes.findIndex((e) => e < x.a); if (l < 0) { l = lanes.length; lanes.push(-1) } lanes[l] = x.b; return { ...x, lane: l } })
            return (
              <div key={p.id} className="sched" style={{ borderTop: '1px solid var(--line)' }}>
                <div style={{ padding: '10px 10px 10px 0', fontWeight: 700, fontSize: 15 }}>{p.full_name || p.email}</div>
                <div style={{ position: 'relative', height: Math.max(1, lanes.length) * 34 + 10 }}>
                  <div aria-hidden="true" className="sched-cols" style={{ position: 'absolute', inset: 0 }}>{days.map((_, i) => <span key={i} style={{ borderLeft: `1px solid ${i % 5 === 0 ? '#d6d1c6' : '#efece6'}`, background: i === todayCol ? 'rgba(2,37,61,.06)' : 'transparent' }} />)}</div>
                  <ul className="sched-cols" style={{ listStyle: 'none', margin: 0, padding: 0, position: 'absolute', inset: 0 }}>
                    {placed.map((x) => <li key={x.id} title={`${x.num ?? ''} ${x.label}`} style={{ gridColumn: `${x.a + 1} / ${x.b + 2}`, gridRow: 1, alignSelf: 'start', marginTop: x.lane * 34 + 6, marginInline: 2, height: 28, minWidth: 0, padding: '0 8px', borderRadius: 5, background: SECTOR_COLOR[x.sector ?? 'internal'], color: '#fff', fontSize: 12, lineHeight: '28px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {x.num && <strong>{x.num} · </strong>}{x.label}</li>)}
                  </ul>
                </div>
              </div>)
          })}
        </div></div>
        <AddTask people={people.data ?? []} projects={projects.data ?? []} me={profile!.id} onSaved={sched.reload} />
      </section>
    </div>
  )
}

function PersonCard({ p, w, canEdit, onSaved }: { p: Person; w: ReturnType<typeof workload>; canEdit: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState(false)
  const [util, setUtil] = useState(String(p.util_target ?? '')); const [rate, setRate] = useState(String(p.bill_rate ?? ''))
  const [err, setErr] = useState('')
  const save = async () => {
    const { error } = await supabase.from('profiles').update({ util_target: util === '' ? null : Number(util), bill_rate: rate === '' ? null : Number(rate) }).eq('id', p.id)
    if (error) return setErr(error.message)
    setErr(''); setEdit(false); onSaved()
  }
  const ini = (p.full_name || p.email).split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase()
  return (
    <article className="card pad stack">
      <div className="row" style={{ gap: 12 }}>
        <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--navy)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>{ini}</span>
        <div style={{ flex: 1 }}><h2 style={{ fontSize: 18 }}>{p.full_name || p.email}</h2><p className="muted" style={{ margin: '2px 0 0', fontSize: 14 }}>{p.title || (p.role === 'admin' ? 'Admin' : 'Staff')}{p.bill_rate ? ` · $${p.bill_rate}/hr` : ''}</p></div>
        <div style={{ textAlign: 'right' }}><p className="num" style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{w.util ? w.util + '%' : '—'}</p><p className="muted" style={{ margin: 0, fontSize: 12 }}>utilization target</p></div>
      </div>
      {edit ? (
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div><label className="l" htmlFor={'ut-' + p.id}>Target %</label><input id={'ut-' + p.id} className="input num" style={{ width: 100 }} inputMode="decimal" value={util} onChange={(e) => setUtil(e.target.value)} /></div>
          <div><label className="l" htmlFor={'br-' + p.id}>Billable rate $/hr</label><input id={'br-' + p.id} className="input num" style={{ width: 130 }} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          <button className="btn small" onClick={save}>Save</button><button className="btn small secondary" onClick={() => setEdit(false)}>Cancel</button>
        </div>
      ) : w.util ? (
        <div>
          <div className="row between" style={{ fontSize: 14 }}><strong className="num">{fmt(w.bill)} of {fmt(w.target)} billable hrs</strong>
            <span style={{ fontWeight: 700, color: w.diff >= 0 ? 'var(--green)' : w.diff > -40 ? 'var(--amber)' : 'var(--red)' }}>{fmt(Math.abs(w.diff))} hrs {w.diff >= 0 ? 'ahead of' : 'behind'} pace</span></div>
          <div className="bar" aria-hidden="true" style={{ marginTop: 8 }}><span className="fill" style={{ width: w.fillPct + '%' }} /><span className="tick" style={{ left: w.pacePct + '%' }} /></div>
          <p className="muted num" style={{ margin: '6px 0 0', fontSize: 12 }}><em>Orange tick = {fmt(w.pace)} hrs expected by today</em></p>
        </div>
      ) : <p className="muted" style={{ margin: 0, fontSize: 14 }}><em>No utilization target set.</em></p>}
      {err && <p className="err" role="alert">{err}</p>}
      <dl className="em-stats">
        <div><dt>Target hrs / yr</dt><dd>{w.util ? fmt(w.target) : '—'}</dd></div>
        <div><dt>Logged YTD</dt><dd>{fmt(w.logged)}</dd></div>
        <div><dt>Utilization to date</dt><dd style={{ color: w.util ? (w.actual >= w.util ? 'var(--green)' : w.actual >= w.util - 5 ? 'var(--amber)' : 'var(--red)') : undefined }}>{w.actual}%</dd></div>
        <div><dt>Billable YTD</dt><dd>{fmt(w.bill)}</dd></div>
        <div><dt>Non-billable</dt><dd>{fmt(w.nonbill)}</dd></div>
        <div><dt>Billable hrs left</dt><dd>{w.util ? fmt(w.left) : '—'}</dd></div>
      </dl>
      {canEdit && !edit && <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit(true)}>Edit target and rate</button>}
    </article>
  )
}

function AddTask({ people, projects, me, onSaved }: { people: Person[]; projects: { id: string; number: string; name: string }[]; me: string; onSaved: () => void }) {
  const today = isoDate(new Date())
  const [f, setF] = useState({ who: '', project_id: '', title: '', s: today, e: today })
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('')
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: ev.target.value }); setMsg(''); setErr('') }
  const save = async () => {
    if (!f.who) return setErr('Choose a person.')
    if (!f.title.trim()) return setErr('Give the task a name.')
    if (f.e < f.s) return setErr('The end date must be on or after the start date.')
    const { error } = await supabase.from('calendar_events').insert({ profile_id: f.who, created_by: me, project_id: f.project_id || null, title: f.title.trim(), starts_on: f.s, ends_on: f.e })
    if (error) return setErr(error.message)
    const who = people.find((p) => p.id === f.who)
    setMsg(`Added “${f.title.trim()}” for ${who?.full_name || who?.email}.`); setF({ ...f, title: '' }); onSaved()
  }
  return (
    <div className="stack" role="group" aria-labelledby="em-add" style={{ padding: 16, borderRadius: 8, background: '#f6f5f2', border: '1px solid var(--line)', gap: 12 }}>
      <h3 id="em-add" style={{ margin: 0, fontSize: 16 }}>Add a task</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <div><label className="l" htmlFor="at-w">Person</label><select id="at-w" className="input" value={f.who} onChange={set('who')}><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></div>
        <div><label className="l" htmlFor="at-p">Project</label><select id="at-p" className="input" value={f.project_id} onChange={set('project_id')}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.number === 'OH' ? 'Internal' : `${p.number} · ${p.name}`}</option>)}</select></div>
        <div style={{ gridColumn: 'span 2' }}><label className="l" htmlFor="at-t">Task</label><input id="at-t" className="input" value={f.title} onChange={set('title')} placeholder="e.g. Revise reflected ceiling plan" /></div>
        <div><label className="l" htmlFor="at-s">Start</label><input id="at-s" type="date" className="input" value={f.s} onChange={set('s')} /></div>
        <div><label className="l" htmlFor="at-e">End</label><input id="at-e" type="date" className="input" value={f.e} onChange={set('e')} /></div>
      </div>
      <div className="row between"><span className="muted" style={{ fontSize: 13 }}>Saved to the portal calendar. Google Calendar sync comes later.</span><button className="btn" onClick={save}>Add task</button></div>
      {err && <p className="err" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
    </div>
  )
}

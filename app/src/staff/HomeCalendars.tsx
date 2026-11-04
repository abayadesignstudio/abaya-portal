import { useMemo, useState } from 'react'
import { supabase, SECTOR_COLOR, money } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { isoDate, parseDate, mondayOf } from './workload'

// Tasks and shared schedules on the home page.
//  - Tasks: one person each; checking one off crosses it out (it stays on the calendar, like Google Calendar).
//  - Admins see a month calendar and can assign tasks to anyone; staff assign only to themselves.
//  - Team week: everyone's events and tasks for Mon–Fri, visible to all staff.
// Every change is passed to the task-sync function, which mirrors it into the assignee's Google Tasks when they've
// connected Google (My account). If sync isn't set up, the portal works the same and nothing is lost.

export type Person = { id: string; full_name: string | null; email: string; initials: string | null; role: string }
export type Task = { id: string; title: string; notes: string | null; assignee: string; created_by: string | null; due_on: string; due_time: string | null; done_at: string | null
  project_id: string | null; projects: { number: string; name: string; sector: string | null } | null }
type Ev = { id: string; profile_id: string; project_id?: string | null; title: string; starts_on: string; ends_on: string; start_time: string | null; projects: { number: string; name: string; sector: string | null } | null }
type Proj = { id: string; number: string; name: string }

const TASK_SELECT = 'id, title, notes, assignee, created_by, due_on, due_time, done_at, project_id, projects(number, name, sector)'
const EV_SELECT = 'id, profile_id, project_id, title, starts_on, ends_on, start_time, projects(number, name, sector)'
const nameOf = (p?: Person) => p?.full_name || p?.email || 'Someone'
const firstName = (p?: Person) => nameOf(p).split(/\s+/)[0]
const time12 = (t: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'a' : 'p'}` }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

/** Mirror a task change into Google Tasks (best effort; never blocks the portal). */
export async function syncTask(id: string, op: 'upsert' | 'delete') {
  try { await supabase.functions.invoke('task-sync', { body: { id, op } }) } catch { /* sync is optional */ }
}

export function useStaff() {
  return useLoad(async () => must(await supabase.from('profiles').select('id, full_name, email, initials, role').in('role', ['admin', 'staff']).order('full_name')) as Person[])
}
export function useTasks(from: string, to: string, assignee?: string) {
  return useLoad(async () => {
    let q = supabase.from('tasks').select(TASK_SELECT).gte('due_on', from).lte('due_on', to)
    if (assignee) q = q.eq('assignee', assignee)
    return must(await q.order('due_on').order('due_time', { nullsFirst: true }).order('created_at')) as unknown as Task[]
  }, [from, to, assignee])
}

/** One task line: checkbox (crosses it out), title, time/project, and remove for its owner or an admin. */
export function TaskItem({ t, me, admin, people, showWho, prefixName, onChange }: { t: Task; me: string; admin: boolean; people: Person[]; showWho?: boolean; prefixName?: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [optimistic, setOptimistic] = useState<{ v: boolean; was: string | null } | null>(null) // flips instantly; cleared once the list reloads
  const done = optimistic && optimistic.was === t.done_at ? optimistic.v : !!t.done_at
  const mine = t.assignee === me || t.created_by === me || admin
  const who = people.find((p) => p.id === t.assignee)
  const toggle = async () => {
    const next = !done
    setOptimistic({ v: next, was: t.done_at }); setBusy(true)
    const { error } = await supabase.from('tasks').update({ done_at: next ? new Date().toISOString() : null }).eq('id', t.id)
    setBusy(false)
    if (error) { setOptimistic(null); return }
    onChange(); syncTask(t.id, 'upsert')
  }
  const remove = async () => {
    if (!window.confirm(`Delete the task “${t.title}”?`)) return
    setBusy(true); await syncTask(t.id, 'delete')
    await supabase.from('tasks').delete().eq('id', t.id); setBusy(false); onChange()
  }
  return (
    <li className={'tk' + (done ? ' done' : '')} style={{ borderLeftColor: t.projects ? SECTOR_COLOR[t.projects.sector ?? 'internal'] : '#9aa4b2' }}>
      <label className="tk-main" title={t.notes || undefined}>
        <input type="checkbox" checked={done} disabled={!mine} onChange={() => { if (!busy) toggle() }} aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${t.title}`} />
        <span className="tk-text">
          {t.due_time && <span className="num tk-time">{time12(t.due_time)} </span>}
          <span className="tk-title">{prefixName && <span className="tk-who">{firstName(who)}: </span>}{t.title}</span>
          {(showWho || t.projects) && <span className="tk-sub">{[showWho ? firstName(who) : '', t.projects?.number].filter(Boolean).join(' · ')}</span>}
        </span>
      </label>
      {mine && <button type="button" className="tk-x" onClick={remove} disabled={busy} aria-label={`Delete task ${t.title}`}>×</button>}
    </li>
  )
}


/** A calendar event (older "+ Add to calendar" items). Checking it turns it into a completed task, so it crosses out
 *  like any task. Only the person it belongs to, or an admin, can do that. */
export function EventItem({ e, me, admin, people, onChange }: { e: Ev; me: string; admin: boolean; people: Person[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false) // flips instantly; the item becomes a done task on reload
  const mine = e.profile_id === me || admin
  const who = people.find((p) => p.id === e.profile_id)
  const complete = async () => {
    setChecked(true); setBusy(true)
    const { data, error } = await supabase.from('tasks').insert({ title: e.title, assignee: e.profile_id, created_by: me, due_on: e.starts_on, due_time: e.start_time,
      project_id: e.project_id ?? null, done_at: new Date().toISOString() }).select('id').single()
    if (error) { setChecked(false); setBusy(false); return }
    await supabase.from('calendar_events').delete().eq('id', e.id); syncTask((data as { id: string }).id, 'upsert')
    setBusy(false); onChange()
  }
  return (
    <li className="tk" style={{ borderLeftColor: e.projects ? SECTOR_COLOR[e.projects.sector ?? 'internal'] : '#9aa4b2' }}>
      <label className="tk-main">
        <input type="checkbox" checked={checked} disabled={!mine} onChange={() => { if (!busy && !checked) complete() }} aria-label={`Mark done: ${e.title}`} />
        <span className="tk-text">
          {e.start_time && <span className="num tk-time">{time12(e.start_time)} </span>}
          <span className="tk-title"><span className="tk-who">{firstName(who)}: </span>{e.title}</span>
          {e.projects && <span className="tk-sub">{e.projects.number}</span>}
        </span>
      </label>
    </li>
  )
}


type BillRow = { id: string; name: string; amount: number; due_on: string; paid_on: string | null }
/** A company bill on its due date (admins). Checking it marks it paid; paid bills stay, crossed out. */
function BillItem({ b, onChange }: { b: BillRow; onChange: () => void }) {
  const [opt, setOpt] = useState<boolean | null>(null)
  const paid = opt ?? !!b.paid_on
  const overdue = !paid && b.due_on < isoDate(new Date())
  const toggle = async () => {
    const next = !paid; setOpt(next)
    const d = new Date()
    const { error } = await supabase.from('company_bills').update({ paid_on: next ? isoDate(d) : null }).eq('id', b.id)
    if (error) setOpt(null); else onChange()
  }
  return (
    <li className={'tk tk-bill' + (paid ? ' done' : '') + (overdue ? ' over' : '')}>
      <label className="tk-main" title={paid ? `Paid ${b.paid_on ?? ''}` : overdue ? 'Overdue' : 'Bill due'}>
        <input type="checkbox" checked={paid} onChange={toggle} aria-label={`${paid ? 'Mark unpaid' : 'Mark paid'}: ${b.name}`} />
        <span className="tk-text"><span className="tk-title"><span className="tk-who">Bill: </span>{b.name} <span className="num">{money(b.amount).replace('.00', '')}</span></span></span>
      </label>
    </li>
  )
}

/** Add a task: admins choose anyone; staff add for themselves. */
export function AddTask({ me, admin, people, projects, day, onDone, onCancel }: { me: string; admin: boolean; people: Person[]; projects: Proj[]; day: string; onDone: (msg: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ title: '', due_on: day, due_time: '', assignee: me, project_id: '', notes: '' })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.title.trim()) return setErr('Give the task a title.')
    if (!f.due_on) return setErr('Choose a date.')
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('tasks').insert({ title: f.title.trim(), due_on: f.due_on, due_time: f.due_time || null, assignee: f.assignee,
      project_id: f.project_id || null, notes: f.notes.trim() || null, created_by: me }).select('id').single()
    setBusy(false)
    if (error) return setErr(error.message)
    syncTask((data as { id: string }).id, 'upsert')
    const who = people.find((p) => p.id === f.assignee)
    onDone(f.assignee === me ? 'Task added.' : `Task added for ${firstName(who)}.`)
  }
  return (
    <form onSubmit={save} className="tk-form">
      <div style={{ gridColumn: '1 / -1' }}><label className="l" htmlFor="tk-t">Task</label>
        <input id="tk-t" className="input" required autoFocus placeholder="e.g. Send revised plans to client" value={f.title} onChange={set('title')} /></div>
      <div><label className="l" htmlFor="tk-d">Date</label><input id="tk-d" type="date" className="input" required value={f.due_on} onChange={set('due_on')} /></div>
      <div><label className="l" htmlFor="tk-tm">Time (optional)</label><input id="tk-tm" type="time" className="input" value={f.due_time} onChange={set('due_time')} /></div>
      <div><label className="l" htmlFor="tk-a">Assign to</label>
        <select id="tk-a" className="input" value={f.assignee} onChange={set('assignee')} disabled={!admin}>
          {(admin ? people : people.filter((p) => p.id === me)).map((p) => <option key={p.id} value={p.id}>{p.id === me ? `Me (${nameOf(p)})` : nameOf(p)}</option>)}
        </select></div>
      <div><label className="l" htmlFor="tk-p">Project (optional)</label>
        <select id="tk-p" className="input" value={f.project_id} onChange={set('project_id')}>
          <option value="">—</option>{projects.filter((p) => p.number !== 'OH').map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</select></div>
      <div style={{ gridColumn: '1 / -1' }}><label className="l" htmlFor="tk-n">Notes (optional)</label><textarea id="tk-n" className="input" rows={2} value={f.notes} onChange={set('notes')} /></div>
      {err && <p className="err" role="alert" style={{ gridColumn: '1 / -1', margin: 0 }}>{err}</p>}
      <div className="row" style={{ gridColumn: '1 / -1', gap: 8 }}>
        <button className="btn" disabled={busy}>{busy ? 'Adding…' : 'Add task'}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button></div>
    </form>
  )
}

/** Home: month calendar of everyone's tasks (and older events), shown as "Name: task", filterable by person.
 *  Admins can assign to anyone; staff add their own. Check a task off and it stays, crossed out. */
export function MonthCalendar({ me, admin, people, projects }: { me: string; admin: boolean; people: Person[]; projects: Proj[] }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [who, setWho] = useState<string>('all')
  const [adding, setAdding] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const start = mondayOf(month)
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(start, i)), [start.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const from = isoDate(cells[0]), to = isoDate(cells[41])
  const tasks = useTasks(from, to)
  const evs = useLoad(async () => must(await supabase.from('calendar_events').select(EV_SELECT).lte('starts_on', to).gte('ends_on', from)) as unknown as Ev[], [from, to])
  // bills due (admins only; bills include salaries)
  const bills = useLoad(async () => admin ? must(await supabase.from('company_bills').select('id, name, amount, due_on, paid_on').gte('due_on', from).lte('due_on', to)) as BillRow[] : [], [admin, from, to])
  const [showBills, setShowBills] = useState(true)
  const reload = () => { tasks.reload(); evs.reload(); bills.reload() }
  const today = isoDate(new Date())
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const rows = Math.ceil((Math.round((last.getTime() - start.getTime()) / 86400000) + 1) / 7) // weeks this month touches
  const show = (pid: string) => who === 'all' || pid === who
  const order = [...people].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : nameOf(a).localeCompare(nameOf(b))))
  const rank = (pid: string) => order.findIndex((p) => p.id === pid)
  return (
    <section className="card pad stack" aria-labelledby="mc-h">
      <div className="row between">
        <h2 id="mc-h">{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
        <div className="row">
          <button className="btn small secondary" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
          <button className="btn small secondary" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)) }}>Today</button>
          <button className="btn small secondary" aria-label="Next month" onClick={() => shift(1)}>›</button>
          <button className="btn small" onClick={() => { setAdding(adding ? null : today); setMsg('') }}>{adding ? 'Close' : admin ? '+ Assign task' : '+ Task'}</button>
        </div>
      </div>
      <div className="row" role="group" aria-label="Show tasks for" style={{ gap: 6 }}>
        <button type="button" className={'btn small' + (who === 'all' ? '' : ' secondary')} aria-pressed={who === 'all'} onClick={() => setWho('all')}>Everyone</button>
        {order.map((p) => <button key={p.id} type="button" className={'btn small' + (who === p.id ? '' : ' secondary')} aria-pressed={who === p.id} onClick={() => setWho(p.id)}>{p.id === me ? 'Me' : firstName(p)}</button>)}
        {admin && <label className="row" style={{ gap: 6, marginLeft: 'auto', fontSize: 14 }}><input type="checkbox" checked={showBills} onChange={(e) => setShowBills(e.target.checked)} style={{ width: 16, height: 16 }} /> Show bills</label>}
      </div>
      {adding && <AddTask me={me} admin={admin} people={people} projects={projects} day={adding} onCancel={() => setAdding(null)} onDone={(m) => { setAdding(null); setMsg(m); tasks.reload() }} />}
      {msg && <p className="ok" role="status" style={{ margin: 0 }}>{msg}</p>}
      {(tasks.error || evs.error) && <p className="err">{tasks.error || evs.error}</p>}
      <div style={{ overflowX: 'auto' }}><div className="mc" style={{ minWidth: 760 }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="mc-h">{d}</div>)}
        {cells.slice(0, rows * 7).map((d) => {
          const k = isoDate(d); const out = d.getMonth() !== month.getMonth()
          const dayTasks = (tasks.data ?? []).filter((t) => t.due_on === k && show(t.assignee)).sort((a, b) => rank(a.assignee) - rank(b.assignee))
          const dayEvs = (evs.data ?? []).filter((e) => e.starts_on <= k && e.ends_on >= k && show(e.profile_id))
          return (
            <div key={k} className={'mc-cell' + (out ? ' out' : '') + (k === today ? ' today' : '')}>
              <div className="row between" style={{ gap: 4 }}>
                <span className="mc-d">{d.getDate()}</span>
                <button type="button" className="mc-add" onClick={() => { setAdding(k); setMsg('') }} aria-label={`Add a task on ${d.toDateString()}`}>+</button>
              </div>
              <ul className="tk-list">
                {showBills && (bills.data ?? []).filter((b) => b.due_on === k).map((b) => <BillItem key={b.id} b={b} onChange={bills.reload} />)}
                {dayEvs.map((e) => <EventItem key={e.id} e={e} me={me} admin={admin} people={people} onChange={reload} />)}
                {dayTasks.map((t) => <TaskItem key={t.id} t={t} me={me} admin={admin} people={people} prefixName onChange={reload} />)}
              </ul>
            </div>)
        })}
      </div></div>
    </section>
  )
}

/** Staff week view: my tasks for a given day (used inside the existing week calendar). */
export function dayTasks(tasks: Task[] | null, day: Date) { const k = isoDate(day); return (tasks ?? []).filter((t) => t.due_on === k) }
export { parseDate }

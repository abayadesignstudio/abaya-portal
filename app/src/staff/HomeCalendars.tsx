import { useMemo, useState } from 'react'
import { supabase, SECTOR_COLOR, money } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { isoDate, parseDate, mondayOf } from './workload'

// Tasks and shared schedules on the home page.
//  - Tasks: one person each; checking one off crosses it out (it stays on the calendar, like Google Calendar).
//    Click a task's text to edit it (title, date, time, person, project, notes).
//  - Admins can assign tasks to anyone; staff assign only to themselves.
//  - Google meetings: each connected person's Google Calendar (via the calendar-feed function), titles visible to all
//    staff. A meeting is tied to a project when its title/description has a project number, or when someone links one.
// Every change is passed to the task-sync function, which mirrors it into the assignee's Google Tasks when they've
// connected Google (My account). If sync isn't set up, the portal works the same and nothing is lost.

export type Person = { id: string; full_name: string | null; email: string; initials: string | null; role: string }
export type Task = { id: string; title: string; notes: string | null; assignee: string; created_by: string | null; due_on: string; due_time: string | null; done_at: string | null
  project_id: string | null; projects: { number: string; name: string; sector: string | null } | null }
type Ev = { id: string; profile_id: string; project_id?: string | null; title: string; starts_on: string; ends_on: string; start_time: string | null; projects: { number: string; name: string; sector: string | null } | null }
export type Proj = { id: string; number: string; name: string; sector?: string | null }
type GEv = { id: string; profile_id: string; title: string; start: string; end: string; all_day: boolean; location: string | null; hint: string; busy_only: boolean }
type Link = { google_event_id: string; project_id: string | null }

const TASK_SELECT = 'id, title, notes, assignee, created_by, due_on, due_time, done_at, project_id, projects(number, name, sector)'
const EV_SELECT = 'id, profile_id, project_id, title, starts_on, ends_on, start_time, projects(number, name, sector)'
const nameOf = (p?: Person) => p?.full_name || p?.email || 'Someone'
const firstName = (p?: Person) => nameOf(p).split(/\s+/)[0]
const time12 = (t: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'a' : 'p'}` }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const sectorColor = (s?: string | null) => SECTOR_COLOR[s ?? 'internal'] ?? '#9aa4b2'

/** Small colored project-number tag (hover shows the project name). */
function ProjTag({ p }: { p: { number: string; name: string; sector?: string | null } | null | undefined }) {
  if (!p) return null
  return <span className="tk-proj" style={{ background: sectorColor(p.sector) }} title={`${p.number} · ${p.name}`}>{p.number}</span>
}

/** Find a project number in a meeting's title, location or description ("2608B site visit" → 2608B). Longest number wins. */
export function matchProject(text: string, projects: Proj[]): Proj | undefined {
  const cands = projects.filter((p) => p.number && p.number !== 'OH' && p.number.length >= 3).sort((a, b) => b.number.length - a.number.length)
  return cands.find((p) => new RegExp(`(^|[^A-Za-z0-9])${p.number.replace(/[^A-Za-z0-9]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i').test(text))
}

/** The days (YYYY-MM-DD, local time) a Google event covers. All-day end dates are exclusive in Google. */
export function eventDays(e: GEv): string[] {
  const s = e.all_day ? parseDate(e.start) : new Date(e.start)
  let end = e.all_day ? addDays(parseDate(e.end), -1) : new Date(e.end)
  if (!e.all_day && end > s && end.getHours() === 0 && end.getMinutes() === 0) end = new Date(end.getTime() - 1) // ends at midnight
  const out: string[] = []
  for (let d = new Date(s.getFullYear(), s.getMonth(), s.getDate()); d <= end && out.length < 62; d = addDays(d, 1)) out.push(isoDate(d))
  return out.length ? out : [isoDate(s)]
}
const hhmm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

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
export function TaskItem({ t, me, admin, people, showWho, prefixName, onChange, onEdit }: { t: Task; me: string; admin: boolean; people: Person[]; showWho?: boolean; prefixName?: boolean; onChange: () => void; onEdit?: (t: Task) => void }) {
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
    <li className={'tk' + (done ? ' done' : '')} style={{ borderLeftColor: t.projects ? sectorColor(t.projects.sector) : '#9aa4b2' }}>
      <div className="tk-main">
        <input type="checkbox" checked={done} disabled={!mine} onChange={() => { if (!busy) toggle() }} aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${t.title}`} />
        {(() => {
          const body = <>
            {t.due_time && <span className="num tk-time">{time12(t.due_time)} </span>}
            <span className="tk-title">{prefixName && <span className="tk-who">{firstName(who)}: </span>}{t.title}</span>
            {showWho && <span className="tk-sub">{firstName(who)}</span>}
            <ProjTag p={t.projects} />
          </>
          return mine && onEdit
            ? <button type="button" className="tk-text tk-open" title={t.notes ? `${t.notes}\n\nClick to edit` : 'Click to edit'} onClick={() => onEdit(t)}>{body}</button>
            : <span className="tk-text" title={t.notes || undefined}>{body}</span>
        })()}
      </div>
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
    <li className="tk" style={{ borderLeftColor: e.projects ? sectorColor(e.projects.sector) : '#9aa4b2' }}>
      <label className="tk-main">
        <input type="checkbox" checked={checked} disabled={!mine} onChange={() => { if (!busy && !checked) complete() }} aria-label={`Mark done: ${e.title}`} />
        <span className="tk-text">
          {e.start_time && <span className="num tk-time">{time12(e.start_time)} </span>}
          <span className="tk-title"><span className="tk-who">{firstName(who)}: </span>{e.title}</span>
          <ProjTag p={e.projects} />
        </span>
      </label>
    </li>
  )
}


/** A Google Calendar meeting (read-only here). Click it to tie it to a project. */
function GEventItem({ e, people, project, onOpen }: { e: GEv; people: Person[]; project?: Proj; onOpen?: (e: GEv) => void }) {
  const who = people.find((p) => p.id === e.profile_id)
  const body = <>
    {!e.all_day && <span className="num tk-time">{time12(hhmm(e.start))} </span>}
    <span className="tk-title"><span className="tk-who">{firstName(who)}: </span>{e.title}</span>
    <ProjTag p={project} />
  </>
  const tip = [e.title, e.location, 'Google Calendar', onOpen ? 'Click to link a project' : ''].filter(Boolean).join('\n')
  return (
    <li className="tk tk-g" style={{ borderLeftColor: project ? sectorColor(project.sector) : '#9aa4b2' }}>
      <div className="tk-main">
        <span className="tk-gicon" aria-hidden="true">◷</span>
        {onOpen ? <button type="button" className="tk-text tk-open" title={tip} onClick={() => onOpen(e)}>{body}</button>
          : <span className="tk-text" title={tip}>{body}</span>}
      </div>
    </li>
  )
}

/** Choose which project a Google meeting belongs to. "Automatic" = whatever project number is in its title. */
function EventLinkForm({ e, people, projects, link, auto, onDone, onCancel }: { e: GEv; people: Person[]; projects: Proj[]; link?: Link; auto?: Proj; onDone: () => void; onCancel: () => void }) {
  const [v, setV] = useState(link ? (link.project_id ?? 'none') : 'auto')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const who = people.find((p) => p.id === e.profile_id)
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault(); setBusy(true); setErr('')
    const { error } = v === 'auto'
      ? await supabase.from('calendar_event_projects').delete().eq('google_event_id', e.id)
      : await supabase.from('calendar_event_projects').upsert({ google_event_id: e.id, project_id: v === 'none' ? null : v, updated_at: new Date().toISOString() })
    setBusy(false)
    if (error) return setErr(/calendar_event_projects/.test(error.message) ? 'Linking meetings to projects isn’t switched on yet.' : error.message)
    onDone()
  }
  const when = e.all_day ? parseDate(e.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : new Date(e.start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <form onSubmit={save} className="tk-form">
      <p style={{ gridColumn: '1 / -1', margin: 0 }}><b>{e.title}</b> <span className="muted">· {firstName(who)} · {when} · Google Calendar</span></p>
      <div style={{ gridColumn: '1 / -1' }}><label className="l" htmlFor="ge-p">Project</label>
        <select id="ge-p" className="input" value={v} onChange={(x) => setV(x.target.value)} autoFocus>
          <option value="auto">Automatic{auto ? ` (found ${auto.number} in the title)` : ' (no project number in the title)'}</option>
          <option value="none">No project</option>
          {projects.filter((p) => p.number !== 'OH').map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}
        </select></div>
      {err && <p className="err" role="alert" style={{ gridColumn: '1 / -1', margin: 0 }}>{err}</p>}
      <div className="row" style={{ gridColumn: '1 / -1', gap: 8 }}>
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button></div>
    </form>
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

/** Add a task (admins choose anyone; staff add for themselves), or edit one when `edit` is given. */
export function AddTask({ me, admin, people, projects, day, edit, onDone, onCancel }: { me: string; admin: boolean; people: Person[]; projects: Proj[]; day: string; edit?: Task; onDone: (msg: string) => void; onCancel: () => void }) {
  const [f, setF] = useState(edit
    ? { title: edit.title, due_on: edit.due_on, due_time: edit.due_time?.slice(0, 5) ?? '', assignee: edit.assignee, project_id: edit.project_id ?? '', notes: edit.notes ?? '' }
    : { title: '', due_on: day, due_time: '', assignee: me, project_id: '', notes: '' })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.title.trim()) return setErr('Give the task a title.')
    if (!f.due_on) return setErr('Choose a date.')
    setBusy(true); setErr('')
    const row = { title: f.title.trim(), due_on: f.due_on, due_time: f.due_time || null, assignee: f.assignee, project_id: f.project_id || null, notes: f.notes.trim() || null }
    const who = people.find((p) => p.id === f.assignee)
    if (edit) {
      const moved = edit.assignee !== f.assignee
      if (moved) await syncTask(edit.id, 'delete') // remove it from the old person's Google Tasks first
      const { error } = await supabase.from('tasks').update(moved ? { ...row, google_task_id: null, google_synced_at: null } : row).eq('id', edit.id)
      setBusy(false)
      if (error) return setErr(error.message)
      syncTask(edit.id, 'upsert')
      return onDone(moved ? `Task moved to ${firstName(who)}.` : 'Task saved.')
    }
    const { data, error } = await supabase.from('tasks').insert({ ...row, created_by: me }).select('id').single()
    setBusy(false)
    if (error) return setErr(error.message)
    syncTask((data as { id: string }).id, 'upsert')
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
          {(admin ? people : people.filter((p) => p.id === f.assignee)).map((p) => <option key={p.id} value={p.id}>{p.id === me ? `Me (${nameOf(p)})` : nameOf(p)}</option>)}
        </select></div>
      <div><label className="l" htmlFor="tk-p">Project (optional)</label>
        <select id="tk-p" className="input" value={f.project_id} onChange={set('project_id')}>
          <option value="">—</option>{projects.filter((p) => p.number !== 'OH').map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</select></div>
      <div style={{ gridColumn: '1 / -1' }}><label className="l" htmlFor="tk-n">Notes (optional)</label><textarea id="tk-n" className="input" rows={2} value={f.notes} onChange={set('notes')} /></div>
      {err && <p className="err" role="alert" style={{ gridColumn: '1 / -1', margin: 0 }}>{err}</p>}
      <div className="row" style={{ gridColumn: '1 / -1', gap: 8 }}>
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : edit ? 'Save task' : 'Add task'}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button></div>
    </form>
  )
}

/** Home: month calendar of everyone's tasks, Google meetings (and older events), shown as "Name: item", filterable by person.
 *  Admins can assign to anyone; staff add their own. Check a task off and it stays, crossed out. */
export function MonthCalendar({ me, admin, people, projects }: { me: string; admin: boolean; people: Person[]; projects: Proj[] }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [who, setWho] = useState<string>('all')
  const [adding, setAdding] = useState<string | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [linking, setLinking] = useState<GEv | null>(null)
  const [msg, setMsg] = useState('')
  const panel = (k: 'add' | 'edit' | 'link' | null, v?: unknown) => {
    setAdding(k === 'add' ? (v as string) : null); setEditing(k === 'edit' ? (v as Task) : null); setLinking(k === 'link' ? (v as GEv) : null); setMsg('')
  }
  const start = mondayOf(month)
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(start, i)), [start.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const from = isoDate(cells[0]), to = isoDate(cells[41])
  const tasks = useTasks(from, to)
  const evs = useLoad(async () => must(await supabase.from('calendar_events').select(EV_SELECT).lte('starts_on', to).gte('ends_on', from)) as unknown as Ev[], [from, to])
  // bills due (admins only; bills include salaries)
  const bills = useLoad(async () => admin ? must(await supabase.from('company_bills').select('id, name, amount, due_on, paid_on').gte('due_on', from).lte('due_on', to)) as BillRow[] : [], [admin, from, to])
  const [showBills, setShowBills] = useState(true)
  // Google Calendar meetings for everyone who connected Google (empty until Google is set up)
  const feed = useLoad(async () => {
    const { data, error } = await supabase.functions.invoke('calendar-feed', { body: { from, to } })
    return (error || !data?.events ? { events: [], me_connected: false } : data) as { events: GEv[]; me_connected: boolean }
  }, [from, to])
  const links = useLoad(async () => {
    const { data, error } = await supabase.from('calendar_event_projects').select('google_event_id, project_id')
    return (error ? [] : data) as Link[] // table not there yet → automatic matching only
  }, [])
  const linkOf = (id: string) => (links.data ?? []).find((l) => l.google_event_id === id)
  const autoProj = (e: GEv) => e.busy_only ? undefined : matchProject(`${e.title} ${e.location ?? ''} ${e.hint}`, projects)
  const projOf = (e: GEv) => { const l = linkOf(e.id); return l ? projects.find((p) => p.id === l.project_id) : autoProj(e) }
  const gByDay = useMemo(() => {
    const m = new Map<string, GEv[]>()
    for (const e of feed.data?.events ?? []) for (const k of eventDays(e)) m.set(k, [...(m.get(k) ?? []), e])
    for (const l of m.values()) l.sort((a, b) => (a.all_day === b.all_day ? a.start.localeCompare(b.start) : a.all_day ? -1 : 1))
    return m
  }, [feed.data])
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
          <button className="btn small" onClick={() => panel(adding || editing || linking ? null : 'add', today)}>{adding || editing || linking ? 'Close' : admin ? '+ Assign task' : '+ Task'}</button>
        </div>
      </div>
      <div className="row" role="group" aria-label="Show tasks for" style={{ gap: 6 }}>
        <button type="button" className={'btn small' + (who === 'all' ? '' : ' secondary')} aria-pressed={who === 'all'} onClick={() => setWho('all')}>Everyone</button>
        {order.map((p) => <button key={p.id} type="button" className={'btn small' + (who === p.id ? '' : ' secondary')} aria-pressed={who === p.id} onClick={() => setWho(p.id)}>{p.id === me ? 'Me' : firstName(p)}</button>)}
        {admin && <label className="row" style={{ gap: 6, marginLeft: 'auto', fontSize: 14 }}><input type="checkbox" checked={showBills} onChange={(e) => setShowBills(e.target.checked)} style={{ width: 16, height: 16 }} /> Show bills</label>}
      </div>
      {feed.data && !feed.data.me_connected && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Your Google Calendar meetings can show here: <a href="#/account">connect Google on My account</a>.</p>}
      {adding && <AddTask me={me} admin={admin} people={people} projects={projects} day={adding} onCancel={() => panel(null)} onDone={(m) => { panel(null); setMsg(m); tasks.reload() }} />}
      {editing && <AddTask key={editing.id} me={me} admin={admin} people={people} projects={projects} day={editing.due_on} edit={editing} onCancel={() => panel(null)} onDone={(m) => { panel(null); setMsg(m); tasks.reload() }} />}
      {linking && <EventLinkForm key={linking.id} e={linking} people={people} projects={projects} link={linkOf(linking.id)} auto={autoProj(linking)} onCancel={() => panel(null)} onDone={() => { panel(null); setMsg('Meeting linked.'); links.reload() }} />}
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
                <button type="button" className="mc-add" onClick={() => panel('add', k)} aria-label={`Add a task on ${d.toDateString()}`}>+</button>
              </div>
              <ul className="tk-list">
                {showBills && (bills.data ?? []).filter((b) => b.due_on === k).map((b) => <BillItem key={b.id} b={b} onChange={bills.reload} />)}
                {(gByDay.get(k) ?? []).filter((e) => show(e.profile_id)).map((e) => <GEventItem key={e.id + e.profile_id} e={e} people={people} project={projOf(e)} onOpen={e.busy_only ? undefined : (x) => panel('link', x)} />)}
                {dayEvs.map((e) => <EventItem key={e.id} e={e} me={me} admin={admin} people={people} onChange={reload} />)}
                {dayTasks.map((t) => <TaskItem key={t.id} t={t} me={me} admin={admin} people={people} prefixName onChange={reload} onEdit={(x) => panel('edit', x)} />)}
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

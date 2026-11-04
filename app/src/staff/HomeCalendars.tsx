import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase, SECTOR_COLOR, money } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { isoDate, parseDate } from './workload'

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
/** One Google Calendar event as the calendar-feed function returns it (one copy per connected calendar it's on). */
type GEv = { id: string; uid: string; profile_id: string; title: string; start: string; end: string; all_day: boolean; location: string | null; busy_only: boolean
  guests: string[]; organizer: string | null; auto_project_id: string | null; can_edit: boolean; description?: string; link: string | null }
/** The same meeting merged across everyone's calendars: shown once, with everyone in it. */
type GM = GEv & { key: string; people: string[] }
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
export function TaskItem({ t, me, admin, people, showWho, prefixName, onChange, onEdit }: { t: Task; me: string; admin: boolean; people: Person[]; showWho?: boolean; prefixName?: boolean; onChange: () => void; onEdit?: (t: Task, el: HTMLElement) => void }) {
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
            ? <button type="button" className="tk-text tk-open" title={t.notes ? `${t.notes}\n\nClick to edit` : 'Click to edit'} onClick={(ev) => { ev.stopPropagation(); onEdit(t, ev.currentTarget) }}>{body}</button>
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


const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'
const names = (ids: string[], people: Person[], _me?: string) => ids.map((id) => firstName(people.find((p) => p.id === id))).join(', ') // "Joshua, Micah" (same as tasks)
function whenText(e: GEv) {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }
  if (e.all_day) {
    const s = parseDate(e.start), last = addDays(parseDate(e.end), -1)
    return isoDate(s) === isoDate(last) ? `${s.toLocaleDateString('en-US', opts)} · All day` : `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · All day`
  }
  const s = new Date(e.start), en = new Date(e.end)
  const t = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '')
  return `${s.toLocaleDateString('en-US', opts)} · ${t(s)} – ${t(en)}`
}
/** Read a Supabase function error's message ({ error, code } JSON). */
async function fnError(error: unknown, fallback: string) {
  try { const j = await (error as { context?: Response }).context?.json(); return { msg: String(j?.error || fallback), code: String(j?.code || '') } } catch { return { msg: fallback, code: '' } }
}

/** A Google Calendar meeting on the month grid. Click it for details (like Google Calendar). */
function GEventItem({ e, people, me, project, onOpen }: { e: GM; people: Person[]; me: string; project?: Proj; onOpen: (e: GM, el: HTMLElement) => void }) {
  const body = <>
    {!e.all_day && <span className="num tk-time">{time12(hhmm(e.start))} </span>}
    <span className="tk-title"><span className="tk-who">{names(e.people, people, me)}: </span>{e.title}</span>
    <ProjTag p={project} />
  </>
  return (
    <li className={'tk tk-g' + (e.all_day ? ' allday' : '')} style={{ borderLeftColor: project ? sectorColor(project.sector) : '#9aa4b2' }}>
      <div className="tk-main">
        <span className="tk-gicon" aria-hidden="true">◷</span>
        <button type="button" className="tk-text tk-open" title={[e.title, e.location].filter(Boolean).join('\n')} onClick={(ev) => { ev.stopPropagation(); onOpen(e, ev.currentTarget) }}>{body}</button>
      </div>
    </li>
  )
}

/** A floating card next to what was clicked, like Google Calendar's quick view. Esc or a click outside closes it. */
function Pop({ anchor, label, onClose, children }: { anchor: DOMRect; label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const W = el.offsetWidth, H = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight
    let left = anchor.right + 8
    if (left + W > vw - 8) left = anchor.left - W - 8
    if (left < 8) left = Math.max(8, Math.min(vw - W - 8, anchor.left))
    const top = Math.max(8, Math.min(anchor.top, vh - H - 8))
    if (!pos || pos.left !== left || pos.top !== top) setPos({ left, top })
  })
  const close = useRef(onClose); close.current = onClose
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    const down = (e: MouseEvent) => { const t = e.target as Node; if (t.isConnected && ref.current && !ref.current.contains(t)) close.current() }
    document.addEventListener('keydown', key); document.addEventListener('mousedown', down)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', down) }
  }, [])
  return createPortal(
    <div ref={ref} className="qp" role="dialog" aria-label={label} style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}>
      <button type="button" className="qp-x" onClick={onClose} aria-label="Close">×</button>
      {children}
    </div>, document.body)
}

const nextHour = () => { const d = new Date(); return `${String(Math.min(23, d.getHours() + 1)).padStart(2, '0')}:00` }
const plusHour = (t: string) => { const [h, m] = t.split(':').map(Number); return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}` }
const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const fromMinutes = (n: number) => { const x = ((n % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}` }

/** Google-style quick create: a title, Event / Task tabs, then the few fields each needs. Also edits an event. */
function QuickCreate({ me, admin, people, projects, day, connected, edit, linkProject, onDone, onCancel }: {
  me: string; admin: boolean; people: Person[]; projects: Proj[]; day: string; connected: boolean; edit?: GM; linkProject?: string | null
  onDone: (msg: string, kind: 'event' | 'task') => void; onCancel: () => void }) {
  const today = isoDate(new Date())
  const st = edit && !edit.all_day ? hhmm(edit.start) : day === today ? nextHour() : '09:00'
  const [f, setF] = useState(() => ({
    kind: (edit ? 'event' : connected ? 'event' : 'task') as 'event' | 'task',
    title: edit?.title ?? '', date: edit ? (edit.all_day ? edit.start : isoDate(new Date(edit.start))) : day,
    end_date: edit ? (edit.all_day ? isoDate(addDays(parseDate(edit.end), -1)) : isoDate(new Date(edit.end))) : day,
    all_day: edit?.all_day ?? false, start_time: st, end_time: edit && !edit.all_day ? hhmm(edit.end) : plusHour(st),
    task_time: '', assignee: me, guests: edit ? edit.guests.filter((g) => g !== me) : [] as string[],
    location: edit?.location ?? '', project_id: edit ? (linkProject ?? edit.auto_project_id ?? '') : '', notes: edit?.description ?? '',
  }))
  const [err, setErr] = useState<{ msg: string; code: string } | null>(null); const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }))
  const setStart = (v: string) => setF((o) => ({ ...o, start_time: v, end_time: v && o.start_time && o.end_time ? fromMinutes(minutes(o.end_time) + minutes(v) - minutes(o.start_time)) : o.end_time })) // keeps the length, like Google
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    if (!f.title.trim()) return setErr({ msg: 'Add a title.', code: '' })
    setBusy(true)
    if (f.kind === 'event') {
      const { data, error } = await supabase.functions.invoke('calendar-event', { body: {
        op: edit ? 'update' : 'create', id: edit?.id, title: f.title, all_day: f.all_day, date: f.date, end_date: f.all_day ? f.end_date : f.date,
        start_time: f.start_time, end_time: f.end_time, time_zone: tz(), location: f.location, description: f.notes, guests: f.guests, project_id: f.project_id || null } })
      setBusy(false)
      if (error || !data?.ok) return setErr(await fnError(error, 'Couldn’t save the event to Google Calendar.'))
      return onDone(edit ? 'Event updated.' : f.guests.length ? `Event added. ${names(f.guests, people, me)} ${f.guests.length > 1 ? 'were' : 'was'} invited.` : 'Event added to your Google Calendar.', 'event')
    }
    const { data, error } = await supabase.from('tasks').insert({ title: f.title.trim(), due_on: f.date, due_time: f.task_time || null, assignee: f.assignee,
      project_id: f.project_id || null, notes: f.notes.trim() || null, created_by: me }).select('id').single()
    setBusy(false)
    if (error) return setErr({ msg: error.message, code: '' })
    syncTask((data as { id: string }).id, 'upsert')
    onDone(f.assignee === me ? 'Task added.' : `Task added for ${firstName(people.find((p) => p.id === f.assignee))}.`, 'task')
  }
  const others = people.filter((p) => p.id !== me)
  return (
    <form onSubmit={save} className="qp-form">
      <input className="qp-title" aria-label="Title" placeholder="Add title" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} />
      {!edit && <div className="qp-tabs" role="tablist" aria-label="Type">
        {(['event', 'task'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={f.kind === k} className={'qp-tab' + (f.kind === k ? ' on' : '')} onClick={() => { set('kind', k); setErr(null) }}>{k === 'event' ? 'Event' : 'Task'}</button>)}
      </div>}
      {f.kind === 'event' ? <>
        {!connected && <p className="qp-note">Events are saved in your Google Calendar. <a href="#/account">Connect Google on My account</a> first.</p>}
        <div className="qp-row">
          <input type="date" className="input" aria-label="Date" value={f.date} onChange={(e) => setF((o) => ({ ...o, date: e.target.value, end_date: o.end_date < e.target.value ? e.target.value : o.end_date }))} required />
          {f.all_day && <><span className="qp-dash">–</span><input type="date" className="input" aria-label="End date" value={f.end_date} min={f.date} onChange={(e) => set('end_date', e.target.value)} /></>}
        </div>
        {!f.all_day && <div className="qp-row qp-times">
          <input type="time" className="input" aria-label="Start time" value={f.start_time} onChange={(e) => setStart(e.target.value)} required step={300} />
          <span className="qp-dash">–</span><input type="time" className="input" aria-label="End time" value={f.end_time} onChange={(e) => set('end_time', e.target.value)} required step={300} />
        </div>}
        <label className="qp-check"><input type="checkbox" checked={f.all_day} onChange={(e) => set('all_day', e.target.checked)} /> All day</label>
        {others.length > 0 && <fieldset className="qp-guests"><legend className="l">Invite</legend>
          {others.map((p) => <label key={p.id} className={'qp-chip' + (f.guests.includes(p.id) ? ' on' : '')}><input type="checkbox" checked={f.guests.includes(p.id)}
            onChange={(e) => set('guests', e.target.checked ? [...f.guests, p.id] : f.guests.filter((g) => g !== p.id))} />{firstName(p)}</label>)}
        </fieldset>}
        <input className="input" aria-label="Location" placeholder="Add location" value={f.location} onChange={(e) => set('location', e.target.value)} />
      </> : <>
        <div className="qp-row">
          <input type="date" className="input" aria-label="Date" value={f.date} onChange={(e) => set('date', e.target.value)} required />
          <input type="time" className="input" aria-label="Time (optional)" title="Time (optional)" value={f.task_time} onChange={(e) => set('task_time', e.target.value)} step={300} />
        </div>
        <label className="qp-lab">Assign to
          <select className="input" value={f.assignee} onChange={(e) => set('assignee', e.target.value)} disabled={!admin}>
            {(admin ? people : people.filter((p) => p.id === me)).map((p) => <option key={p.id} value={p.id}>{p.id === me ? `Me (${nameOf(p)})` : nameOf(p)}</option>)}
          </select></label>
      </>}
      <select className="input" aria-label="Project" value={f.project_id} onChange={(e) => set('project_id', e.target.value)}>
        <option value="">No project</option>
        {projects.filter((p) => p.number !== 'OH').map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}
      </select>
      <textarea className="input" rows={2} aria-label="Description" placeholder="Add description" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err.msg}{err.code === 'reconnect' || err.code === 'not_connected' ? <> <a href="#/account">Open My account</a></> : null}</p>}
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn secondary small" onClick={onCancel}>Cancel</button>
        <button className="btn small" disabled={busy || (f.kind === 'event' && !connected)}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}

/** Google-style details card for a meeting: when, where, who, its project; edit/delete for the organizer. */
function EventView({ e, me, people, projects, project, link, onEdit, onChanged, onClose }: { e: GM; me: string; people: Person[]; projects: Proj[]; project?: Proj
  link?: Link; onEdit: () => void; onChanged: (msg: string, what: 'link' | 'event') => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const auto = projects.find((p) => p.id === e.auto_project_id)
  const [v, setV] = useState(link ? (link.project_id ?? 'none') : 'auto')
  const saveLink = async (val: string) => {
    setV(val); setErr('')
    const { error } = val === 'auto' ? await supabase.from('calendar_event_projects').delete().eq('google_event_id', e.id)
      : await supabase.from('calendar_event_projects').upsert({ google_event_id: e.id, project_id: val === 'none' ? null : val, updated_at: new Date().toISOString() })
    if (error) setErr(error.message); else onChanged('Project saved.', 'link')
  }
  const remove = async () => {
    if (!window.confirm(`Delete “${e.title}”? ${e.guests.some((g) => g !== me) ? 'Guests will get a cancellation from Google.' : ''}`)) return
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('calendar-event', { body: { op: 'delete', id: e.id } })
    setBusy(false)
    if (error || !data?.ok) return setErr((await fnError(error, 'Couldn’t delete the event.')).msg)
    onChanged('Event deleted.', 'event'); onClose()
  }
  const organizer = e.organizer ?? (e.can_edit ? me : null)
  return (
    <div className="qp-view">
      <h3 className="qp-h"><span className="qp-swatch" style={{ background: project ? sectorColor(project.sector) : '#9aa4b2' }} />{e.title}</h3>
      <p className="qp-line">{whenText(e)}</p>
      {e.location && <p className="qp-line">⌖ {e.location}</p>}
      <p className="qp-line">👥 {names(e.people, people, me)}{organizer && e.people.length > 1 ? ` · organized by ${organizer === me ? 'you' : firstName(people.find((p) => p.id === organizer))}` : ''}</p>
      {!e.busy_only && <label className="qp-lab">Project
        <select className="input" value={v} onChange={(x) => saveLink(x.target.value)}>
          <option value="auto">Automatic{auto ? ` (${auto.number})` : ' (none found)'}</option>
          <option value="none">No project</option>
          {projects.filter((p) => p.number !== 'OH').map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}
        </select></label>}
      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {e.link && <a className="btn secondary small" href={e.link} target="_blank" rel="noreferrer">Open in Google</a>}
        {e.can_edit && <button type="button" className="btn secondary small" onClick={remove} disabled={busy}>Delete</button>}
        {e.can_edit && <button type="button" className="btn small" onClick={onEdit}>Edit</button>}
      </div>
    </div>
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

/** Merge copies of the same meeting from different people's calendars into one item listing everyone in it. */
function mergeEvents(list: GEv[], me: string): GM[] {
  const m = new Map<string, GM>()
  for (const e of list) {
    const key = `${e.uid}|${e.start}`
    const prev = m.get(key)
    const people = [...new Set([...(prev?.people ?? []), e.profile_id, ...e.guests, ...(e.organizer ? [e.organizer] : [])])]
    const base = !prev || e.can_edit || (e.profile_id === me && !prev.can_edit) ? e : prev // prefer my editable copy
    m.set(key, { ...base, key, people, guests: [...new Set([...(prev?.guests ?? []), ...e.guests])] })
  }
  return [...m.values()]
}

type Open = { kind: 'new'; day: string } | { kind: 'task'; task: Task } | { kind: 'event'; ev: GM } | { kind: 'edit'; ev: GM }

/** Home: month calendar of everyone's tasks and Google meetings, shown as "Name: item", filterable by person.
 *  Works like Google Calendar: click an empty spot on a day to add an event or a task; click an item for details. */
export function MonthCalendar({ me, admin, people, projects }: { me: string; admin: boolean; people: Person[]; projects: Proj[] }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [who, setWho] = useState<string>('all')
  const [open, setOpen] = useState<(Open & { anchor: DOMRect }) | null>(null)
  const [msg, setMsg] = useState('')
  const pop = (o: Open, el: HTMLElement) => { setOpen({ ...o, anchor: el.getBoundingClientRect() }); setMsg('') }
  const start = addDays(month, -month.getDay()) // Sunday on or before the 1st
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(start, i)), [start.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const from = isoDate(cells[0]), to = isoDate(cells[41])
  const tasks = useTasks(from, to)
  const evs = useLoad(async () => must(await supabase.from('calendar_events').select(EV_SELECT).lte('starts_on', to).gte('ends_on', from)) as unknown as Ev[], [from, to])
  // bills due (admins only; bills include salaries)
  const bills = useLoad(async () => admin ? must(await supabase.from('company_bills').select('id, name, amount, due_on, paid_on').gte('due_on', from).lte('due_on', to)) as BillRow[] : [], [admin, from, to])
  const [showBills, setShowBills] = useState(true)
  // Google Calendar meetings for everyone who connected Google
  const feed = useLoad(async () => {
    const { data, error } = await supabase.functions.invoke('calendar-feed', { body: { from, to } })
    return (error || !data?.events ? { events: [], me_connected: false } : data) as { events: GEv[]; me_connected: boolean }
  }, [from, to])
  const links = useLoad(async () => {
    const { data, error } = await supabase.from('calendar_event_projects').select('google_event_id, project_id')
    return (error ? [] : data) as Link[]
  }, [])
  const linkOf = (id: string) => (links.data ?? []).find((l) => l.google_event_id === id)
  const projOf = (e: GEv) => { const l = linkOf(e.id); return projects.find((p) => p.id === (l ? l.project_id : e.auto_project_id)) }
  const connected = !!feed.data?.me_connected
  const gByDay = useMemo(() => {
    const m = new Map<string, GM[]>()
    for (const e of mergeEvents(feed.data?.events ?? [], me)) for (const k of eventDays(e)) m.set(k, [...(m.get(k) ?? []), e])
    for (const l of m.values()) l.sort((a, b) => (a.all_day === b.all_day ? a.start.localeCompare(b.start) : a.all_day ? -1 : 1))
    return m
  }, [feed.data, me])
  const reload = () => { tasks.reload(); evs.reload(); bills.reload() }
  const today = isoDate(new Date())
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const rows = Math.ceil((Math.round((last.getTime() - start.getTime()) / 86400000) + 1) / 7) // weeks this month touches
  const show = (pid: string) => who === 'all' || pid === who
  const order = [...people].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : nameOf(a).localeCompare(nameOf(b))))
  const rank = (pid: string) => order.findIndex((p) => p.id === pid)
  const done = (m: string, what: 'event' | 'task' | 'link') => { setOpen(null); setMsg(m); if (what === 'task') tasks.reload(); else if (what === 'event') { feed.reload(); links.reload() } else links.reload() }
  const close = () => setOpen(null)
  return (
    <section className="card pad stack" aria-labelledby="mc-h">
      <div className="row between">
        <h2 id="mc-h">{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
        <div className="row">
          <button className="btn small secondary" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
          <button className="btn small secondary" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)) }}>Today</button>
          <button className="btn small secondary" aria-label="Next month" onClick={() => shift(1)}>›</button>
          <button className="btn small" onClick={(e) => pop({ kind: 'new', day: today }, e.currentTarget)}>+ Create</button>
        </div>
      </div>
      <div className="row" role="group" aria-label="Show calendar for" style={{ gap: 6 }}>
        <button type="button" className={'btn small' + (who === 'all' ? '' : ' secondary')} aria-pressed={who === 'all'} onClick={() => setWho('all')}>Everyone</button>
        {order.map((p) => <button key={p.id} type="button" className={'btn small' + (who === p.id ? '' : ' secondary')} aria-pressed={who === p.id} onClick={() => setWho(p.id)}>{p.id === me ? 'Me' : firstName(p)}</button>)}
        {admin && <label className="row" style={{ gap: 6, marginLeft: 'auto', fontSize: 14 }}><input type="checkbox" checked={showBills} onChange={(e) => setShowBills(e.target.checked)} style={{ width: 16, height: 16 }} /> Show bills</label>}
      </div>
      {feed.data && !connected && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Your Google Calendar meetings can show here, and events you add go to your Google Calendar: <a href="#/account">connect Google on My account</a>.</p>}
      {msg && <p className="ok" role="status" style={{ margin: 0 }}>{msg}</p>}
      {(tasks.error || evs.error) && <p className="err">{tasks.error || evs.error}</p>}
      <div style={{ overflowX: 'auto' }}><div className="mc" style={{ minWidth: 760 }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="mc-h">{d}</div>)}
        {cells.slice(0, rows * 7).map((d) => {
          const k = isoDate(d); const out = d.getMonth() !== month.getMonth()
          const dayTasks = (tasks.data ?? []).filter((t) => t.due_on === k && show(t.assignee)).sort((a, b) => rank(a.assignee) - rank(b.assignee))
          const dayEvs = (evs.data ?? []).filter((e) => e.starts_on <= k && e.ends_on >= k && show(e.profile_id))
          return (
            // clicking empty space in a day opens quick-create for that day (the + button does the same, for keyboards)
            <div key={k} className={'mc-cell' + (out ? ' out' : '') + (k === today ? ' today' : '')}
              onClick={(e) => { if (!(e.target as HTMLElement).closest('.tk, .mc-add, button, input, a, label')) pop({ kind: 'new', day: k }, e.currentTarget) }}>
              <div className="row between" style={{ gap: 4 }}>
                <span className="mc-d">{d.getDate()}</span>
                <button type="button" className="mc-add" onClick={(e) => pop({ kind: 'new', day: k }, e.currentTarget.closest('.mc-cell') as HTMLElement)} aria-label={`Add an event or task on ${d.toDateString()}`}>+</button>
              </div>
              <ul className="tk-list">
                {showBills && (bills.data ?? []).filter((b) => b.due_on === k).map((b) => <BillItem key={b.id} b={b} onChange={bills.reload} />)}
                {(gByDay.get(k) ?? []).filter((e) => who === 'all' || e.people.includes(who)).map((e) => <GEventItem key={e.key} e={e} me={me} people={people} project={projOf(e)} onOpen={(x, el) => pop({ kind: 'event', ev: x }, el)} />)}
                {dayEvs.map((e) => <EventItem key={e.id} e={e} me={me} admin={admin} people={people} onChange={reload} />)}
                {dayTasks.map((t) => <TaskItem key={t.id} t={t} me={me} admin={admin} people={people} prefixName onChange={reload} onEdit={(x, el) => pop({ kind: 'task', task: x }, el)} />)}
              </ul>
            </div>)
        })}
      </div></div>
      {open && <Pop key={open.kind + ('ev' in open ? open.ev.key : 'task' in open ? open.task.id : open.day)} anchor={open.anchor} onClose={close}
        label={open.kind === 'new' ? 'Create' : open.kind === 'task' ? 'Edit task' : open.kind === 'edit' ? 'Edit event' : 'Event details'}>
        {open.kind === 'new' && <QuickCreate me={me} admin={admin} people={people} projects={projects} day={open.day} connected={connected} onCancel={close} onDone={done} />}
        {open.kind === 'edit' && <QuickCreate me={me} admin={admin} people={people} projects={projects} day={open.ev.start.slice(0, 10)} connected={connected} edit={open.ev}
          linkProject={linkOf(open.ev.id) ? linkOf(open.ev.id)!.project_id : undefined} onCancel={close} onDone={done} />}
        {open.kind === 'event' && <EventView e={open.ev} me={me} people={people} projects={projects} project={projOf(open.ev)} link={linkOf(open.ev.id)}
          onEdit={() => setOpen({ ...open, kind: 'edit' })} onChanged={(m, w) => { setMsg(m); if (w === 'event') { feed.reload(); links.reload() } else links.reload() }} onClose={close} />}
        {open.kind === 'task' && <div className="qp-form"><AddTask me={me} admin={admin} people={people} projects={projects} day={open.task.due_on} edit={open.task} onCancel={close} onDone={(m) => done(m, 'task')} /></div>}
      </Pop>}
    </section>
  )
}

/** Staff week view: my tasks for a given day (used inside the existing week calendar). */
export function dayTasks(tasks: Task[] | null, day: Date) { const k = isoDate(day); return (tasks ?? []).filter((t) => t.due_on === k) }
export { parseDate }

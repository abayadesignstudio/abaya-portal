import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase, SECTOR_COLOR, money, phaseLabel } from '../lib/supabase'
import { sortPhases } from '../lib/projectContent'
import { useLoad, must } from '../lib/useQuery'
import { isoDate, parseDate } from './workload'
import Avatar from '../components/Avatar'
import MarkIcon, { type MarkKind } from '../components/MarkIcon'
import RowMenu from '../components/RowMenu'

// Tasks and shared schedules on the home page.
//  - Tasks: one person each; checking one off crosses it out (it stays on the calendar, like Google Calendar).
//    Click a task's text to edit it (title, date, time, person, project, notes).
//  - Admins can assign tasks to anyone; staff assign only to themselves.
//  - Google meetings: each connected person's Google Calendar (via the calendar-feed function), titles visible to all
//    staff. A meeting is tied to a project when its title/description has a project number, or when someone links one.
// Every change is passed to the task-sync function, which mirrors it into the assignee's Google Tasks when they've
// connected Google (My account). If sync isn't set up, the portal works the same and nothing is lost.

// Drag an item to another day on the calendar: only its date moves (time, length and details stay).
type DragItem = { kind: 'task' | 'ev' | 'g' | 'ms' | 'dl'; id: string; from: string }
const DRAG_MIME = 'application/x-abaya-cal'
const CanDrag = createContext(false)
function dragProps(on: boolean, d: DragItem) {
  if (!on) return {}
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent<HTMLElement>) => { e.dataTransfer.setData(DRAG_MIME, JSON.stringify(d)); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging') },
    onDragEnd: (e: React.DragEvent<HTMLElement>) => e.currentTarget.classList.remove('dragging'),
  }
}

export type Person = { id: string; full_name: string | null; email: string; initials: string | null; role: string; avatar_url?: string | null; color?: string | null }
export type Task = { id: string; title: string; notes: string | null; assignee: string; created_by: string | null; due_on: string; due_time: string | null; done_at: string | null
  project_id: string | null; projects: { number: string; name: string; sector: string | null } | null }
type Ev = { id: string; profile_id: string; project_id?: string | null; title: string; starts_on: string; ends_on: string; start_time: string | null; projects: { number: string; name: string; sector: string | null } | null }
export type Proj = { id: string; number: string; name: string; sector?: string | null }
/** One Google Calendar event as the calendar-feed function returns it (one copy per connected calendar it's on). */
type GEv = { id: string; uid: string; profile_id: string; title: string; start: string; end: string; all_day: boolean; location: string | null; busy_only: boolean
  guests: string[]; organizer: string | null; auto_project_id: string | null; can_edit: boolean; description?: string; link: string | null; personal?: string | null }
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

/** Project on a calendar item: colored number tag plus the project name, as the item's top line. */
function ProjTag({ p }: { p: { number: string; name: string; sector?: string | null } | null | undefined }) {
  if (!p) return null
  return <span className="tk-pline" title={`${p.number} · ${p.name}`}><span className="tk-proj" style={{ background: sectorColor(p.sector) }}>{p.number}</span><span className="tk-pname">{p.name}</span></span>
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

// One shared "something changed" signal, so the Today card and the calendar stay in step without reloading the page.
// 'tasks' = tasks/old events changed (cheap reload); 'events' = Google meetings or their project links changed.
const BUS = 'abaya:calendar-changed'
type Kind = 'tasks' | 'events'
export const calendarChanged = (kind: Kind) => window.dispatchEvent(new CustomEvent<Kind>(BUS, { detail: kind }))
function useCalendarChanges(on: (kind: Kind) => void) {
  const r = useRef(on); r.current = on
  useEffect(() => { const h = (e: Event) => r.current((e as CustomEvent<Kind>).detail); window.addEventListener(BUS, h); return () => window.removeEventListener(BUS, h) }, [])
}

export function useStaff() {
  return useLoad(async () => must(await supabase.from('profiles').select('id, full_name, email, initials, role, avatar_url, color').in('role', ['admin', 'staff']).order('full_name')) as Person[])
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
  const canDrag = useContext(CanDrag)
  const who = people.find((p) => p.id === t.assignee)
  const [open, setOpen] = useState(false)
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
    <li className={'tk' + (done ? ' done' : '')} style={{ borderLeftColor: colorOf(t.assignee, people) ?? (t.projects ? sectorColor(t.projects.sector) : '#9aa4b2') }} {...dragProps(canDrag && mine, { kind: 'task', id: t.id, from: t.due_on })}>
      <div className="tk-main">
        <button type="button" className="tk-ico" role="checkbox" aria-checked={done} disabled={!mine} onClick={(ev) => { ev.stopPropagation(); if (!busy) toggle() }} aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${t.title}`} title={done ? 'Done — click to undo' : 'Mark done'}>
          <Mark kind="task" done={done} color={t.projects ? sectorColor(t.projects.sector) : undefined} /></button>
        {(() => {
          const body = <>
            <ProjTag p={t.projects} />
            {t.due_time && <span className="num tk-time">{time12(t.due_time)} </span>}
            {prefixName && <Faces ids={[t.assignee]} people={people} />}<span className="tk-title">{t.title}</span>
            {showWho && <span className="tk-sub">{firstName(who)}</span>}
          </>
          return <button type="button" className="tk-text tk-open" aria-expanded={open} title={open ? 'Click to fold' : 'Click for details'} onClick={(ev) => { ev.stopPropagation(); setOpen(!open) }}>{body}{t.notes && !open && <span className="tk-hasnote" aria-label="has a note"> ¶</span>}</button>
        })()}
      </div>
      {mine && <span className="tk-x"><RowMenu label={`Actions for ${t.title}`} items={[{ label: 'Delete task', danger: true, disabled: busy, onSelect: remove }]} /></span>}
      {open && <Unrolled
        rows={[['Task', t.title], t.projects && ['Project', `${t.projects.number} · ${t.projects.name}`], ['Due', `${longDay(t.due_on)}${t.due_time ? ' · ' + time12(t.due_time) : ''}`], ['Assigned to', nameOf(who)], done && ['Status', 'Done']]}
        notes={t.notes}
        actions={mine && onEdit ? <button type="button" className="btn small secondary" onClick={(ev) => onEdit(t, ev.currentTarget.closest('.tk') as HTMLElement)}>Edit task</button> : undefined} />}
    </li>
  )
}


/** A calendar event (older "+ Add to calendar" items). Checking it turns it into a completed task, so it crosses out
 *  like any task. Only the person it belongs to, or an admin, can do that. */
export function EventItem({ e, me, admin, people, onChange }: { e: Ev; me: string; admin: boolean; people: Person[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false) // flips instantly; the item becomes a done task on reload
  const mine = e.profile_id === me || admin
  const canDrag = useContext(CanDrag)
  const [open, setOpen] = useState(false)
  const complete = async () => {
    setChecked(true); setBusy(true)
    const { data, error } = await supabase.from('tasks').insert({ title: e.title, assignee: e.profile_id, created_by: me, due_on: e.starts_on, due_time: e.start_time,
      project_id: e.project_id ?? null, done_at: new Date().toISOString() }).select('id').single()
    if (error) { setChecked(false); setBusy(false); return }
    await supabase.from('calendar_events').delete().eq('id', e.id); syncTask((data as { id: string }).id, 'upsert')
    setBusy(false); onChange()
  }
  return (
    <li className="tk" style={{ borderLeftColor: colorOf(e.profile_id, people) ?? (e.projects ? sectorColor(e.projects.sector) : '#9aa4b2') }} {...dragProps(canDrag && mine, { kind: 'ev', id: e.id, from: e.starts_on })}>
      <div className="tk-main">
        <button type="button" className="tk-ico" role="checkbox" aria-checked={checked} disabled={!mine} onClick={(ev) => { ev.stopPropagation(); if (!busy && !checked) complete() }} aria-label={`Mark done: ${e.title}`} title="Mark done">
          <Mark kind="event" done={checked} color={e.projects ? sectorColor(e.projects.sector) : undefined} /></button>
        <button type="button" className="tk-text tk-open" aria-expanded={open} title={open ? 'Click to fold' : 'Click for details'} onClick={(ev) => { ev.stopPropagation(); setOpen(!open) }}>
          <ProjTag p={e.projects} />
          {e.start_time && <span className="num tk-time">{time12(e.start_time)} </span>}
          <Faces ids={[e.profile_id]} people={people} /><span className="tk-title">{e.title}</span>
        </button>
      </div>
      {open && <Unrolled rows={[['Event', e.title], e.projects && ['Project', `${e.projects.number} · ${e.projects.name}`],
        ['When', `${longDay(e.starts_on)}${e.ends_on !== e.starts_on ? ' – ' + longDay(e.ends_on) : ''}${e.start_time ? ' · ' + time12(e.start_time) : ''}`],
        ['Who', nameOf(people.find((p) => p.id === e.profile_id))]]} />}
    </li>
  )
}


const longDay = (iso: string) => parseDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
/** The extra lines a calendar item shows once it's clicked open. */
function Unrolled({ rows, notes, actions }: { rows: ([string, React.ReactNode] | false | null | undefined | "")[]; notes?: string | null; actions?: React.ReactNode }) {
  return (
    <div className="tk-more-box" onClick={(e) => e.stopPropagation()}>
      <dl>{rows.filter(Boolean).map((r) => { const [k, v] = r as [string, React.ReactNode]; return <div key={k}><dt>{k}</dt><dd>{v}</dd></div> })}</dl>
      {notes ? <p className="tk-notes">{notes}</p> : null}
      {actions && <div className="tk-acts">{actions}</div>}
    </div>)
}

/** A timeline icon sized for calendar lines, coloured by the item's project. */
function Mark({ kind, done, color }: { kind: MarkKind; done: boolean; color?: string }) {
  const c = color ?? '#02253d'
  return <span className="tk-mark" style={{ ['--mc' as string]: `color-mix(in srgb, ${c} 85%, #000)`, ['--pin' as string]: done ? c : `color-mix(in srgb, ${c} 70%, #fff)` }}><MarkIcon kind={kind} done={done} size={16} /></span>
}

/** A milestone or deliverable from the Projects timeline. Its icon marks it reached/delivered; the title opens the project. */
export type ProjMark = { id: string; kind: 'milestone' | 'deliverable'; title: string; date: string; done: boolean; project_id: string; assignee: string | null
  projects: { number: string; name: string; sector: string | null } | null }
function ProjMarkItem({ m, people, onChange }: { m: ProjMark; people: Person[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [flip, setFlip] = useState<boolean | null>(null)
  const done = flip ?? m.done
  const late = !done && m.date < isoDate(new Date())
  const canDrag = useContext(CanDrag)
  const toggle = async () => {
    const next = !done; setFlip(next); setBusy(true)
    const r = m.kind === 'milestone'
      ? await supabase.from('milestones').update({ done: next }).eq('id', m.id)
      : await supabase.from('deliverables').update({ status: next ? 'done' : 'todo' }).eq('id', m.id)
    setBusy(false)
    if (r.error) { setFlip(null); return }
    onChange()
  }
  const word = m.kind === 'milestone' ? (done ? 'reached' : 'not reached') : (done ? 'delivered' : 'not delivered')
  const [open, setOpen] = useState(false)
  return (
    <li className={'tk tk-pm' + (done ? ' done' : '') + (late ? ' late' : '')} style={{ borderLeftColor: (m.kind === 'deliverable' ? colorOf(m.assignee, people) : null) ?? (m.projects ? sectorColor(m.projects.sector) : '#9aa4b2') }} {...dragProps(canDrag, { kind: m.kind === 'milestone' ? 'ms' : 'dl', id: m.id, from: m.date })}>
      <div className="tk-main">
        <button type="button" className="tk-ico" role="checkbox" aria-checked={done} disabled={busy} onClick={(ev) => { ev.stopPropagation(); toggle() }}
          aria-label={`${m.kind === 'milestone' ? 'Milestone' : 'Deliverable'} ${m.title}: ${word}. Click to change.`} title={m.kind === 'milestone' ? (done ? 'Reached — click to undo' : 'Mark reached') : (done ? 'Delivered — click to undo' : 'Mark delivered')}>
          <Mark kind={m.kind} done={done} color={late ? '#d92d20' : m.projects ? sectorColor(m.projects.sector) : undefined} /></button>
        <button type="button" className="tk-text tk-open" aria-expanded={open} title={open ? 'Click to fold' : 'Click for details'} onClick={(ev) => { ev.stopPropagation(); setOpen(!open) }}>
          <ProjTag p={m.projects} />
          {m.assignee && <Faces ids={[m.assignee]} people={people} />}<span className="tk-title">{m.title}</span>
        </button>
      </div>
      {open && <Unrolled rows={[[m.kind === 'milestone' ? 'Milestone' : 'Deliverable', m.title], m.projects && ['Project', `${m.projects.number} · ${m.projects.name}`],
        [m.kind === 'milestone' ? 'Date' : 'Due', longDay(m.date)], m.assignee && ['Assigned to', nameOf(people.find((p) => p.id === m.assignee))],
        ['Status', done ? (m.kind === 'milestone' ? 'Reached' : 'Delivered') : late ? 'Overdue' : 'Open']]}
        actions={<a className="btn small secondary" href={`#/projects/${m.project_id}`}>Open project</a>} />}
    </li>)
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'
/** The assignee's (or attendees') round profile pictures at the start of a calendar line; names stay readable to screen readers. */
function Faces({ ids, people }: { ids: string[]; people: Person[] }) {
  const list = ids.map((id) => people.find((p) => p.id === id)).filter(Boolean) as Person[]
  if (!list.length) return null
  const label = list.map((p) => firstName(p)).join(', ')
  return (
    <span className="tk-faces" title={label}>
      {list.slice(0, 3).map((p) => <Avatar key={p.id} url={p.avatar_url} name={p.full_name || p.email} initials={p.initials} size={18} />)}
      {list.length > 3 && <span className="tk-more">+{list.length - 3}</span>}
      <span className="sr">{label}: </span>
    </span>)
}
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
/** A person's own color (Settings → People) marks events they organize or that sit on their calendar. */
const colorOf = (id: string | null | undefined, people: Person[]) => (id ? people.find((p) => p.id === id)?.color : null) ?? null
const ownerColor = (e: GEv, people: Person[]) => colorOf(e.organizer ?? e.profile_id, people)
function GEventItem({ e, people, project, onOpen }: { e: GM; people: Person[]; me: string; project?: Proj; onOpen: (e: GM, el: HTMLElement) => void }) {
  const [open, setOpen] = useState(false)
  const canDrag = useContext(CanDrag)
  const body = <>
    <ProjTag p={project} />
    {!e.all_day && <span className="num tk-time">{time12(hhmm(e.start))} </span>}
    <Faces ids={e.people} people={people} /><span className="tk-title">{e.title}</span>{e.personal && <span className="tk-personal" title="From your personal calendar">{e.personal}</span>}
  </>
  return (
    <li className={'tk tk-g' + (e.all_day ? ' allday' : '') + (e.personal ? ' tk-pers' : '')} style={{ borderLeftColor: ownerColor(e, people) ?? (project ? sectorColor(project.sector) : '#9aa4b2') }}
      {...dragProps(canDrag && e.can_edit, { kind: 'g', id: e.id, from: e.all_day ? e.start.slice(0, 10) : isoDate(new Date(e.start)) })}>
      <div className="tk-main">
        <span className="tk-ico tk-ico-static" aria-hidden="true"><Mark kind="event" done={false} color={project ? sectorColor(project.sector) : undefined} /></span>
        <button type="button" className="tk-text tk-open" aria-expanded={open} title={open ? 'Click to fold' : 'Click for details'} onClick={(ev) => { ev.stopPropagation(); setOpen(!open) }}>{body}</button>
      </div>
      {open && <Unrolled rows={[['When', whenText(e)], project && ['Project', `${project.number} · ${project.name}`], e.location && ['Where', e.location], ['Who', names(e.people, people)]]}
        notes={e.description ? e.description.replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').trim() : null}
        actions={<><button type="button" className="btn small secondary" onClick={(ev) => onOpen(e, ev.currentTarget.closest('.tk') as HTMLElement)}>Details &amp; edit</button>
          {e.link && <a className="btn small secondary" href={e.link} target="_blank" rel="noreferrer">Open in Google</a>}</>} />}
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

/** Google-style quick create: a title, Event / Task / Milestone / Deliverable tabs, then the few fields each needs. Also edits an event.
 *  Milestones and deliverables belong to a project, so they also show on the project's gantt (Projects page and Home). */
function QuickCreate({ me, admin, people, projects, day, connected, edit, linkProject, onDone, onCancel }: {
  me: string; admin: boolean; people: Person[]; projects: Proj[]; day: string; connected: boolean; edit?: GM; linkProject?: string | null
  onDone: (msg: string, kind: 'event' | 'task' | 'milestone' | 'deliverable') => void; onCancel: () => void }) {
  const today = isoDate(new Date())
  const st = edit && !edit.all_day ? hhmm(edit.start) : day === today ? nextHour() : '09:00'
  const [f, setF] = useState(() => ({
    kind: (edit ? 'event' : connected ? 'event' : 'task') as 'event' | 'task' | 'milestone' | 'deliverable',
    phase_id: '', dl_assignee: '',
    title: edit?.title ?? '', date: edit ? (edit.all_day ? edit.start : isoDate(new Date(edit.start))) : day,
    end_date: edit ? (edit.all_day ? isoDate(addDays(parseDate(edit.end), -1)) : isoDate(new Date(edit.end))) : day,
    all_day: edit?.all_day ?? false, start_time: st, end_time: edit && !edit.all_day ? hhmm(edit.end) : plusHour(st),
    task_time: '', assignee: me, guests: edit ? edit.guests.filter((g) => g !== me) : [] as string[],
    location: edit?.location ?? '', project_id: edit ? (linkProject ?? edit.auto_project_id ?? '') : '', notes: edit?.description ?? '',
  }))
  const [err, setErr] = useState<{ msg: string; code: string } | null>(null); const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }))
  const setStart = (v: string) => setF((o) => ({ ...o, start_time: v, end_time: v && o.start_time && o.end_time ? fromMinutes(minutes(o.end_time) + minutes(v) - minutes(o.start_time)) : o.end_time })) // keeps the length, like Google
  const projectMark = f.kind === 'milestone' || f.kind === 'deliverable'
  const phases = useLoad(async () => f.project_id && projectMark
    ? must(await supabase.from('phases').select('id, code, sort, name, parent_phase_id').eq('project_id', f.project_id)) as { id: string; code: string; name: string | null; parent_phase_id: string | null }[]
    : [], [f.project_id, projectMark])
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    if (!f.title.trim()) return setErr({ msg: 'Add a title.', code: '' })
    if (projectMark) {
      if (!f.project_id) return setErr({ msg: `Choose the project this ${f.kind} belongs to.`, code: '' })
      setBusy(true)
      const { error } = f.kind === 'milestone'
        ? await supabase.from('milestones').insert({ project_id: f.project_id, phase_id: f.phase_id || null, title: f.title.trim(), date: f.date })
        : await supabase.from('deliverables').insert({ project_id: f.project_id, phase_id: f.phase_id || null, title: f.title.trim(), due_date: f.date, assignee: f.dl_assignee || null })
      setBusy(false)
      if (error) return setErr({ msg: error.message, code: '' })
      calendarChanged('tasks') // reloads the calendar and the project gantts
      return onDone(`${f.kind === 'milestone' ? 'Milestone' : 'Deliverable'} added to ${projects.find((p) => p.id === f.project_id)?.number ?? 'the project'}.`, f.kind)
    }
    setBusy(true)
    if (f.kind === 'event') {
      const { data, error } = await supabase.functions.invoke('calendar-event', { body: {
        op: edit ? 'update' : 'create', id: edit?.id, title: f.title, all_day: f.all_day, date: f.date, end_date: f.all_day ? f.end_date : f.date,
        start_time: f.start_time, end_time: f.end_time, time_zone: tz(), location: f.location, description: f.notes, guests: f.guests, project_id: f.project_id || null } })
      setBusy(false)
      if (error || !data?.ok) return setErr(await fnError(error, 'Couldn’t save the event to Google Calendar.'))
      calendarChanged('events')
      return onDone(edit ? 'Event updated.' : f.guests.length ? `Event added. ${names(f.guests, people, me)} ${f.guests.length > 1 ? 'were' : 'was'} invited.` : 'Event added to your Google Calendar.', 'event')
    }
    const { data, error } = await supabase.from('tasks').insert({ title: f.title.trim(), due_on: f.date, due_time: f.task_time || null, assignee: f.assignee,
      project_id: f.project_id || null, notes: f.notes.trim() || null, created_by: me }).select('id').single()
    setBusy(false)
    if (error) return setErr({ msg: error.message, code: '' })
    syncTask((data as { id: string }).id, 'upsert'); calendarChanged('tasks')
    onDone(f.assignee === me ? 'Task added.' : `Task added for ${firstName(people.find((p) => p.id === f.assignee))}.`, 'task')
  }
  const others = people.filter((p) => p.id !== me)
  return (
    <form onSubmit={save} className="qp-form">
      <input className="qp-title" aria-label="Title" placeholder="Add title" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} />
      {!edit && <div className="qp-tabs" role="tablist" aria-label="Type">
        {(['event', 'task', 'milestone', 'deliverable'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={f.kind === k} className={'qp-tab' + (f.kind === k ? ' on' : '')} onClick={() => { set('kind', k); setErr(null) }}>{({ event: 'Event', task: 'Task', milestone: 'Milestone', deliverable: 'Deliverable' })[k]}</button>)}
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
      </> : projectMark ? <>
        <div className="qp-row">
          <input type="date" className="input" aria-label={f.kind === 'milestone' ? 'Date' : 'Due date'} value={f.date} onChange={(e) => set('date', e.target.value)} required />
        </div>
        {f.kind === 'deliverable' && <label className="qp-lab">Assign to
          <select className="input" value={f.dl_assignee} onChange={(e) => set('dl_assignee', e.target.value)}>
            <option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.id === me ? `Me (${nameOf(p)})` : nameOf(p)}</option>)}
          </select></label>}
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
      <select className="input" aria-label="Project" value={f.project_id} onChange={(e) => setF((o) => ({ ...o, project_id: e.target.value, phase_id: '' }))} required={projectMark}>
        <option value="">{projectMark ? 'Choose a project…' : 'No project'}</option>
        {projects.filter((p) => p.number !== 'OH').map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}
      </select>
      {projectMark && f.project_id && <select className="input" aria-label="Phase" value={f.phase_id} onChange={(e) => set('phase_id', e.target.value)}>
        <option value="">No phase</option>{sortPhases(phases.data ?? []).map((ph) => <option key={ph.id} value={ph.id}>{ph.code} · {phaseLabel(ph)}</option>)}
      </select>}
      {!projectMark && <textarea className="input" rows={2} aria-label="Description" placeholder="Add description" value={f.notes} onChange={(e) => set('notes', e.target.value)} />}
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
    if (error) setErr(error.message); else { calendarChanged('events'); onChanged('Project saved.', 'link') }
  }
  const remove = async () => {
    if (!window.confirm(`Delete “${e.title}”? ${e.guests.some((g) => g !== me) ? 'Guests will get a cancellation from Google.' : ''}`)) return
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('calendar-event', { body: { op: 'delete', id: e.id } })
    setBusy(false)
    if (error || !data?.ok) return setErr((await fnError(error, 'Couldn’t delete the event.')).msg)
    calendarChanged('events'); onChanged('Event deleted.', 'event'); onClose()
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
        {e.can_edit && <button type="button" className="btn small" onClick={onEdit}>Edit</button>}
        {e.can_edit && <RowMenu label="Event actions" items={[{ label: 'Delete event', danger: true, disabled: busy, onSelect: remove }]} />}
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
      syncTask(edit.id, 'upsert'); calendarChanged('tasks')
      return onDone(moved ? `Task moved to ${firstName(who)}.` : 'Task saved.')
    }
    const { data, error } = await supabase.from('tasks').insert({ ...row, created_by: me }).select('id').single()
    setBusy(false)
    if (error) return setErr(error.message)
    syncTask((data as { id: string }).id, 'upsert'); calendarChanged('tasks')
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

// ---------------- which calendars show where (saved per person in calendar_prefs) ----------------
type Prefs = { hide_today: string[]; hide_cal: string[] }
let prefsCache: Prefs | null = null
const PREFS_EVT = 'abaya:cal-prefs'
/** The calendar an event came from: 'pc:<personal calendar id>' or 'g:<person>' (their Google work calendar). */
const calOf = (e: GEv) => e.id.startsWith('pc:') ? e.id.split(':').slice(0, 2).join(':') : `g:${e.profile_id}`
function useCalPrefs(me: string) {
  const [p, setP] = useState<Prefs>(prefsCache ?? { hide_today: [], hide_cal: [] })
  useEffect(() => {
    const on = () => prefsCache && setP(prefsCache)
    window.addEventListener(PREFS_EVT, on)
    if (!prefsCache) supabase.from('calendar_prefs').select('hide_today, hide_cal').eq('profile_id', me).maybeSingle().then(({ data }) => {
      prefsCache = { hide_today: data?.hide_today ?? [], hide_cal: data?.hide_cal ?? [] }; window.dispatchEvent(new Event(PREFS_EVT)) })
    return () => window.removeEventListener(PREFS_EVT, on)
  }, [me])
  const toggle = async (where: keyof Prefs, key: string, show: boolean) => {
    const cur = prefsCache ?? p
    const next = { ...cur, [where]: show ? cur[where].filter((k) => k !== key) : [...new Set([...cur[where], key])] }
    prefsCache = next; window.dispatchEvent(new Event(PREFS_EVT))
    await supabase.from('calendar_prefs').upsert({ profile_id: me, ...next, updated_at: new Date().toISOString() })
  }
  return { today: (k: string) => !p.hide_today.includes(k), cal: (k: string) => !p.hide_cal.includes(k), toggle }
}

/** Every calendar this person could see, with a Sidebar and a Calendar switch for each. */
function CalendarsPanel({ me, admin, people, events }: { me: string; admin: boolean; people: Person[]; events: GEv[] }) {
  const prefs = useCalPrefs(me)
  const mine = useLoad(async () => ((await supabase.from('personal_calendars').select('id, label').eq('profile_id', me)).data ?? []) as { id: string; label: string }[], [me])
  const who = (id: string) => { const x = people.find((q) => q.id === id); return x?.full_name || x?.email || 'Someone' }
  const pcs = new Map<string, string>()
  for (const c of mine.data ?? []) pcs.set(`pc:${c.id}`, `${c.label} (personal)`)
  for (const e of events) { const k = calOf(e); if (k.startsWith('pc:') && !pcs.has(k)) pcs.set(k, `${who(e.profile_id)} · personal`) }
  const gs = new Set([`g:${me}`, ...events.map(calOf).filter((k) => k.startsWith('g:'))])
  const groups: [string, [string, string][]][] = [
    ['Mine', [[`g:${me}`, 'Work calendar (Google)'], ...[...pcs].filter(([k]) => (mine.data ?? []).some((c) => `pc:${c.id}` === k))]],
    ['Coworkers', [...[...gs].filter((k) => k !== `g:${me}`).map((k): [string, string] => [k, `${who(k.slice(2))} · work`]),
      ...[...pcs].filter(([k]) => !(mine.data ?? []).some((c) => `pc:${c.id}` === k))]],
    ['Portal', [['tasks', 'Tasks'], ['marks', 'Milestones & deliverables'], ...(admin ? [['bills', 'Bills due'] as [string, string]] : [])]],
  ]
  return <div className="cal-pick">
    <table><thead><tr><th>Calendar</th><th>Sidebar</th><th>Calendar</th></tr></thead>
      {groups.filter(([, rows]) => rows.length).map(([g, rows]) => <tbody key={g}><tr><th colSpan={3} className="cal-pick-g">{g}</th></tr>
        {rows.map(([k, label]) => <tr key={k}><td>{label}</td>
          <td><input type="checkbox" aria-label={`Show ${label} in the Today sidebar`} checked={prefs.today(k)} onChange={(e) => prefs.toggle('hide_today', k, e.target.checked)} /></td>
          <td><input type="checkbox" aria-label={`Show ${label} on the calendar`} checked={prefs.cal(k)} onChange={(e) => prefs.toggle('hide_cal', k, e.target.checked)} /></td></tr>)}
      </tbody>)}
    </table>
    <p className="muted" style={{ margin: '8px 0 0', fontSize: 12.5 }}>Saved to your account. Add personal calendars on <a href="#/account">My account</a>.</p>
  </div>
}

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
  // Google Calendar-style views; the choice is remembered on this device
  const [view, setViewRaw] = useState<View>(() => { try { const v = localStorage.getItem('abaya:cal-view'); return (VIEWS.some(([k]) => k === v) ? v : 'month') as View } catch { return 'month' } })
  const setView = (v: View) => { setViewRaw(v); try { localStorage.setItem('abaya:cal-view', v) } catch { /* private mode */ } }
  const expanded = view === 'month'
  // Week shows 1, 2 or 3 weeks (remembered); 1 = hourly timeline, 2–3 = tall day boxes
  const [weeks, setWeeksRaw] = useState<number>(() => { try { const n = Number(localStorage.getItem('abaya:cal-weeks')); return n >= 1 && n <= 3 ? n : 1 } catch { return 1 } })
  const setWeeks = (n: number) => { setWeeksRaw(n); try { localStorage.setItem('abaya:cal-weeks', String(n)) } catch { /* private mode */ } }
  const [weekMenu, setWeekMenu] = useState(false)
  const multiWeek = view === 'week' && weeks > 1
  useEffect(() => {
    if (!weekMenu) return
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('.cv-wk')) setWeekMenu(false) }
    window.addEventListener('mousedown', close); return () => window.removeEventListener('mousedown', close)
  }, [weekMenu])
  const [cursor, setCursor] = useState(() => new Date()) // a day in the period on screen
  const month = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const [who, setWho] = useState<string>('all')
  const [open, setOpen] = useState<(Open & { anchor: DOMRect }) | null>(null)
  const [msg, setMsg] = useState('')
  const pop = (o: Open, el: HTMLElement) => { setOpen({ ...o, anchor: el.getBoundingClientRect() }); setMsg('') }
  const day0 = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())
  const start = view === 'month' ? addDays(month, -month.getDay()) : view === 'week' ? addDays(day0, -day0.getDay()) : day0 // Sunday-first weeks
  const span = view === 'month' ? 42 : view === 'week' ? 7 * weeks : view === 'day' ? 1 : SCHEDULE_DAYS
  const cells = useMemo(() => Array.from({ length: span }, (_, i) => addDays(start, i)), [start.getTime(), span]) // eslint-disable-line react-hooks/exhaustive-deps
  const from = isoDate(cells[0]), to = isoDate(cells[span - 1])
  const tasks = useTasks(from, to)
  const evs = useLoad(async () => must(await supabase.from('calendar_events').select(EV_SELECT).lte('starts_on', to).gte('ends_on', from)) as unknown as Ev[], [from, to])
  // bills due (admins only; bills include salaries)
  const bills = useLoad(async () => admin ? must(await supabase.from('company_bills').select('id, name, amount, due_on, paid_on').gte('due_on', from).lte('due_on', to)) as BillRow[] : [], [admin, from, to])
  const prefs = useCalPrefs(me)
  const [calsOpen, setCalsOpen] = useState<DOMRect | null>(null)
  const showBills = prefs.cal('bills')
  // milestones and deliverables from the Projects timeline; a person sees deliverables assigned to them and milestones on their projects
  const marks = useLoad(async () => {
    const [ms, dl, mem] = await Promise.all([
      supabase.from('milestones').select('id, title, date, done, project_id, projects(number, name, sector)').gte('date', from).lte('date', to),
      supabase.from('deliverables').select('id, title, due_date, status, assignee, project_id, projects(number, name, sector)').gte('due_date', from).lte('due_date', to),
      supabase.from('project_members').select('project_id, profile_id'),
    ])
    type MsRow = { id: string; title: string; date: string; done: boolean; project_id: string; projects: ProjMark['projects'] }
    type DlRow = { id: string; title: string; due_date: string; status: string; assignee: string | null; project_id: string; projects: ProjMark['projects'] }
    const list: ProjMark[] = [
      ...((ms.data ?? []) as unknown as MsRow[]).map((r) => ({ id: r.id, kind: 'milestone' as const, title: r.title, date: r.date, done: r.done, project_id: r.project_id, assignee: null, projects: r.projects })),
      ...((dl.data ?? []) as unknown as DlRow[]).map((r) => ({ id: r.id, kind: 'deliverable' as const, title: r.title, date: r.due_date, done: r.status === 'done', project_id: r.project_id, assignee: r.assignee, projects: r.projects })),
    ]
    return { list, members: (mem.data ?? []) as { project_id: string; profile_id: string }[] }
  }, [from, to])
  /** Is this milestone/deliverable on the calendar being shown? Everyone: all. A person: their deliverables, and milestones on projects they're on. */
  const markFor = (m: ProjMark) => who === 'all' || (m.kind === 'deliverable'
    ? m.assignee === who || (!m.assignee && (marks.data?.members ?? []).some((x) => x.project_id === m.project_id && x.profile_id === who))
    : (marks.data?.members ?? []).some((x) => x.project_id === m.project_id && x.profile_id === who))
  const marksOn = (k: string) => (marks.data?.list ?? []).filter((m) => prefs.cal('marks') && m.date === k && markFor(m)).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'milestone' ? -1 : 1))
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
    for (const e of mergeEvents((feed.data?.events ?? []).filter((x) => prefs.cal(calOf(x))), me)) for (const k of eventDays(e)) m.set(k, [...(m.get(k) ?? []), e])
    for (const l of m.values()) l.sort((a, b) => (a.all_day === b.all_day ? a.start.localeCompare(b.start) : a.all_day ? -1 : 1))
    return m
  }, [feed.data, me, prefs])
  useCalendarChanges((kind) => { if (kind === 'tasks') { tasks.reload(); evs.reload(); marks.reload() } else { feed.reload(); links.reload() } })
  const reload = () => calendarChanged('tasks')
  const today = isoDate(new Date())
  const shift = (n: number) => setCursor(view === 'month' ? new Date(month.getFullYear(), month.getMonth() + n, 1) : addDays(day0, n * (view === 'week' ? 7 * weeks : view === 'day' ? 1 : SCHEDULE_DAYS)))
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const rows = expanded ? Math.ceil((Math.round((last.getTime() - start.getTime()) / 86400000) + 1) / 7) : multiWeek ? weeks : 1 // weeks on screen
  const weekEnd = addDays(start, span - 1)
  const heading = view === 'month' ? month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : view === 'day' ? day0.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : start.getMonth() === weekEnd.getMonth() ? `${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
    : `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${weekEnd.getFullYear()}`
  const show = (pid: string) => prefs.cal('tasks') && (who === 'all' || pid === who)
  const order = [...people].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : nameOf(a).localeCompare(nameOf(b))))
  const rank = (pid: string) => order.findIndex((p) => p.id === pid)
  const done = (m: string) => { setOpen(null); setMsg(m) } // the change itself reloads the lists (calendarChanged)
  // drag & drop: move an item to another day; only the date changes
  const move = async (d: DragItem, to: string) => {
    if (d.from === to) return
    const n = Math.round((parseDate(to).getTime() - parseDate(d.from).getTime()) / 864e5)
    const when = parseDate(to).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    let error: { message: string } | null = null
    if (d.kind === 'task') {
      ({ error } = await supabase.from('tasks').update({ due_on: to }).eq('id', d.id))
      if (!error) { syncTask(d.id, 'upsert'); calendarChanged('tasks') }
    } else if (d.kind === 'ev') {
      const e = (evs.data ?? []).find((x) => x.id === d.id); if (!e) return
      ;({ error } = await supabase.from('calendar_events').update({ starts_on: isoDate(addDays(parseDate(e.starts_on), n)), ends_on: isoDate(addDays(parseDate(e.ends_on), n)) }).eq('id', d.id))
      if (!error) calendarChanged('tasks')
    } else if (d.kind === 'ms' || d.kind === 'dl') {
      ;({ error } = d.kind === 'ms' ? await supabase.from('milestones').update({ date: to }).eq('id', d.id) : await supabase.from('deliverables').update({ due_date: to }).eq('id', d.id))
      if (!error) calendarChanged('tasks')
    } else {
      setMsg('Moving the event in Google Calendar…')
      const { data, error: fe } = await supabase.functions.invoke('calendar-event', { body: { op: 'move', id: d.id, days: n, time_zone: tz() } })
      if (fe || !data?.ok) { const x = await fnError(fe, 'Couldn’t move the event in Google Calendar.'); return setMsg(x.msg) }
      calendarChanged('events')
    }
    setMsg(error ? error.message : `Moved to ${when}.`)
  }
  const [over, setOver] = useState<string | null>(null)
  const drop = (k: string) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== k) setOver(k) } },
    onDragLeave: (e: React.DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o === k ? null : o)) },
    onDrop: (e: React.DragEvent) => { const raw = e.dataTransfer.getData(DRAG_MIME); setOver(null); if (!raw) return; e.preventDefault(); move(JSON.parse(raw) as DragItem, k) },
  })
  const close = () => setOpen(null)
  // everything on one day, for the day / week / schedule views
  const itemsFor = (k: string): DayItems => {
    const g = (gByDay.get(k) ?? []).filter((e) => who === 'all' || e.people.includes(who))
    const t = (tasks.data ?? []).filter((x) => x.due_on === k && show(x.assignee)).sort((a, b) => rank(a.assignee) - rank(b.assignee))
    return {
      bills: showBills ? (bills.data ?? []).filter((b) => b.due_on === k) : [],
      marks: marksOn(k),
      evs: (evs.data ?? []).filter((e) => e.starts_on <= k && e.ends_on >= k && show(e.profile_id)),
      gAll: g.filter((e) => e.all_day), gTimed: g.filter((e) => !e.all_day),
      tAll: t.filter((x) => !x.due_time), tTimed: t.filter((x) => x.due_time),
    }
  }
  const gItem = (e: GM) => <GEventItem key={e.key} e={e} me={me} people={people} project={projOf(e)} onOpen={(x, el) => pop({ kind: 'event', ev: x }, el)} />
  const tItem = (t: Task) => <TaskItem key={t.id} t={t} me={me} admin={admin} people={people} prefixName onChange={reload} onEdit={(x, el) => pop({ kind: 'task', task: x }, el)} />
  /** the untimed things on a day (all = also the timed ones, in time order, for the schedule list) */
  const renderAllDay = (k: string, all?: boolean) => { const x = itemsFor(k); return <ul className="tk-list">
    {x.bills.map((b) => <BillItem key={b.id} b={b} onChange={bills.reload} />)}
    {x.marks.map((m) => <ProjMarkItem key={m.kind + m.id} m={m} people={people} onChange={marks.reload} />)}
    {x.gAll.map(gItem)}
    {x.evs.map((e) => <EventItem key={e.id} e={e} me={me} admin={admin} people={people} onChange={reload} />)}
    {all ? [...x.gTimed.map((e) => ({ at: hhmm(e.start), el: gItem(e) })), ...x.tTimed.map((t) => ({ at: t.due_time!.slice(0, 5), el: tItem(t) }))].sort((a, b) => a.at.localeCompare(b.at)).map((y) => y.el) : null}
    {x.tAll.map(tItem)}
  </ul> }
  const renderTimed = (k: string): Timed[] => { const x = itemsFor(k); return [
    ...x.gTimed.map((e) => { const s = new Date(e.start), en = new Date(e.end)
      const a = isoDate(s) < k ? 0 : s.getHours() * 60 + s.getMinutes(), b = isoDate(en) > k ? 1440 : en.getHours() * 60 + en.getMinutes()
      return { key: e.key, a, b: Math.max(b, a + 15), el: <ul className="tk-list">{gItem(e)}</ul> } }),
    ...x.tTimed.map((t) => { const a = minutes(t.due_time!.slice(0, 5)); return { key: t.id, a, b: a + 30, el: <ul className="tk-list">{tItem(t)}</ul> } }),
  ] }
  return (
    <CanDrag.Provider value={true}>
    <section className="card pad stack" aria-labelledby="mc-h">
      <div className="row between">
        <h2 id="mc-h">{heading}</h2>
        <div className="row">
          <div className="cv-seg" role="group" aria-label="Calendar view">{VIEWS.map(([k, l]) => k === 'week'
            ? <span key={k} className="cv-wk">
                <button type="button" aria-pressed={view === 'week'} aria-haspopup="menu" aria-expanded={weekMenu} onClick={() => setWeekMenu(!weekMenu)}>{view === 'week' && weeks > 1 ? `${weeks} weeks` : 'Week'} <span aria-hidden="true">▾</span></button>
                {weekMenu && <span className="cv-wk-menu" role="menu" onKeyDown={(e) => { if (e.key === 'Escape') setWeekMenu(false) }}>
                  {[1, 2, 3].map((n) => <button key={n} type="button" role="menuitemradio" aria-checked={view === 'week' && weeks === n} onClick={() => { setWeeks(n); setView('week'); setWeekMenu(false) }}>{n === 1 ? '1 week' : `${n} weeks`}</button>)}
                  <button type="button" role="menuitemradio" aria-checked={view === 'month'} onClick={() => { setView('month'); setWeekMenu(false) }}>All weeks (month)</button>
                </span>}
              </span>
            : <button key={k} type="button" aria-pressed={view === k} onClick={() => { setView(k); setWeekMenu(false) }}>{l}</button>)}</div>
          <button className="btn small secondary" aria-label={`Previous ${view === 'schedule' ? 'period' : view}`} onClick={() => shift(-1)}>‹</button>
          <button className="btn small secondary" onClick={() => setCursor(new Date())}>Today</button>
          <button className="btn small secondary" aria-label={`Next ${view === 'schedule' ? 'period' : view}`} onClick={() => shift(1)}>›</button>
          <button className="btn small" onClick={(e) => pop({ kind: 'new', day: today }, e.currentTarget)}>+ Create</button>
        </div>
      </div>
      <div className="row" role="group" aria-label="Show calendar for" style={{ gap: 6 }}>
        <button type="button" className={'btn small' + (who === 'all' ? '' : ' secondary')} aria-pressed={who === 'all'} onClick={() => setWho('all')}>Everyone</button>
        {order.map((p) => <button key={p.id} type="button" className={'btn small' + (who === p.id ? '' : ' secondary')} aria-pressed={who === p.id} onClick={() => setWho(p.id)}>{p.id === me ? 'Me' : firstName(p)}</button>)}
        <button type="button" className="btn small secondary" style={{ marginLeft: 'auto' }} aria-haspopup="dialog" onClick={(e) => setCalsOpen(e.currentTarget.getBoundingClientRect())}>Calendars ▾</button>
        {calsOpen && <Pop anchor={calsOpen} label="Calendars" onClose={() => setCalsOpen(null)}><CalendarsPanel me={me} admin={admin} people={people} events={feed.data?.events ?? []} /></Pop>}
      </div>
      {feed.data && !connected && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Your Google Calendar meetings can show here, and events you add go to your Google Calendar: <a href="#/account">connect Google on My account</a>.</p>}
      {msg && <p className="ok" role="status" style={{ margin: 0 }}>{msg}</p>}
      {(tasks.error || evs.error) && <p className="err">{tasks.error || evs.error}</p>}
      {((view === 'week' && weeks === 1) || view === 'day') && <TimeGrid days={cells} today={today} items={itemsFor} renderAllDay={renderAllDay} renderTimed={renderTimed} onEmpty={(k, el) => pop({ kind: 'new', day: k }, el)} drop={drop} over={over} />}
      {view === 'schedule' && <ScheduleList days={cells} today={today} items={itemsFor} renderAll={(k) => renderAllDay(k, true)} onAdd={(k, el) => pop({ kind: 'new', day: k }, el)} drop={drop} over={over} />}
      {(view === 'month' || multiWeek) && <div style={{ overflowX: 'auto' }}><div className={'mc' + (multiWeek ? ` mc-w${weeks}` : '')} id="mc-grid" style={{ minWidth: 760 }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="mc-h">{d}</div>)}
        {cells.slice(0, rows * 7).map((d) => {
          const k = isoDate(d); const out = expanded && d.getMonth() !== month.getMonth()
          const dayTasks = (tasks.data ?? []).filter((t) => t.due_on === k && show(t.assignee)).sort((a, b) => rank(a.assignee) - rank(b.assignee))
          const dayEvs = (evs.data ?? []).filter((e) => e.starts_on <= k && e.ends_on >= k && show(e.profile_id))
          return (
            // clicking empty space in a day opens quick-create for that day (the + button does the same, for keyboards)
            <div key={k} className={'mc-cell' + (out ? ' out' : '') + (k === today ? ' today' : '') + (over === k ? ' drop' : '')} {...drop(k)}
              onClick={(e) => { if (!(e.target as HTMLElement).closest('.tk, .mc-add, button, input, a, label')) pop({ kind: 'new', day: k }, e.currentTarget) }}>
              <div className="row between" style={{ gap: 4 }}>
                <span className="mc-d">{d.getDate()}</span>
                <button type="button" className="mc-add" onClick={(e) => pop({ kind: 'new', day: k }, e.currentTarget.closest('.mc-cell') as HTMLElement)} aria-label={`Add an event or task on ${d.toDateString()}`}>+</button>
              </div>
              <ul className="tk-list">
                {showBills && (bills.data ?? []).filter((b) => b.due_on === k).map((b) => <BillItem key={b.id} b={b} onChange={bills.reload} />)}
                {marksOn(k).map((m) => <ProjMarkItem key={m.kind + m.id} m={m} people={people} onChange={marks.reload} />)}
                {(gByDay.get(k) ?? []).filter((e) => who === 'all' || e.people.includes(who)).map((e) => <GEventItem key={e.key} e={e} me={me} people={people} project={projOf(e)} onOpen={(x, el) => pop({ kind: 'event', ev: x }, el)} />)}
                {dayEvs.map((e) => <EventItem key={e.id} e={e} me={me} admin={admin} people={people} onChange={reload} />)}
                {dayTasks.map((t) => <TaskItem key={t.id} t={t} me={me} admin={admin} people={people} prefixName onChange={reload} onEdit={(x, el) => pop({ kind: 'task', task: x }, el)} />)}
              </ul>
            </div>)
        })}
      </div></div>}
      {open && <Pop key={open.kind + ('ev' in open ? open.ev.key : 'task' in open ? open.task.id : open.day)} anchor={open.anchor} onClose={close}
        label={open.kind === 'new' ? 'Create' : open.kind === 'task' ? 'Edit task' : open.kind === 'edit' ? 'Edit event' : 'Event details'}>
        {open.kind === 'new' && <QuickCreate me={me} admin={admin} people={people} projects={projects} day={open.day} connected={connected} onCancel={close} onDone={done} />}
        {open.kind === 'edit' && <QuickCreate me={me} admin={admin} people={people} projects={projects} day={open.ev.start.slice(0, 10)} connected={connected} edit={open.ev}
          linkProject={linkOf(open.ev.id) ? linkOf(open.ev.id)!.project_id : undefined} onCancel={close} onDone={done} />}
        {open.kind === 'event' && <EventView e={open.ev} me={me} people={people} projects={projects} project={projOf(open.ev)} link={linkOf(open.ev.id)}
          onEdit={() => setOpen({ ...open, kind: 'edit' })} onChanged={(m) => setMsg(m)} onClose={close} />}
        {open.kind === 'task' && <div className="qp-form"><AddTask me={me} admin={admin} people={people} projects={projects} day={open.task.due_on} edit={open.task} onCancel={close} onDone={(m) => done(m)} /></div>}
      </Pop>}
    </section>
    </CanDrag.Provider>
  )
}

type View = 'schedule' | 'day' | 'week' | 'month'
const VIEWS: [View, string][] = [['schedule', 'Schedule'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month']]
const SCHEDULE_DAYS = 30
const HOUR = 48 // px per hour in the day / week timeline
type DayItems = { bills: BillRow[]; marks: ProjMark[]; evs: Ev[]; gAll: GM[]; gTimed: GM[]; tAll: Task[]; tTimed: Task[] }
type Timed = { key: string; a: number; b: number; el: React.ReactNode } // minutes from midnight

/** Day and week views: an all-day strip on top, then an hourly timeline (opens scrolled to 7am), like Google Calendar. */
type DropFn = (k: string) => React.HTMLAttributes<HTMLElement>
function TimeGrid({ days, today, items, renderAllDay, renderTimed, onEmpty, drop, over }: { days: Date[]; today: string; items: (k: string) => DayItems
  renderAllDay: (k: string) => React.ReactNode; renderTimed: (k: string) => Timed[]; onEmpty: (k: string, el: HTMLElement) => void; drop: DropFn; over: string | null }) {
  const body = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (body.current) body.current.scrollTop = 7 * HOUR - 8 }, [days.length])
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t) }, [])
  const cols = `56px repeat(${days.length}, minmax(${days.length > 1 ? 84 : 200}px, 1fr))`
  const anyAllDay = days.some((d) => { const x = items(isoDate(d)); return x.bills.length + x.marks.length + x.evs.length + x.gAll.length + x.tAll.length > 0 })
  return (
    <div className="cv-wrap" style={{ overflowX: 'auto' }}><div style={{ minWidth: days.length > 1 ? 650 : 0 }}>
      <div className="cv-head" style={{ gridTemplateColumns: cols }}>
        <span />
        {days.map((d) => { const k = isoDate(d); return <div key={k} className={'cv-dh' + (k === today ? ' today' : '')}>
          <span>{d.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong className="num">{d.getDate()}</strong></div> })}
      </div>
      {anyAllDay && <div className="cv-allday" style={{ gridTemplateColumns: cols }}>
        <span className="cv-gut">all day</span>
        {days.map((d) => { const k = isoDate(d); return <div key={k} className={'cv-adcell' + (over === k ? ' drop' : '')} {...drop(k)}>{renderAllDay(k)}</div> })}
      </div>}
      <div className="cv-body" ref={body}>
        <div className="cv-grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR }}>
          <div className="cv-hours">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * HOUR }}>{h === 0 ? '' : `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`}</span>)}</div>
          {days.map((d) => {
            const k = isoDate(d)
            // side-by-side lanes for overlapping items
            const list = renderTimed(k).sort((x, y) => x.a - y.a || y.b - x.b)
            // groups of items that overlap each other share the width; anything on its own gets the full column
            const placed: (Timed & { lane: number; n: number })[] = []
            let group: (Timed & { lane: number; n: number })[] = [], lanes: number[] = [], groupEnd = -1
            const flush = () => { group.forEach((g) => { g.n = lanes.length }); placed.push(...group); group = []; lanes = [] }
            for (const x of list) {
              if (x.a >= groupEnd) { flush(); groupEnd = -1 }
              let l = lanes.findIndex((end) => end <= x.a); if (l < 0) { l = lanes.length; lanes.push(0) } lanes[l] = x.b
              group.push({ ...x, lane: l, n: 1 }); groupEnd = Math.max(groupEnd, x.b)
            }
            flush()
            return <div key={k} className={'cv-col' + (k === today ? ' today' : '') + (over === k ? ' drop' : '')} {...drop(k)}
              onClick={(e) => { if (!(e.target as HTMLElement).closest('.tk, button, input, a, label')) onEmpty(k, e.currentTarget) }}>
              {Array.from({ length: 24 }, (_, h) => <span key={h} className="cv-line" style={{ top: h * HOUR }} />)}
              {placed.map((x) => <div key={x.key} className="cv-ev" style={{ top: x.a / 60 * HOUR, height: Math.max(22, (x.b - x.a) / 60 * HOUR - 2), left: `calc(${x.lane / x.n * 100}% + 2px)`, width: `calc(${100 / x.n}% - 4px)` }}>{x.el}</div>)}
              {k === today && <span className="cv-now" style={{ top: (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR }} aria-hidden="true" />}
            </div>
          })}
        </div>
      </div>
    </div></div>
  )
}

/** Schedule view: the next 30 days as a list, only days that have something on them. */
function ScheduleList({ days, today, items, renderAll, onAdd, drop, over }: { days: Date[]; today: string; items: (k: string) => DayItems; renderAll: (k: string) => React.ReactNode; onAdd: (k: string, el: HTMLElement) => void; drop: DropFn; over: string | null }) {
  const busy = days.filter((d) => { const x = items(isoDate(d)); return x.bills.length + x.marks.length + x.evs.length + x.gAll.length + x.gTimed.length + x.tAll.length + x.tTimed.length > 0 })
  if (!busy.length) return <p className="muted" style={{ margin: 0 }}><em>Nothing scheduled from {days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to {days[days.length - 1].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.</em></p>
  return <ol className="cv-sched">{busy.map((d) => { const k = isoDate(d); return (
    <li key={k} className={(k === today ? 'today' : '') + (over === k ? ' drop' : '')} {...drop(k)}>
      <div className="cv-sd"><strong className="num">{d.getDate()}</strong><span>{d.toLocaleDateString('en-US', { month: 'short', weekday: 'short' })}</span>
        <button type="button" className="mc-add" onClick={(e) => onAdd(k, e.currentTarget.closest('li') as HTMLElement)} aria-label={`Add an event or task on ${d.toDateString()}`}>+</button></div>
      <div className="cv-si">{renderAll(k)}</div>
    </li>) })}</ol>
}

/** Home sidebar: my day. My meetings today (Google), my tasks due today, anything overdue, and what's coming up in the
 *  next 7 days, with a quick + Add. */
export function TodayCard({ me, admin, people, projects }: { me: string; admin: boolean; people: Person[]; projects: Proj[] }) {
  const today = isoDate(new Date())
  const until = isoDate(addDays(new Date(), 7))
  const tasks = useTasks(today, until, me)
  const overdue = useLoad(async () => must(await supabase.from('tasks').select(TASK_SELECT).eq('assignee', me).is('done_at', null).lt('due_on', today)
    .order('due_on').limit(20)) as unknown as Task[], [me, today])
  const feed = useLoad(async () => {
    const { data, error } = await supabase.functions.invoke('calendar-feed', { body: { from: today, to: until } })
    return (error || !data?.events ? { events: [], me_connected: false } : data) as { events: GEv[]; me_connected: boolean }
  }, [today, until])
  const links = useLoad(async () => { const { data, error } = await supabase.from('calendar_event_projects').select('google_event_id, project_id'); return (error ? [] : data) as Link[] }, [])
  // items added the older way ("+ Add to calendar"), still on the calendar until checked off
  const olds = useLoad(async () => must(await supabase.from('calendar_events').select(EV_SELECT).eq('profile_id', me).lte('starts_on', until).gte('ends_on', today)) as unknown as Ev[], [me, today, until])
  useCalendarChanges((kind) => { if (kind === 'tasks') { tasks.reload(); overdue.reload(); olds.reload() } else { feed.reload(); links.reload() } })
  const [open, setOpen] = useState<(Open & { anchor: DOMRect }) | null>(null)
  const [msg, setMsg] = useState('')
  const pop = (o: Open, el: HTMLElement) => { setOpen({ ...o, anchor: el.getBoundingClientRect() }); setMsg('') }
  const linkOf = (id: string) => (links.data ?? []).find((l) => l.google_event_id === id)
  const projOf = (e: GEv) => { const l = linkOf(e.id); return projects.find((p) => p.id === (l ? l.project_id : e.auto_project_id)) }
  const prefs = useCalPrefs(me)
  const [calsOpen, setCalsOpen] = useState<DOMRect | null>(null)
  const myEvents = mergeEvents((feed.data?.events ?? []).filter((x) => prefs.today(calOf(x))), me).filter((e) => e.people.includes(me))
    .sort((a, b) => (a.all_day === b.all_day ? a.start.localeCompare(b.start) : a.all_day ? -1 : 1))
  const mine = myEvents.filter((e) => eventDays(e).includes(today))
  const reload = () => calendarChanged('tasks')
  const close = () => setOpen(null)
  const tasksOn = prefs.today('tasks')
  const allTasks = tasksOn ? tasks.data ?? [] : [], allOld = tasksOn ? olds.data ?? [] : []
  const todo = allTasks.filter((t) => t.due_on === today), late = tasksOn ? overdue.data ?? [] : [], old = allOld.filter((e) => e.starts_on <= today)
  // coming up: the next 7 days, grouped by day (unfinished tasks, older-style items, meetings)
  const upcoming = Array.from({ length: 7 }, (_, i) => isoDate(addDays(new Date(), i + 1))).map((k) => ({
    k, evs: myEvents.filter((e) => eventDays(e)[0] === k), // multi-day events listed on their first day
    olds: allOld.filter((e) => e.starts_on === k), tasks: allTasks.filter((t) => t.due_on === k && !t.done_at),
  })).filter((d) => d.evs.length || d.olds.length || d.tasks.length)
  const left = todo.filter((t) => !t.done_at).length + late.length + old.length
  const loading = !tasks.data || !feed.data
  return (
    <section className="card pad stack" aria-labelledby="hm-today">
      <div className="row between">
        <h2 id="hm-today">Today <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>{loading ? '' : left ? `· ${left} to do` : '· all done'}</span></h2>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn small secondary td-cals" aria-label="Choose which calendars show here" title="Calendars" onClick={(e) => setCalsOpen(e.currentTarget.getBoundingClientRect())}>⚙</button>
          <button className="btn small" onClick={(e) => pop({ kind: 'new', day: today }, e.currentTarget)}>+ Add</button></div>
      </div>
      {calsOpen && <Pop anchor={calsOpen} label="Calendars" onClose={() => setCalsOpen(null)}><CalendarsPanel me={me} admin={admin} people={people} events={feed.data?.events ?? []} /></Pop>}
      {msg && <p className="ok" role="status" style={{ margin: 0 }}>{msg}</p>}
      {tasks.error && <p className="err">{tasks.error}</p>}
      {!loading && !mine.length && !todo.length && !late.length && !old.length && <p className="muted" style={{ margin: 0 }}><em>Nothing scheduled today.</em></p>}
      {late.length > 0 && <div className="stack" style={{ gap: 4 }}>
        <p className="td-h" style={{ color: 'var(--red)' }}>Overdue</p>
        <ul className="tk-list">{late.map((t) => <li key={t.id} className="td-late"><span className="td-date">{parseDate(t.due_on).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          <ul className="tk-list" style={{ flex: 1, minWidth: 0 }}><TaskItem t={t} me={me} admin={admin} people={people} onChange={reload} onEdit={(x, el) => pop({ kind: 'task', task: x }, el)} /></ul></li>)}</ul>
      </div>}
      {mine.length > 0 && <div className="stack" style={{ gap: 4 }}>
        <p className="td-h">Events</p>
        <ul className="tk-list">{mine.map((e) => <GEventItem key={e.key} e={e} me={me} people={people} project={projOf(e)} onOpen={(x, el) => pop({ kind: 'event', ev: x }, el)} />)}</ul>
      </div>}
      {(todo.length > 0 || old.length > 0) && <div className="stack" style={{ gap: 4 }}>
        <p className="td-h">Tasks</p>
        <ul className="tk-list">{old.map((e) => <EventItem key={e.id} e={e} me={me} admin={admin} people={people} onChange={reload} />)}{todo.map((t) => <TaskItem key={t.id} t={t} me={me} admin={admin} people={people} onChange={reload} onEdit={(x, el) => pop({ kind: 'task', task: x }, el)} />)}</ul>
      </div>}
      {upcoming.length > 0 && <div className="stack td-up" style={{ gap: 6 }}>
        <p className="td-h">Coming up</p>
        {upcoming.map((d) => <div key={d.k} className="td-day">
          <span className="td-date">{parseDate(d.k).toLocaleDateString('en-US', { weekday: 'short' })}<br /><span style={{ fontWeight: 400 }}>{parseDate(d.k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></span>
          <ul className="tk-list" style={{ flex: 1, minWidth: 0 }}>
            {d.evs.map((e) => <GEventItem key={e.key} e={e} me={me} people={people} project={projOf(e)} onOpen={(x, el) => pop({ kind: 'event', ev: x }, el)} />)}
            {d.olds.map((e) => <EventItem key={e.id} e={e} me={me} admin={admin} people={people} onChange={reload} />)}
            {d.tasks.map((t) => <TaskItem key={t.id} t={t} me={me} admin={admin} people={people} onChange={reload} onEdit={(x, el) => pop({ kind: 'task', task: x }, el)} />)}
          </ul>
        </div>)}
      </div>}
      {feed.data && !feed.data.me_connected && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Connect Google on <a href="#/account">My account</a> to see your meetings here.</p>}
      {open && <Pop key={open.kind + ('ev' in open ? open.ev.key : 'task' in open ? open.task.id : open.day)} anchor={open.anchor} onClose={close}
        label={open.kind === 'new' ? 'Create' : open.kind === 'task' ? 'Edit task' : open.kind === 'edit' ? 'Edit event' : 'Event details'}>
        {open.kind === 'new' && <QuickCreate me={me} admin={admin} people={people} projects={projects} day={open.day} connected={!!feed.data?.me_connected} onCancel={close} onDone={(m) => { close(); setMsg(m) }} />}
        {open.kind === 'edit' && <QuickCreate me={me} admin={admin} people={people} projects={projects} day={today} connected={!!feed.data?.me_connected} edit={open.ev}
          linkProject={linkOf(open.ev.id) ? linkOf(open.ev.id)!.project_id : undefined} onCancel={close} onDone={(m) => { close(); setMsg(m) }} />}
        {open.kind === 'event' && <EventView e={open.ev} me={me} people={people} projects={projects} project={projOf(open.ev)} link={linkOf(open.ev.id)}
          onEdit={() => setOpen({ ...open, kind: 'edit' })} onChanged={(m) => setMsg(m)} onClose={close} />}
        {open.kind === 'task' && <div className="qp-form"><AddTask me={me} admin={admin} people={people} projects={projects} day={open.task.due_on} edit={open.task} onCancel={close} onDone={(m) => { close(); setMsg(m) }} /></div>}
      </Pop>}
    </section>
  )
}

/** Staff week view: my tasks for a given day (used inside the existing week calendar). */
export function dayTasks(tasks: Task[] | null, day: Date) { const k = isoDate(day); return (tasks ?? []).filter((t) => t.due_on === k) }
export { parseDate }

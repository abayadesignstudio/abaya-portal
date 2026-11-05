import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SECTOR_COLOR, PHASE_NAME, money } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import './gantt.css'

// Projects as a Gantt chart (like Monograph): one row per project, one bar per phase (from its start/end dates).
// Left: project number (building-type color), name, client and fee used. Right: a scrollable week/month timeline with
// today marked. Zoom with − / + or the scale menu; "Today" scrolls back to now. Click a project's name to open it.
// Drag a bar to move the whole phase (same length), or drag either end to change its start or end date. Focused bars and
// ends also move with ← / →. Undo puts it back.

export type GPhase = { id?: string; code: string; status: string; fee: number; start_date: string | null; end_date: string | null }
export type GRow = { id: string; number: string; name: string; status: string; sector: string | null; clients: { name: string } | null; phases: GPhase[] }

const DAY = 86400000
const LEFT = 330 // project column width (px)
const ZOOMS = [2, 3, 4.5, 7, 10, 13, 18, 26] // px per day
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY)
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const short = (s: string) => parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmt = (s: string) => parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const STATUS_WORD: Record<string, string> = { complete: 'Complete', in_progress: 'In progress', paused: 'Paused', not_started: 'Not started' }

/** Fee-used ring (hours × rates against total phase fees). */
function Ring({ pct }: { pct: number | null }) {
  const r = 15, c = 2 * Math.PI * r
  const p = pct === null ? 0 : Math.min(100, pct)
  const col = pct === null ? '#d0d5dd' : pct >= 90 ? '#d92d20' : pct >= 75 ? '#dc6803' : '#2b5c8a'
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" role="img" aria-label={pct === null ? 'No phase fees' : `${Math.round(pct)}% of fee used`}>
      <circle cx="20" cy="20" r={r} fill="none" stroke="#e7e5df" strokeWidth="3" />
      {pct !== null && <circle cx="20" cy="20" r={r} fill="none" stroke={col} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 20 20)" />}
      <text x="20" y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill={pct !== null && pct >= 90 ? '#d92d20' : '#3b4350'}>{pct === null ? '–' : `${Math.round(pct)}%`}</text>
    </svg>
  )
}

type Dates = { start_date: string; end_date: string }
/** A dated thing on a project's row: a milestone (a phase's end), a deliverable, a task, or a calendar event / meeting. */
type Kind = 'milestone' | 'deliverable' | 'task' | 'event'
type Mark = { key: string; project_id: string; kind: Kind; title: string; date: string; done: boolean; phase_id?: string | null; time?: string | null; who?: string }
const KIND_WORD = { milestone: 'Milestone', deliverable: 'Deliverable', task: 'Task', event: 'Event' } as const

/** Everything dated on these projects. Google meetings come from the calendar feed, which covers about a month either side of today. */
function useMarks(ids: string[]) {
  const key = ids.slice().sort().join(',')
  return useLoad(async () => {
    if (!ids.length) return [] as Mark[]
    const [dl, tk, ev, people] = await Promise.all([
      supabase.from('deliverables').select('id, project_id, phase_id, title, due_date, status').in('project_id', ids).not('due_date', 'is', null),
      supabase.from('tasks').select('id, project_id, title, due_on, due_time, done_at, assignee').in('project_id', ids),
      supabase.from('calendar_events').select('id, project_id, title, starts_on, start_time').in('project_id', ids),
      supabase.from('profiles').select('id, full_name, email').in('role', ['admin', 'staff']),
    ])
    const first = (id: string | null) => { const p = (people.data ?? []).find((x) => x.id === id); return (p?.full_name || p?.email || '').split(/\s+/)[0] }
    const out: Mark[] = [
      ...(dl.data ?? []).map((d) => ({ key: 'd' + d.id, project_id: d.project_id, kind: 'deliverable' as const, title: d.title, date: d.due_date!, done: d.status === 'done', phase_id: d.phase_id })),
      ...(tk.data ?? []).map((t) => ({ key: 't' + t.id, project_id: t.project_id!, kind: 'task' as const, title: t.title, date: t.due_on, done: !!t.done_at, time: t.due_time, who: first(t.assignee) })),
      ...(ev.data ?? []).map((e) => ({ key: 'e' + e.id, project_id: e.project_id!, kind: 'event' as const, title: e.title, date: e.starts_on, done: false, time: e.start_time })),
    ]
    // Google meetings linked to a project (by hand, or by the project number in the event)
    const today = new Date(), from = isoOf(addDays(today, -30)), to = isoOf(addDays(today, 31))
    try {
      const [{ data }, links] = await Promise.all([supabase.functions.invoke('calendar-feed', { body: { from, to } }), supabase.from('calendar_event_projects').select('google_event_id, project_id')])
      const seen = new Set<string>()
      for (const g of (data?.events ?? []) as { id: string; uid: string; title: string; start: string; all_day: boolean; auto_project_id: string | null; busy_only?: boolean }[]) {
        const l = (links.data ?? []).find((x) => x.google_event_id === g.id)
        const pid = l ? l.project_id : g.auto_project_id
        if (!pid || !ids.includes(pid) || g.busy_only || seen.has(g.uid + g.start)) continue
        seen.add(g.uid + g.start)
        const d = g.all_day ? g.start.slice(0, 10) : isoOf(new Date(g.start))
        const t = g.all_day ? null : new Date(g.start).toTimeString().slice(0, 5)
        out.push({ key: 'g' + g.uid + g.start, project_id: pid, kind: 'event', title: g.title, date: d, done: false, time: t })
      }
    } catch { /* Google is optional */ }
    return out
  }, [key])
}
/** Icons: task = Google Tasks style (blue, empty ring / check), milestone = flag diamond, deliverable = document, event = calendar. */
function MarkIcon({ kind, done }: { kind: Kind; done: boolean }) {
  if (kind === 'task') return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1a73e8" /><circle cx="12" cy="12" r="6.2" fill="none" stroke="#fff" strokeWidth="2" />{done && <path d="M9.2 12.2l2 2 3.8-4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}</svg>
  if (kind === 'milestone') return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 1.5l10.5 10.5L12 22.5 1.5 12z" fill={done ? 'var(--mc)' : '#fff'} stroke="var(--mc)" strokeWidth="2" strokeLinejoin="round" />{done && <path d="M8.3 12.3l2.4 2.4 4.8-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}</svg>
  if (kind === 'deliverable') return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11" fill={done ? 'var(--mc)' : '#fff'} stroke="var(--mc)" strokeWidth="1.6" /><path d="M8.5 6.5h5l2.5 2.5v8.5h-7.5z M13.5 6.5v2.5h2.5" fill="none" stroke={done ? '#fff' : 'var(--mc)'} strokeWidth="1.5" strokeLinejoin="round" />{done && <path d="M10 13.3l1.5 1.5 2.6-2.8" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}</svg>
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#fff" stroke="var(--mc)" strokeWidth="1.6" /><rect x="7" y="8" width="10" height="9" rx="1.5" fill="none" stroke="var(--mc)" strokeWidth="1.5" /><path d="M7 11h10M9.5 6.5v3M14.5 6.5v3" stroke="var(--mc)" strokeWidth="1.5" strokeLinecap="round" /></svg>
}
/** Custom-order dragging, provided by the Projects page when Sort = Custom. */
export type Reorder = { dragId: string | null; start: (id: string) => void; over: (id: string) => void; end: () => void; step: (id: string, dir: -1 | 1) => void }
type Edge = 'start' | 'end' | 'move' // move = the whole phase, keeping its length
/** How far a phase may go: no earlier than the day after the previous phase ends, no later than the day before the next
 *  one starts. Phases that already overlap aren't pushed apart; they just can't overlap any more. */
type Limits = { lo: string | null; hi: string | null; prevCode?: string; nextCode?: string; nextStart?: string; prevEnd?: string }
type Drag = { id: string; edge: Edge; x0: number; orig: Dates; cur: Dates; moved: boolean; lim: Limits; stuck: '' | 'lo' | 'hi' }

/** The ⠿ drag handle for Custom order (drag it, or focus it and use ↑ / ↓). */
export function Grip({ id, name, r }: { id: string; name: string; r: Reorder }) {
  return <span className="gt-grip" draggable role="button" tabIndex={0} aria-label={`Move ${name} (drag, or use the up and down arrow keys)`}
    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); r.start(id) }} onDragEnd={r.end}
    onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); r.step(id, e.key === 'ArrowUp' ? -1 : 1); requestAnimationFrame(() => (document.querySelector(`[data-grip="${id}"]`) as HTMLElement | null)?.focus()) } }}
    data-grip={id}>⠿</span>
}

export default function ProjectsGantt({ rows, feeUsed, onDates, reorder }: { rows: GRow[]; feeUsed: Record<string, number | null>
  onDates?: (phaseId: string, d: Dates) => Promise<string | null>; reorder?: Reorder }) {
  // date changes: live preview while dragging, kept until the saved data comes back
  const [over, setOver] = useState<Record<string, Dates>>({})
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null); dragRef.current = drag
  const [undo, setUndo] = useState<{ id: string; label: string; prev: Dates; now: Dates } | null>(null)
  const [saveErr, setSaveErr] = useState('')
  // keep each new position until the reloaded data shows it (no snap-back to the old dates while saving)
  useEffect(() => {
    setOver((o) => {
      const keep = Object.entries(o).filter(([id, d]) => !rows.some((r) => r.phases.some((p) => p.id === id && p.start_date === d.start_date && p.end_date === d.end_date)))
      return keep.length === Object.keys(o).length ? o : Object.fromEntries(keep)
    })
  }, [rows])
  const limitsFor = (id: string, orig: Dates): Limits => {
    const row = rows.find((r) => r.phases.some((p) => p.id === id)); if (!row) return { lo: null, hi: null }
    const list = row.phases.filter((p) => p.id && p.start_date && p.end_date).map((p) => ({ id: p.id!, code: p.code, ...(over[p.id!] ?? { start_date: p.start_date!, end_date: p.end_date! }) }))
      .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date))
    const i = list.findIndex((p) => p.id === id), prev = list[i - 1], next = list[i + 1]
    const lo = prev ? isoOf(addDays(parse(prev.end_date), 1)) : null, hi = next ? isoOf(addDays(parse(next.start_date), -1)) : null
    return { lo: lo && lo > orig.start_date ? orig.start_date : lo, hi: hi && hi < orig.end_date ? orig.end_date : hi,
      prevCode: prev?.code, prevEnd: prev?.end_date, nextCode: next?.code, nextStart: next?.start_date }
  }
  const shift = (d: Dates, edge: Edge, n: number, lim: Limits = { lo: null, hi: null }): Dates & { stuck: '' | 'lo' | 'hi' } => {
    let stuck: '' | 'lo' | 'hi' = ''
    if (edge === 'move') {
      if (lim.lo) { const m = days(parse(d.start_date), parse(lim.lo)); if (n < m) { n = m; stuck = 'lo' } }
      if (lim.hi) { const m = days(parse(d.end_date), parse(lim.hi)); if (n > m) { n = m; stuck = 'hi' } }
      return { start_date: isoOf(addDays(parse(d.start_date), n)), end_date: isoOf(addDays(parse(d.end_date), n)), stuck }
    }
    if (edge === 'start') {
      let st = addDays(parse(d.start_date), n); const e = parse(d.end_date)
      if (lim.lo && st < parse(lim.lo)) { st = parse(lim.lo); stuck = 'lo' }
      return { ...d, start_date: isoOf(st > e ? e : st), stuck }
    }
    let e = addDays(parse(d.end_date), n); const st = parse(d.start_date)
    if (lim.hi && e > parse(lim.hi)) { e = parse(lim.hi); stuck = 'hi' }
    return { ...d, end_date: isoOf(e < st ? st : e), stuck }
  }
  const nudge = (id: string, edge: Edge, live: Dates, n: number): Dates => { const r = shift(live, edge, n, limitsFor(id, live)); return { start_date: r.start_date, end_date: r.end_date } }
  const save = async (id: string, label: string, prev: Dates, now: Dates) => {
    if (!onDates || (prev.start_date === now.start_date && prev.end_date === now.end_date)) return
    setOver((o) => ({ ...o, [id]: now })); setSaveErr('')
    const err = await onDates(id, now)
    if (err) { setSaveErr(err); setOver((o) => { const n = { ...o }; delete n[id]; return n }) } else setUndo({ id, label, prev, now })
  }
  const startDrag = (e: React.PointerEvent, id: string, edge: Edge, orig: Dates) => {
    if (!onDates || e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ id, edge, x0: e.clientX, orig, cur: orig, moved: false, lim: limitsFor(id, orig), stuck: '' })
  }
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return
    const n = Math.round((e.clientX - d.x0) / px)
    const { stuck, ...cur } = shift(d.orig, d.edge, n, d.lim)
    if (cur.start_date !== d.cur.start_date || cur.end_date !== d.cur.end_date || stuck !== d.stuck || (!d.moved && n !== 0)) setDrag({ ...d, cur, stuck, moved: d.moved || n !== 0 })
  }
  const endDrag = (label: string) => {
    const d = dragRef.current; if (!d) return
    setDrag(null)
    if (d.moved) save(d.id, label, d.orig, d.cur)
  }
  const scroller = useRef<HTMLDivElement>(null)
  const [zi, setZi] = useState(() => { try { const r = localStorage.getItem('abaya.gantt.zoom'); const v = r === null ? NaN : Number(r); return v >= 0 && v < ZOOMS.length ? v : 5 } catch { return 5 } })
  useEffect(() => { try { localStorage.setItem('abaya.gantt.zoom', String(zi)) } catch { /* private mode */ } }, [zi])
  const px = ZOOMS[zi]
  const weekly = px >= 7
  const today = new Date(); today.setHours(0, 0, 0, 0)

  // timeline range: everything shown, plus some room around today
  const { start, end } = useMemo(() => {
    let lo = addDays(today, -8 * 7), hi = addDays(today, 26 * 7)
    for (const r of rows) for (const ph of r.phases) {
      if (ph.start_date && parse(ph.start_date) < lo) lo = parse(ph.start_date)
      if (ph.end_date && parse(ph.end_date) > hi) hi = parse(ph.end_date)
    }
    return { start: mondayOf(addDays(lo, -14)), end: addDays(mondayOf(addDays(hi, 21)), 6) }
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = days(start, end) + 1
  const width = total * px
  const x = (d: Date) => days(start, d) * px

  // header bands
  const months = useMemo(() => {
    const out: { label: string; left: number; w: number }[] = []
    for (let m = new Date(start.getFullYear(), start.getMonth(), 1); m <= end; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const a = m < start ? start : m, b = new Date(m.getFullYear(), m.getMonth() + 1, 1)
      out.push({ label: m.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase(), left: x(a), w: x(b > end ? addDays(end, 1) : b) - x(a) })
    }
    return out
  }, [start.getTime(), end.getTime(), px]) // eslint-disable-line react-hooks/exhaustive-deps
  const weeks = useMemo(() => {
    const out: { label: string; left: number; cur: boolean }[] = []
    for (let w = mondayOf(start); w <= end; w = addDays(w, 7)) {
      const e = addDays(w, 6)
      out.push({ label: `${w.getDate()} - ${e.getDate()}`, left: x(w), cur: today >= w && today <= e })
    }
    return out
  }, [start.getTime(), end.getTime(), px]) // eslint-disable-line react-hooks/exhaustive-deps

  const view = () => (scroller.current?.clientWidth ?? 800) - LEFT // visible timeline width
  const toToday = (smooth = true) => { const el = scroller.current; if (el) el.scrollTo({ left: Math.max(0, x(today) - view() * 0.3), behavior: smooth ? 'smooth' : 'auto' }) }
  // keep the same date in view when zooming; start on today
  const centerDay = useRef<number | null>(null)
  const zoom = (n: number) => {
    const el = scroller.current
    if (el) centerDay.current = (el.scrollLeft + view() / 2) / px
    setZi((z) => Math.max(0, Math.min(ZOOMS.length - 1, z + n)))
  }
  useLayoutEffect(() => {
    const el = scroller.current; if (!el) return
    if (centerDay.current !== null) { el.scrollLeft = centerDay.current * px - view() / 2; centerDay.current = null }
  }, [px])
  const first = useRef(true)
  useLayoutEffect(() => { if (first.current && rows.length) { first.current = false; toToday(false) } }) // eslint-disable-line react-hooks/exhaustive-deps

  const todayX = x(today)
  const [showMarks, setShowMarks] = useState(() => { try { return localStorage.getItem('abaya:gantt-marks') !== '0' } catch { return true } })
  const marks = useMarks(useMemo(() => rows.map((r) => r.id), [rows]))
  const time12 = (t?: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return ` · ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}` }
  return (
    <div className="gt card">
      <div className="gt-tools">
        <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>PROJECTS ({rows.length})</span>
        <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>
          <label className="row" style={{ gap: 6, fontSize: 13, marginRight: 6 }}><input type="checkbox" checked={showMarks} style={{ width: 16, height: 16 }}
            onChange={(e) => { setShowMarks(e.target.checked); try { localStorage.setItem('abaya:gantt-marks', e.target.checked ? '1' : '0') } catch { /* private mode */ } }} />Milestones, tasks &amp; events</label>
          <button type="button" className="btn small secondary" onClick={() => toToday()}>Today</button>
          <button type="button" className="btn small secondary" aria-label="Zoom out" onClick={() => zoom(-1)} disabled={zi === 0}>−</button>
          <label className="sr" htmlFor="gt-scale">Scale</label>
          <select id="gt-scale" className="input gt-scale" value={weekly ? 'w' : 'm'} onChange={(e) => { const el = scroller.current; if (el) centerDay.current = (el.scrollLeft + view() / 2) / px; setZi(e.target.value === 'w' ? 5 : 2) }}>
            <option value="w">Weeks</option><option value="m">Months</option></select>
          <button type="button" className="btn small secondary" aria-label="Zoom in" onClick={() => zoom(1)} disabled={zi === ZOOMS.length - 1}>+</button>
        </div>
      </div>
      {/* one scroll area: header sticks to the top, project names stick to the left */}
      <div className="gt-scroll" ref={scroller}>
        <div className="gt-canvas" style={{ width: LEFT + width }}>
          <div className="gt-headrow">
            <div className="gt-corner" style={{ width: LEFT }} />
            <div className="gt-head" style={{ width }}>
              <div className="gt-months">{months.map((m) => <div key={m.left} className="gt-month" style={{ left: m.left, width: m.w }}>{m.label}</div>)}</div>
              <div className="gt-weeks">{weekly
                ? weeks.map((w) => <div key={w.left} className={'gt-week' + (w.cur ? ' cur' : '')} style={{ left: w.left, width: 7 * px }}>{w.label}</div>)
                : months.map((m) => <div key={m.left} className={'gt-week' + (todayX >= m.left && todayX < m.left + m.w ? ' cur' : '')} style={{ left: m.left, width: m.w }}>{m.label.split(' ')[0]}</div>)}
              </div>
            </div>
          </div>
          <div className="gt-bodyrow">
            <div className="gt-left" style={{ width: LEFT }}>
              {rows.map((r) => (
                <div key={r.id} className={'gt-proj' + (reorder?.dragId === r.id ? ' gt-dragrow' : '')}
                  {...(reorder ? { onDragOver: (e: React.DragEvent) => { e.preventDefault(); reorder.over(r.id) }, onDrop: (e: React.DragEvent) => e.preventDefault() } : {})}>
                  {reorder && <Grip id={r.id} name={r.name} r={reorder} />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <span className="tag" style={{ background: SECTOR_COLOR[r.sector ?? 'internal'] }}>{r.number}</span>
                      <Link to={`/projects/${r.id}`} className="gt-name" title={r.name}>{r.name}</Link>
                    </div>
                    <div className="muted gt-sub">{r.status[0].toUpperCase() + r.status.slice(1)}{r.clients ? ` · ${r.clients.name}` : ''}</div>
                  </div>
                  <Ring pct={feeUsed[r.id] ?? null} />
                </div>))}
            </div>
            <div className="gt-grid" style={{ width, height: rows.length * 66 }}>
              {(weekly ? weeks : months).map((w) => <div key={w.left} className="gt-vline" style={{ left: w.left }} />)}
              <div className="gt-past" style={{ width: todayX }} />
              <div className="gt-today" style={{ left: todayX }} title={`Today, ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`} />
              {rows.map((r, i) => {
                const color = SECTOR_COLOR[r.sector ?? 'internal']
                const phases = r.phases.filter((p) => p.start_date && p.end_date).sort((a, b) => a.start_date!.localeCompare(b.start_date!))
                return (
                  <div key={r.id} className="gt-row" style={{ top: i * 66 }}>
                    {phases.map((p) => {
                      const saved: Dates = { start_date: p.start_date!, end_date: p.end_date! }
                      const live = p.id && drag?.id === p.id ? drag.cur : (p.id && over[p.id]) || saved
                      const s = parse(live.start_date), e = addDays(parse(live.end_date), 1)
                      const left = x(s), w = Math.max(px * 2, x(e) - left)
                      const label = `${r.number} ${p.code}`
                      const tip = `${r.number} · ${PHASE_NAME[p.code] ?? p.code} (${p.code})\n${fmt(live.start_date)} – ${fmt(live.end_date)}\n${STATUS_WORD[p.status] ?? p.status}${Number(p.fee) ? ` · ${money(p.fee)}` : ''}${onDates && p.id ? '\nDrag either end to change the dates' : ''}`
                      const dragging = !!drag && drag.id === p.id && drag.moved
                      const handle = (edge: 'start' | 'end') => p.id && onDates ? (
                        <span role="slider" tabIndex={0} className={'gt-h ' + edge} aria-label={`${label} ${edge} date`} aria-valuetext={fmt(edge === 'start' ? live.start_date : live.end_date)}
                          aria-valuenow={days(start, parse(edge === 'start' ? live.start_date : live.end_date))}
                          onPointerDown={(ev) => startDrag(ev, p.id!, edge, live)} onPointerMove={moveDrag} onPointerUp={() => endDrag(label)} onPointerCancel={() => setDrag(null)}
                          onClick={(ev) => ev.stopPropagation()}
                          onKeyDown={(ev) => { if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); ev.stopPropagation(); save(p.id!, label, live, nudge(p.id!, edge, live, ev.key === 'ArrowLeft' ? -1 : 1)) } }} />
                      ) : null
                      return (
                        <div key={p.code} className={'gt-bar st-' + p.status + (dragging ? ' dragging' : '') + (dragging && drag?.stuck ? ' stuck' : '')} style={{ left, width: w, ['--c' as string]: color }}>
                          {p.id && onDates
                            ? <span className="gt-hit movable" title={tip.replace('Drag either end to change the dates', 'Drag to move the phase; drag either end to change its length')} role="slider" tabIndex={0}
                                aria-label={`${label}: move the whole phase`} aria-valuetext={`${fmt(live.start_date)} to ${fmt(live.end_date)}`} aria-valuenow={days(start, parse(live.start_date))}
                                onPointerDown={(ev) => startDrag(ev, p.id!, 'move', live)} onPointerMove={moveDrag} onPointerUp={() => endDrag(label)} onPointerCancel={() => setDrag(null)}
                                onKeyDown={(ev) => { if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); save(p.id!, label, live, nudge(p.id!, 'move', live, ev.key === 'ArrowLeft' ? -1 : 1)) } }} />
                            : <span className="gt-hit" title={tip} role="img" aria-label={tip.replace(/\n/g, ', ')} />}
                          <span className="gt-chip">{p.code}</span>
                          {handle('start')}{handle('end')}
                          {dragging && drag && <span className={'gt-drag-tip ' + drag.edge}>{drag.edge === 'start' ? short(live.start_date) : drag.edge === 'end' ? short(live.end_date) : `${short(live.start_date)} – ${short(live.end_date)}`}
                            {drag.stuck === 'hi' && drag.lim.nextStart && <> · {drag.lim.nextCode} starts {short(drag.lim.nextStart)}</>}
                            {drag.stuck === 'lo' && drag.lim.prevEnd && <> · {drag.lim.prevCode} ends {short(drag.lim.prevEnd)}</>}</span>}
                        </div>)
                    })}
                    {showMarks && (() => {
                      // circles on the row at their dates; same-day ones sit side by side
                      const ends: Mark[] = r.phases.filter((p) => p.end_date).map((p) => ({ key: 'm' + (p.id ?? p.code), project_id: r.id, kind: 'milestone' as const,
                        title: `${PHASE_NAME[p.code] ?? p.code} complete`, date: (p.id && over[p.id]?.end_date) || p.end_date!, done: p.status === 'complete', phase_id: p.id ?? null }))
                      const mine = [...ends, ...(marks.data ?? []).filter((m) => m.project_id === r.id)].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind))
                      let prev = -1e9
                      return mine.map((m) => {
                        const d = parse(m.date)
                        // a phase's milestone hangs under the end of its bar; the rest sit on the day, side by side when they share it
                        const cx = m.kind === 'milestone' ? x(addDays(d, 1)) - 9 : Math.max(x(d) + px / 2, prev + 24); if (m.kind !== 'milestone') prev = cx
                        const ph = r.phases.find((p) => (m.phase_id && p.id === m.phase_id) || (!m.phase_id && p.start_date && p.end_date && p.start_date <= m.date && p.end_date >= m.date))
                        const late = !m.done && d < today && m.kind !== 'event' && m.kind !== 'milestone'
                        return <span key={m.key} className={`gt-mark k-${m.kind}${m.done ? ' done' : ''}${late ? ' late' : ''}`} style={{ left: cx, ['--c' as string]: color }} tabIndex={0}
                          aria-label={`${KIND_WORD[m.kind]}: ${m.title}, ${fmt(m.date)}${m.done ? ', done' : late ? ', overdue' : ''}`}>
                          <MarkIcon kind={m.kind} done={m.done} />
                          <span className="gt-mtip" role="tooltip">
                            {ph && <span className="gt-mtip-ph" style={{ background: color }}>{ph.code}</span>}
                            <strong>{m.title}</strong>
                            <span className="muted">{fmt(m.date)}{time12(m.time)}{m.who ? ` · ${m.who}` : ''}</span>
                            <span className="gt-mtip-k">{KIND_WORD[m.kind]}{m.kind !== 'event' ? (m.done ? ' · done' : late ? ' · overdue' : ' · open') : ''}</span>
                          </span>
                        </span>
                      })
                    })()}
                  </div>)
              })}
              {rows.length === 0 && <p className="muted" style={{ position: 'sticky', left: 0, padding: 20, margin: 0 }}><em>No projects match.</em></p>}
            </div>
          </div>
        </div>
      </div>
      {(undo || saveErr) && <div className="gt-status" role="status">
        {saveErr ? <span className="err">Couldn’t save the new dates: {saveErr}</span>
          : undo && <>{undo.label} now {short(undo.now.start_date)} – {fmt(undo.now.end_date)}.
            <button type="button" className="linkbtn" onClick={() => { const u = undo; setUndo(null); save(u.id, u.label, u.now, u.prev).then(() => setUndo(null)) }}>Undo</button></>}
        <button type="button" className="linkbtn" aria-label="Dismiss" onClick={() => { setUndo(null); setSaveErr('') }}>×</button>
      </div>}
      <p className="muted gt-key"><em>Bars are phase dates. Solid = in progress, light = not started, faded = complete, striped = paused. Ring = fee used (hours × rates); orange at 75%, red at 90%. Hover a bar for dates and fee. Drag a bar to move the whole phase; drag either end to change its length. Click a project’s name to open it.</em>
        {showMarks && <span className="gt-legend" style={{ ['--c' as string]: '#2b5c8a' }}>
          <span className="gt-mark k-milestone"><MarkIcon kind="milestone" done={false} /></span>Milestone (phase end)
          <span className="gt-mark k-deliverable"><MarkIcon kind="deliverable" done={false} /></span>Deliverable
          <span className="gt-mark k-task"><MarkIcon kind="task" done={false} /></span>Task
          <span className="gt-mark k-event"><MarkIcon kind="event" done={false} /></span>Event · filled = done, red = overdue</span>}</p>
    </div>
  )
}

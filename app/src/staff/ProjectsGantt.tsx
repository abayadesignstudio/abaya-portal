import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SECTOR_COLOR, PHASE_NAME, money } from '../lib/supabase'
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
/** Custom-order dragging, provided by the Projects page when Sort = Custom. */
export type Reorder = { dragId: string | null; start: (id: string) => void; over: (id: string) => void; end: () => void; step: (id: string, dir: -1 | 1) => void }
type Edge = 'start' | 'end' | 'move' // move = the whole phase, keeping its length
type Drag = { id: string; edge: Edge; x0: number; orig: Dates; cur: Dates; moved: boolean }

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
  useEffect(() => { setOver({}) }, [rows])
  const shift = (d: Dates, edge: Edge, n: number): Dates => {
    if (edge === 'move') return { start_date: isoOf(addDays(parse(d.start_date), n)), end_date: isoOf(addDays(parse(d.end_date), n)) }
    if (edge === 'start') { const s = addDays(parse(d.start_date), n); const e = parse(d.end_date); return { ...d, start_date: isoOf(s > e ? e : s) } }
    const e = addDays(parse(d.end_date), n); const s = parse(d.start_date); return { ...d, end_date: isoOf(e < s ? s : e) }
  }
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
    setDrag({ id, edge, x0: e.clientX, orig, cur: orig, moved: false })
  }
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return
    const n = Math.round((e.clientX - d.x0) / px)
    const cur = shift(d.orig, d.edge, n)
    if (cur.start_date !== d.cur.start_date || cur.end_date !== d.cur.end_date || (!d.moved && n !== 0)) setDrag({ ...d, cur, moved: d.moved || n !== 0 })
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
  return (
    <div className="gt card">
      <div className="gt-tools">
        <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>PROJECTS ({rows.length})</span>
        <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>
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
                          onKeyDown={(ev) => { if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); ev.stopPropagation(); save(p.id!, label, live, shift(live, edge, ev.key === 'ArrowLeft' ? -1 : 1)) } }} />
                      ) : null
                      return (
                        <div key={p.code} className={'gt-bar st-' + p.status + (dragging ? ' dragging' : '')} style={{ left, width: w, ['--c' as string]: color }}>
                          {p.id && onDates
                            ? <span className="gt-hit movable" title={tip.replace('Drag either end to change the dates', 'Drag to move the phase; drag either end to change its length')} role="slider" tabIndex={0}
                                aria-label={`${label}: move the whole phase`} aria-valuetext={`${fmt(live.start_date)} to ${fmt(live.end_date)}`} aria-valuenow={days(start, parse(live.start_date))}
                                onPointerDown={(ev) => startDrag(ev, p.id!, 'move', live)} onPointerMove={moveDrag} onPointerUp={() => endDrag(label)} onPointerCancel={() => setDrag(null)}
                                onKeyDown={(ev) => { if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); save(p.id!, label, live, shift(live, 'move', ev.key === 'ArrowLeft' ? -1 : 1)) } }} />
                            : <span className="gt-hit" title={tip} role="img" aria-label={tip.replace(/\n/g, ', ')} />}
                          <span className="gt-chip">{p.code}</span>
                          {handle('start')}{handle('end')}
                          {dragging && drag && <span className={'gt-drag-tip ' + drag.edge}>{drag.edge === 'start' ? short(live.start_date) : drag.edge === 'end' ? short(live.end_date) : `${short(live.start_date)} – ${short(live.end_date)}`}</span>}
                        </div>)
                    })}
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
      <p className="muted gt-key"><em>Bars are phase dates. Solid = in progress, light = not started, faded = complete, striped = paused. Ring = fee used (hours × rates); orange at 75%, red at 90%. Hover a bar for dates and fee. Drag a bar to move the whole phase; drag either end to change its length. Click a project’s name to open it.</em></p>
    </div>
  )
}

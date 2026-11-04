import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { SECTOR_COLOR, PHASE_NAME, money } from '../lib/supabase'
import './gantt.css'

// Projects as a Gantt chart (like Monograph): one row per project, one bar per phase (from its start/end dates).
// Left: project number (building-type color), name, client and fee used. Right: a scrollable week/month timeline with
// today marked. Zoom with − / + or the scale menu; "Today" scrolls back to now. Click a bar or a name to open the project.

export type GPhase = { id?: string; code: string; status: string; fee: number; start_date: string | null; end_date: string | null }
export type GRow = { id: string; number: string; name: string; status: string; sector: string | null; clients: { name: string } | null; phases: GPhase[] }

const DAY = 86400000
const LEFT = 330 // project column width (px)
const ZOOMS = [2, 3, 4.5, 7, 10, 13, 18, 26] // px per day
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY)
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

export default function ProjectsGantt({ rows, feeUsed }: { rows: GRow[]; feeUsed: Record<string, number | null> }) {
  const nav = useNavigate()
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
                <div key={r.id} className="gt-proj">
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
                      const s = parse(p.start_date!), e = addDays(parse(p.end_date!), 1)
                      const left = x(s), w = Math.max(px * 2, x(e) - left)
                      const tip = `${r.number} · ${PHASE_NAME[p.code] ?? p.code} (${p.code})\n${fmt(p.start_date!)} – ${fmt(p.end_date!)}\n${STATUS_WORD[p.status] ?? p.status}${Number(p.fee) ? ` · ${money(p.fee)}` : ''}`
                      return (
                        <button key={p.code} type="button" className={'gt-bar st-' + p.status} title={tip} aria-label={tip.replace(/\n/g, ', ')}
                          style={{ left, width: w, ['--c' as string]: color }} onClick={() => nav(`/projects/${r.id}`)}>
                          <span className="gt-chip">{p.code}</span>
                        </button>)
                    })}
                  </div>)
              })}
              {rows.length === 0 && <p className="muted" style={{ position: 'sticky', left: 0, padding: 20, margin: 0 }}><em>No projects match.</em></p>}
            </div>
          </div>
        </div>
      </div>
      <p className="muted gt-key"><em>Bars are phase dates. Solid = in progress, light = not started, faded = complete, striped = paused. Ring = fee used (hours × rates); orange at 75%, red at 90%. Hover a bar for dates and fee; click to open the project.</em></p>
    </div>
  )
}

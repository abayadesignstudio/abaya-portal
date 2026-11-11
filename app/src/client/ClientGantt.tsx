import { PHASES, PHASE_NAME, phaseLabel } from '../lib/supabase'
import { PHASE_STYLE, BAR_COLOR, fmtDate, type PhaseRow } from '../lib/projectContent'
import MarkIcon from '../components/MarkIcon'

export type ClientMark = { id: string; kind: 'milestone' | 'deliverable'; phase_id: string | null; title: string; date: string; done: boolean }

/** Client view of the schedule: one row per phase in the contract, bars on a month timeline, today marked.
 *  Phases without dates yet show "Dates to come"; phases not in the contract are listed faintly at the end. */
export default function ClientGantt({ phases, marks = [] }: { phases: PhaseRow[]; marks?: ClientMark[] }) {
  const by = Object.fromEntries(phases.map((p) => [p.code, p]))
  const rows = [...(PHASES.map(([code]) => by[code]).filter(Boolean) as PhaseRow[]), ...phases.filter((p) => p.code === 'CU')] // custom phases after the standard ones
  const notIn = PHASES.filter(([code]) => !by[code]).map(([code]) => code)
  const t = (s: string) => new Date(s + 'T12:00:00').getTime()
  const dated = rows.filter((p) => p.start_date && p.end_date)
  const now = Date.now()
  const rowIds = new Set(rows.map((p) => p.id))
  const loose = marks.filter((m) => !m.phase_id || !rowIds.has(m.phase_id)) // not tied to a phase on this chart: own row
  let min = 0, max = 0, months: { at: number; label: string }[] = []
  if (dated.length || marks.length) {
    const lo = new Date(Math.min(...dated.map((p) => t(p.start_date!)), ...marks.map((m) => t(m.date)))), hi = new Date(Math.max(...dated.map((p) => t(p.end_date!)), ...marks.map((m) => t(m.date))))
    const a = new Date(lo.getFullYear(), lo.getMonth(), 1), b = new Date(hi.getFullYear(), hi.getMonth() + 1, 1)
    min = a.getTime(); max = b.getTime()
    const n = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth()
    const step = n > 24 ? 3 : n > 12 ? 2 : 1 // keep the header readable on long projects
    for (let i = 0; i < n; i += step) {
      const d = new Date(a.getFullYear(), a.getMonth() + i, 1)
      months.push({ at: d.getTime(), label: d.toLocaleDateString('en-US', { month: 'short', ...(d.getMonth() === 0 || i === 0 ? { year: '2-digit' } : {}) }) })
    }
  }
  const pct = (ms: number) => ((ms - min) / (max - min)) * 100
  const todayIn = (dated.length > 0 || marks.length > 0) && now >= min && now <= max
  const markEls = (list: ClientMark[]) => list.map((m) => <span key={m.kind + m.id} className={`cg-mark k-${m.kind}` + (m.done ? ' done' : '')} style={{ left: `${pct(t(m.date) + 432e5)}%` }}
    tabIndex={0} title={`${m.kind === 'milestone' ? 'Milestone' : 'Deliverable'}: ${m.title} · ${fmtDate(m.date)}${m.done ? ' (done)' : ''}`} aria-label={`${m.kind}: ${m.title}, ${fmtDate(m.date)}${m.done ? ', done' : ''}`}>
    <MarkIcon kind={m.kind} done={m.done} size={20} /></span>)

  if (!rows.length) return <p className="muted" style={{ margin: 0 }}><em>The schedule will appear here once it’s set.</em></p>
  return (
    <div className="cg">
      <div className="cg-head">
        <span />
        <div className="cg-axis">{months.map((m) => <span key={m.at} style={{ left: `${pct(m.at)}%` }}>{m.label}</span>)}
          {todayIn && <span className="cg-today-lbl" style={{ left: `${pct(now)}%` }}>Today</span>}</div>
      </div>
      {rows.map((p) => {
        const st = PHASE_STYLE[p.status] ?? PHASE_STYLE.not_started
        const has = p.start_date && p.end_date && dated.length
        return (
          <div key={p.id} className="cg-row">
            <div className="cg-lbl">
              <span className="cg-code" style={{ background: st.bg, color: st.fg, borderColor: st.border }}>{p.code === 'CU' ? '•' : p.code}</span>
              <span className="cg-name"><strong>{phaseLabel(p)}</strong>
                <span className="muted">{has ? `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}` : 'Dates to come'} · {st.label}</span></span>
            </div>
            <div className="cg-track">
              {months.map((m) => <span key={m.at} className="cg-grid" style={{ left: `${pct(m.at)}%` }} />)}
              {has && <span className={'cg-bar ' + p.status} title={`${phaseLabel(p)}: ${fmtDate(p.start_date)} – ${fmtDate(p.end_date)} (${st.label})`}
                style={{ left: `${pct(t(p.start_date!))}%`, width: `${Math.max(1.2, pct(t(p.end_date!) + 864e5) - pct(t(p.start_date!)))}%`, background: p.status === 'not_started' ? '#fff' : BAR_COLOR[p.status], borderColor: p.status === 'not_started' ? '#98a2b3' : BAR_COLOR[p.status] }} />}
              {markEls(marks.filter((m) => m.phase_id === p.id))}
              {todayIn && <span className="cg-today" style={{ left: `${pct(now)}%` }} />}
            </div>
          </div>)
      })}
      {loose.length > 0 && <div className="cg-row">
        <div className="cg-lbl"><span className="cg-code" style={{ background: '#fff', color: '#475467', borderColor: '#d0d5dd' }}>★</span>
          <span className="cg-name"><strong>Milestones &amp; deliverables</strong><span className="muted">{loose.length} on the schedule</span></span></div>
        <div className="cg-track">{months.map((m) => <span key={m.at} className="cg-grid" style={{ left: `${pct(m.at)}%` }} />)}
          {markEls(loose)}{todayIn && <span className="cg-today" style={{ left: `${pct(now)}%` }} />}</div>
      </div>}
      <p className="muted cg-note"><em>Bars are phase dates. Green = in progress, grey = complete, red = paused, dashed outline = not started. The navy line marks today. Hover a bar or icon for its dates.</em></p>
      <p className="muted cg-key">
        <span><span className="cg-mark k-milestone in-key"><MarkIcon kind="milestone" done={false} size={18} /></span>Milestone</span>
        <span><span className="cg-mark k-deliverable in-key"><MarkIcon kind="deliverable" done={false} size={18} /></span>Deliverable</span>
        <span>· filled = done</span>
        <span><i style={{ background: BAR_COLOR.complete }} />Complete</span><span><i style={{ background: BAR_COLOR.in_progress }} />In progress</span>
        <span><i style={{ background: BAR_COLOR.paused }} />Paused</span><span><i style={{ background: '#fff', border: '1px solid #98a2b3' }} />Not started</span>
        <span><i style={{ background: 'var(--navy)', width: 2 }} />Today</span>
        {notIn.length > 0 && <span className="cg-notin">Not in your contract: {notIn.map((c) => PHASE_NAME[c]).join(', ')}</span>}
      </p>
    </div>
  )
}

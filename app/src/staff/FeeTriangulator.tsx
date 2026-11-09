import { useEffect, useMemo, useState } from 'react'
import { supabase, money } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import './fee-tri.css'

/** Proposal fee triangulator: three independent ways to price a job, one per corner of a triangle,
 *  with the median of the fees that have been filled in shown in the middle.
 *  Inputs are kept on this device so they're still there when you come back. */

type Person = { id: string; full_name: string | null; bill_rate: number | null }
type HourRow = { key: string; profile_id: string; hours: string; rate: string }
type State = { rows: HourRow[]; sf: string; perSf: string; costPerSf: string; pct: string }

const KEY = 'abaya.feeTriangulator'
const newRow = (): HourRow => ({ key: Math.random().toString(36).slice(2), profile_id: '', hours: '', rate: '' })
const EMPTY: State = { rows: [newRow()], sf: '', perSf: '', costPerSf: '', pct: '' }
const load = (): State => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && Array.isArray(s.rows) ? { ...EMPTY, ...s } : EMPTY } catch { return EMPTY } }
const num = (s: string) => { const n = parseFloat(String(s).replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : 0 }
const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 }
const vsMedian = (v: number, m: number) => { if (!m || !v) return ''; const d = (v - m) / m * 100; return Math.abs(d) < 0.5 ? 'at median' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}% vs median` }

export default function FeeTriangulator() {
  const people = useLoad(async () => must(await supabase.from('profiles').select('id, full_name, bill_rate').in('role', ['admin', 'staff']).order('full_name')) as Person[])
  const [s, setS] = useState<State>(load)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ } }, [s])
  const set = (patch: Partial<State>) => setS((o) => ({ ...o, ...patch }))
  const setRow = (key: string, patch: Partial<HourRow>) => setS((o) => ({ ...o, rows: o.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }))
  const pickPerson = (key: string, id: string) => {
    const p = people.data?.find((x) => x.id === id)
    setRow(key, { profile_id: id, rate: p?.bill_rate != null ? String(Number(p.bill_rate)) : '' })
  }

  const hourly = s.rows.reduce((a, r) => a + num(r.hours) * num(r.rate), 0)
  const hours = s.rows.reduce((a, r) => a + num(r.hours), 0)
  const bySf = num(s.sf) * num(s.perSf)
  // construction cost = area × construction cost per SF (the area is shared with corner 2)
  const cost = num(s.sf) * num(s.costPerSf)
  const byPct = cost * num(s.pct) / 100
  const fees = [hourly, bySf, byPct]
  const filled = fees.filter((f) => f > 0)
  const med = filled.length ? median(filled) : 0
  const lo = filled.length ? Math.min(...filled) : 0, hi = filled.length ? Math.max(...filled) : 0
  const spread = med && filled.length > 1 ? (hi - lo) / med * 100 : 0

  // the triangle: corners in SVG units (viewBox 0 0 300 260)
  const V = useMemo(() => [{ x: 150, y: 18 }, { x: 22, y: 242 }, { x: 278, y: 242 }], [])
  const C = { x: 150, y: (18 + 242 + 242) / 3 }

  return (
    <section className="card pad ft" aria-labelledby="ft-h">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <h2 id="ft-h" style={{ margin: 0 }}>Fee triangulator</h2>
        <button type="button" className="linkbtn" onClick={() => setS({ ...EMPTY, rows: [newRow()] })}>Clear</button>
      </div>
      <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>Price the job three ways. The middle shows the median of the methods you fill in.</p>

      <div className="ft-grid">
        {/* top corner: hourly */}
        <fieldset className="ft-corner ft-top">
          <legend><span className="ft-dot" aria-hidden="true">1</span>Hourly</legend>
          <div className="ft-hrs">
            <div className="ft-hrs-h" aria-hidden="true"><span>Employee</span><span>Hours</span><span>Rate</span><span>Amount</span><span /></div>
            {s.rows.map((r, i) => (
              <div className="ft-hrs-r" key={r.key}>
                <label className="sr" htmlFor={`ft-p-${r.key}`}>Employee {i + 1}</label>
                <select id={`ft-p-${r.key}`} className="input" value={r.profile_id} onChange={(e) => pickPerson(r.key, e.target.value)}>
                  <option value="">Employee…</option>
                  {people.data?.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? 'Unnamed'}</option>)}
                </select>
                <label className="sr" htmlFor={`ft-h-${r.key}`}>Projected hours</label>
                <input id={`ft-h-${r.key}`} className="input num" inputMode="decimal" placeholder="0" value={r.hours} onChange={(e) => setRow(r.key, { hours: e.target.value })} />
                <label className="sr" htmlFor={`ft-r-${r.key}`}>Hourly rate</label>
                <input id={`ft-r-${r.key}`} className="input num" inputMode="decimal" placeholder="$/hr" value={r.rate} onChange={(e) => setRow(r.key, { rate: e.target.value })} />
                <span className="num ft-amt">{money(num(r.hours) * num(r.rate))}</span>
                <button type="button" className="ft-x" aria-label={`Remove employee ${i + 1}`} disabled={s.rows.length === 1 && !r.profile_id && !r.hours}
                  onClick={() => setS((o) => ({ ...o, rows: o.rows.length > 1 ? o.rows.filter((x) => x.key !== r.key) : [newRow()] }))}>×</button>
              </div>))}
          </div>
          <div className="row between" style={{ marginTop: 8 }}>
            <button type="button" className="btn small secondary" onClick={() => set({ rows: [...s.rows, newRow()] })}>+ Add employee</button>
            <span className="muted num" style={{ fontSize: 13 }}>{hours ? `${hours.toLocaleString()} h` : ''}</span>
          </div>
          <p className="ft-fee"><span className="num">{hourly ? money(hourly) : '—'}</span><small>{vsMedian(hourly, med)}</small></p>
        </fieldset>

        {/* the triangle */}
        <div className="ft-tri">
          <svg viewBox="0 0 300 260" role="img" aria-label={med ? `Median fee ${money(med)}` : 'Fill in at least one method to see the median fee'}>
            <polygon points={V.map((p) => `${p.x},${p.y}`).join(' ')} fill="#f6f5f2" stroke="#02253d" strokeWidth="2" strokeLinejoin="round" />
            {V.map((p, i) => <line key={i} x1={p.x} y1={p.y} x2={C.x} y2={C.y} stroke="#cfc9bd" strokeDasharray="3 4" />)}
            {V.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r="15" fill={fees[i] > 0 ? '#02253d' : '#fff'} stroke="#02253d" strokeWidth="2" />
                <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill={fees[i] > 0 ? '#fff' : '#02253d'}>{i + 1}</text>
              </g>))}
          </svg>
          <div className="ft-center" aria-live="polite">
            <span className="ft-center-l">Median fee</span>
            <strong className="num">{med ? money(med) : '—'}</strong>
            {filled.length > 1 && <span className="ft-center-s num">Range {money(lo)} – {money(hi)}<br />{spread.toFixed(0)}% spread</span>}
            {filled.length === 1 && <span className="ft-center-s">Only one method filled in</span>}
          </div>
        </div>

        {/* bottom-left corner: price per square foot */}
        <fieldset className="ft-corner ft-bl">
          <legend><span className="ft-dot" aria-hidden="true">2</span>Price per square foot</legend>
          <div className="ft-pair">
            <div><label className="l" htmlFor="ft-sf">Area (SF)</label>
              <input id="ft-sf" className="input num" inputMode="decimal" placeholder="0" value={s.sf} onChange={(e) => set({ sf: e.target.value })} /></div>
            <div><label className="l" htmlFor="ft-psf">Fee per SF ($)</label>
              <input id="ft-psf" className="input num" inputMode="decimal" placeholder="0.00" value={s.perSf} onChange={(e) => set({ perSf: e.target.value })} /></div>
          </div>
          <p className="ft-fee"><span className="num">{bySf ? money(bySf) : '—'}</span><small>{vsMedian(bySf, med)}</small></p>
        </fieldset>

        {/* bottom-right corner: percent of construction cost */}
        <fieldset className="ft-corner ft-br">
          <legend><span className="ft-dot" aria-hidden="true">3</span>Percent of construction cost</legend>
          <div className="ft-trio">
            <div><label className="l" htmlFor="ft-sf3">Area (SF)</label>
              <input id="ft-sf3" className="input num" inputMode="decimal" placeholder="0" value={s.sf} onChange={(e) => set({ sf: e.target.value })} aria-describedby="ft-sf3-h" /></div>
            <div><label className="l" htmlFor="ft-cpsf">Cost per SF ($)</label>
              <input id="ft-cpsf" className="input num" inputMode="decimal" placeholder="0.00" value={s.costPerSf} onChange={(e) => set({ costPerSf: e.target.value })} /></div>
            <div><label className="l" htmlFor="ft-pct">Fee (%)</label>
              <input id="ft-pct" className="input num" inputMode="decimal" placeholder="0.0" value={s.pct} onChange={(e) => set({ pct: e.target.value })} /></div>
          </div>
          <p id="ft-sf3-h" className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            {cost > 0 ? <>Construction cost: <span className="num">{num(s.sf).toLocaleString()} SF × {money(num(s.costPerSf))}/SF = <strong>{money(cost)}</strong></span></> : 'Same area as corner 2; changing it here changes it there.'}</p>
          <p className="ft-fee"><span className="num">{byPct ? money(byPct) : '—'}</span><small>{vsMedian(byPct, med)}</small></p>
        </fieldset>
      </div>
    </section>
  )
}

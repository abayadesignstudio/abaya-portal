import { useEffect, useMemo, useState } from 'react'
import RowMenu from '../components/RowMenu'
import { supabase, money, PHASES } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import './fee-tri.css'

/** Proposal fee triangulator: three independent ways to price a job, one per corner of a triangle,
 *  with the average (mean) of the fees that have been filled in shown in the middle.
 *  Inputs are kept on this device so they're still there when you come back. */

type Person = { id: string; full_name: string | null; bill_rate: number | null }
type HourRow = { key: string; profile_id: string; hours: string; rate: string }
type Saved = { id: string; name: string; inputs: State; median_fee: number | null; hourly_fee: number | null; sf_fee: number | null; pct_fee: number | null; created_at: string; updated_at: string }
type State = { rows: HourRow[]; sf: string; perSf: string; costPerSf: string; pct: string; split: Record<string, string> }

const KEY = 'abaya.feeTriangulator'
const newRow = (): HourRow => ({ key: Math.random().toString(36).slice(2), profile_id: '', hours: '', rate: '' })
/** Starting split of the fee across phases (AIA-style); 0 leaves a phase out. */
const DEFAULT_SPLIT: Record<string, string> = { CE: '0', SD: '15', DD: '20', CD: '40', BN: '5', PM: '0', CA: '20' }
const EMPTY: State = { rows: [newRow()], sf: '', perSf: '', costPerSf: '', pct: '', split: DEFAULT_SPLIT }
const load = (): State => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && Array.isArray(s.rows) ? { ...EMPTY, ...s, split: { ...DEFAULT_SPLIT, ...(s.split ?? {}) } } : EMPTY } catch { return EMPTY } }
const num = (s: string) => { const n = parseFloat(String(s).replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : 0 }
const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 }
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
const vsAvg = (v: number, m: number) => { if (!m || !v) return ''; const d = (v - m) / m * 100; return Math.abs(d) < 0.5 ? 'at average' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}% vs average` }
/** A saved fee's average, from the three method fees stored with it. */
const savedAvg = (x: { hourly_fee: number | null; sf_fee: number | null; pct_fee: number | null }) => mean([x.hourly_fee, x.sf_fee, x.pct_fee].map(Number).filter((v) => v > 0))

/** What the triangulator hands to "New proposal": the fee, the area and the phase split. */
export type FeeSeed = { name: string; fee: number; sf: number; split: [string, number][] }

export default function FeeTriangulator({ onCreateAgreement }: { onCreateAgreement: (seed: FeeSeed) => void }) {
  const people = useLoad(async () => must(await supabase.from('profiles').select('id, full_name, bill_rate').in('role', ['admin', 'staff']).order('full_name')) as Person[])
  const [s, setS] = useState<State>(load)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ } }, [s])
  const set = (patch: Partial<State>) => setS((o) => ({ ...o, ...patch }))
  // saved triangulations (firm-wide, in the database), listed by year on the right
  const saved = useLoad(async () => must(await supabase.from('fee_estimates').select('id, name, inputs, median_fee, hourly_fee, sf_fee, pct_fee, created_at, updated_at').order('created_at', { ascending: false })) as Saved[])
  const [cur, setCur] = useState<{ id: string; name: string } | null>(() => { try { return JSON.parse(localStorage.getItem(KEY + '.cur') || 'null') } catch { return null } })
  useEffect(() => { try { localStorage.setItem(KEY + '.cur', JSON.stringify(cur)) } catch { /* private mode */ } }, [cur])
  const [name, setName] = useState(cur?.name ?? '')
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3000); return () => clearTimeout(t) }, [msg])
  const years = useMemo(() => [...new Set((saved.data ?? []).map((x) => new Date(x.created_at).getFullYear()))].sort((a, b) => b - a), [saved.data])
  const [year, setYear] = useState<number | null>(null)
  const shownYear = year ?? years[0] ?? new Date().getFullYear()
  const inYear = (saved.data ?? []).filter((x) => new Date(x.created_at).getFullYear() === shownYear)
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
  const avg = mean(filled)
  const lo = filled.length ? Math.min(...filled) : 0, hi = filled.length ? Math.max(...filled) : 0
  const spread = avg && filled.length > 1 ? (hi - lo) / avg * 100 : 0

  // the triangle: corners in SVG units (viewBox 0 0 300 260)
  const V = useMemo(() => [{ x: 150, y: 18 }, { x: 22, y: 242 }, { x: 278, y: 242 }], [])
  const C = { x: 150, y: (18 + 242 + 242) / 3 }

  // phase split of the average fee
  const splitPct = PHASES.map(([c]) => [c, num(s.split[c] ?? '0')] as const)
  const splitTotal = splitPct.reduce((a, [, v]) => a + v, 0)
  const setSplit = (c: string, v: string) => setS((o) => ({ ...o, split: { ...o.split, [c]: v } }))
  // Create agreement: hands the average fee, the area and the phase split to the New proposal card below,
  // where the project is chosen (every agreement belongs to a project); the rest is filled in on the agreement.
  const splitOk = Math.abs(splitTotal - 100) < 0.01
  const createAgreement = () => {
    if (!avg) return setErr('Fill in at least one fee method first.')
    if (!splitOk) return setErr('The phase percentages need to add up to 100% before creating an agreement.')
    setErr('')
    onCreateAgreement({ name: name.trim(), fee: Math.round(avg), sf: num(s.sf), split: splitPct.filter(([, v]) => v > 0).map(([c, v]) => [c, v]) })
  }
  const payload = () => ({ name: name.trim(), inputs: s, hourly_fee: hourly || null, sf_fee: bySf || null, pct_fee: byPct || null, median_fee: med || null, updated_at: new Date().toISOString() })
  const saveNew = async () => {
    if (!name.trim()) return setErr('Give this fee a name first.')
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('fee_estimates').insert(payload()).select('id, name, created_at').single()
    setBusy(false)
    if (error) return setErr(error.message)
    setCur({ id: data.id, name: data.name }); setYear(new Date(data.created_at).getFullYear()); setMsg('Saved.'); saved.reload()
  }
  const update = async () => {
    if (!cur) return saveNew()
    if (!name.trim()) return setErr('Give this fee a name first.')
    setBusy(true); setErr('')
    const { error } = await supabase.from('fee_estimates').update(payload()).eq('id', cur.id)
    setBusy(false)
    if (error) return setErr(error.message)
    setCur({ id: cur.id, name: name.trim() }); setMsg('Saved.'); saved.reload()
  }
  const open = (x: Saved) => { setS({ ...EMPTY, ...x.inputs, split: { ...DEFAULT_SPLIT, ...(x.inputs.split ?? {}) }, rows: (x.inputs.rows?.length ? x.inputs.rows : [newRow()]).map((r) => ({ ...r, key: r.key || newRow().key })) }); setCur({ id: x.id, name: x.name }); setName(x.name); setErr(''); setMsg('') }
  const startNew = () => { setS((o) => ({ ...EMPTY, rows: [newRow()], split: o.split })); setCur(null); setName(''); setErr(''); setMsg('') }
  const rename = async (x: Saved) => {
    const n = window.prompt('Rename this fee', x.name)?.trim(); if (!n || n === x.name) return
    const { error } = await supabase.from('fee_estimates').update({ name: n }).eq('id', x.id)
    if (error) return setErr(error.message)
    if (cur?.id === x.id) { setCur({ id: x.id, name: n }); setName(n) }
    saved.reload()
  }
  const remove = async (x: Saved) => {
    if (!window.confirm(`Delete “${x.name}”? This can’t be undone.`)) return
    const { error } = await supabase.from('fee_estimates').delete().eq('id', x.id)
    if (error) return setErr(error.message)
    if (cur?.id === x.id) setCur(null)
    saved.reload()
  }
  const fmtD = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <section className="card pad ft" aria-labelledby="ft-h">
      <div className="ft-layout">
      <div className="ft-main">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <h2 id="ft-h" style={{ margin: 0 }}>Fee triangulator</h2>
        <button type="button" className="linkbtn" onClick={startNew}>New / clear</button>
      </div>
      <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>Price the job three ways. The middle shows the average of the methods you fill in.</p>
      <div className="ft-save">
        <label className="sr" htmlFor="ft-name">Fee name</label>
        <input id="ft-name" className="input" placeholder="Name this fee, e.g. Diamond Block — Phase 1" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (cur ? update : saveNew)() }} />
        {cur ? <>
          <button type="button" className="btn" disabled={busy} onClick={update}>Save</button>
          <button type="button" className="btn secondary" disabled={busy} onClick={saveNew} title="Keep the original and save these inputs under the name above">Save as new</button>
        </> : <button type="button" className="btn" disabled={busy} onClick={saveNew}>Save fee</button>}
      </div>
      {cur && <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>Editing saved fee <strong>{cur.name}</strong>. Save updates it; Save as new keeps both.</p>}
      {msg && <p className="ok" role="status" style={{ margin: '8px 0 0' }}>{msg}</p>}
      {err && <p className="err" role="alert" style={{ margin: '8px 0 0' }}>{err}</p>}

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
                <RowMenu label={`Actions for employee ${i + 1}`} items={[{ label: 'Remove', danger: true, disabled: s.rows.length === 1 && !r.profile_id && !r.hours,
                  onSelect: () => setS((o) => ({ ...o, rows: o.rows.length > 1 ? o.rows.filter((x) => x.key !== r.key) : [newRow()] })) }]} />
              </div>))}
          </div>
          <div className="row between" style={{ marginTop: 8 }}>
            <button type="button" className="btn small secondary" onClick={() => set({ rows: [...s.rows, newRow()] })}>+ Add employee</button>
            <span className="muted num" style={{ fontSize: 13 }}>{hours ? `${hours.toLocaleString()} h` : ''}</span>
          </div>
          <p className="ft-fee"><span className="num">{hourly ? money(hourly) : '—'}</span><small>{vsAvg(hourly, avg)}</small></p>
        </fieldset>

        {/* the triangle */}
        <div className="ft-tri">
          <svg viewBox="0 0 300 260" role="img" aria-label={avg ? `Average fee ${money(avg)}` : 'Fill in at least one method to see the average fee'}>
            <polygon points={V.map((p) => `${p.x},${p.y}`).join(' ')} fill="#f6f5f2" stroke="#02253d" strokeWidth="2" strokeLinejoin="round" />
            {V.map((p, i) => <line key={i} x1={p.x} y1={p.y} x2={C.x} y2={C.y} stroke="#cfc9bd" strokeDasharray="3 4" />)}
            {V.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r="15" fill={fees[i] > 0 ? '#02253d' : '#fff'} stroke="#02253d" strokeWidth="2" />
                <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill={fees[i] > 0 ? '#fff' : '#02253d'}>{i + 1}</text>
              </g>))}
          </svg>
          <div className="ft-center" aria-live="polite">
            <span className="ft-center-l">Average fee</span>
            <strong className="num">{avg ? money(avg) : '—'}</strong>
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
          <p className="ft-fee"><span className="num">{bySf ? money(bySf) : '—'}</span><small>{vsAvg(bySf, avg)}</small></p>
        </fieldset>

        {/* bottom-right corner: percent of construction cost */}
        <fieldset className="ft-corner ft-br">
          <legend><span className="ft-dot" aria-hidden="true">3</span>Percent of construction cost</legend>
          <div className="ft-pair">
            <div><label className="l" htmlFor="ft-cpsf">Construction cost per SF ($)</label>
              <input id="ft-cpsf" aria-describedby="ft-sf3-h" className="input num" inputMode="decimal" placeholder="0.00" value={s.costPerSf} onChange={(e) => set({ costPerSf: e.target.value })} /></div>
            <div><label className="l" htmlFor="ft-pct">Fee (%)</label>
              <input id="ft-pct" className="input num" inputMode="decimal" placeholder="0.0" value={s.pct} onChange={(e) => set({ pct: e.target.value })} /></div>
          </div>
          <p id="ft-sf3-h" className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            {cost > 0 ? <>Construction cost: <span className="num">{num(s.sf).toLocaleString()} SF × {money(num(s.costPerSf))}/SF = <strong>{money(cost)}</strong></span></>
              : num(s.sf) > 0 ? <>Uses the area from corner 2: <span className="num">{num(s.sf).toLocaleString()} SF</span>.</> : 'Uses the area from corner 2. Enter it there.'}</p>
          <p className="ft-fee"><span className="num">{byPct ? money(byPct) : '—'}</span><small>{vsAvg(byPct, avg)}</small></p>
        </fieldset>
      </div>
      </div>

      <aside className="ft-split" aria-labelledby="ft-split-h">
        <h3 id="ft-split-h">Fee by phase</h3>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Spreads the average fee{avg ? <> of <strong className="num">{money(avg)}</strong></> : ''} across phases. Set a phase to 0% to leave it out.</p>
        <table className="ft-split-t">
          <thead><tr><th scope="col">Phase</th><th scope="col">%</th><th scope="col">Fee</th></tr></thead>
          <tbody>
            {PHASES.map(([c, n]) => {
              const v = num(s.split[c] ?? '0')
              return (
                <tr key={c} className={v > 0 ? '' : 'off'}>
                  <th scope="row" title={n}><span className="ft-ph">{c}</span><span className="ft-ph-n">{n}</span></th>
                  <td><label className="sr" htmlFor={`ft-sp-${c}`}>{n} percent</label>
                    <input id={`ft-sp-${c}`} className="input num" inputMode="decimal" value={s.split[c] ?? ''} placeholder="0" onChange={(e) => setSplit(c, e.target.value)} /></td>
                  <td className="num">{avg && v ? money(Math.round(avg * v / 100)) : '—'}</td>
                </tr>)
            })}
          </tbody>
          <tfoot><tr className={Math.abs(splitTotal - 100) < 0.01 ? '' : 'warn'}>
            <th scope="row">Total</th><td className="num">{splitTotal.toLocaleString()}%</td><td className="num">{avg ? money(Math.round(avg * splitTotal / 100)) : '—'}</td>
          </tr></tfoot>
        </table>
        {Math.abs(splitTotal - 100) >= 0.01 && <p className="ft-split-w" role="status">{splitTotal < 100 ? `${(100 - splitTotal).toLocaleString()}% (${money(avg * (100 - splitTotal) / 100)}) isn’t assigned to a phase.` : `Over by ${(splitTotal - 100).toLocaleString()}%. The phases add up to more than the fee.`}</p>}
        <button type="button" className="linkbtn" style={{ marginTop: 8 }} onClick={() => set({ split: DEFAULT_SPLIT })}>Reset to 15 / 20 / 40 / 5 / 20</button>
        <button type="button" className="btn ft-create" disabled={!avg || !splitOk} onClick={createAgreement}
          title={!avg ? 'Fill in at least one fee method first' : !splitOk ? 'Phase percentages must add up to 100%' : 'Start a draft agreement with this fee and phase split'}>
          Create agreement</button>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>Carries the {avg ? money(Math.round(avg)) : 'average'} fee, these phases and one payment per phase into a new agreement. Pick the project below, then fill in the rest on the agreement.</p>
      </aside>

      <aside className="ft-list" aria-labelledby="ft-list-h">
        <h3 id="ft-list-h">Saved fees</h3>
        {years.length > 0 && <div className="ft-years" role="group" aria-label="Year">
          {years.map((y) => <button key={y} type="button" className="chip" aria-pressed={y === shownYear} onClick={() => setYear(y)}>{y}</button>)}
        </div>}
        {saved.error && <p className="err" style={{ fontSize: 13 }}>{saved.error}</p>}
        {saved.data && inYear.length === 0 && <p className="muted" style={{ fontSize: 14, margin: '8px 0 0' }}>{years.length ? `No fees saved in ${shownYear}.` : 'Nothing saved yet. Name a fee and click Save fee.'}</p>}
        <ul>
          {inYear.map((x) => (
            <li key={x.id} className={cur?.id === x.id ? 'on' : ''}>
              <button type="button" className="ft-item" onClick={() => open(x)} aria-current={cur?.id === x.id ? 'true' : undefined} title="Open these inputs in the triangulator">
                <span className="ft-item-n">{x.name}</span>
                <span className="ft-item-m"><span>{fmtD(x.created_at)}</span><span className="num">{savedAvg(x) ? money(savedAvg(x)) : '—'}</span></span>
              </button>
              <RowMenu label={`Actions for ${x.name}`} items={[{ label: 'Open', onSelect: () => open(x) }, { label: 'Rename…', onSelect: () => rename(x) }, 'divider', { label: 'Delete', danger: true, onSelect: () => remove(x) }]} />
            </li>))}
        </ul>
      </aside>
      </div>
    </section>
  )
}

import { useMemo } from 'react'
import RowMenu from '../components/RowMenu'
import { money, PHASES } from '../lib/supabase'
import { useFeeCalc, newRow, num, vsAvg, savedAvg, DEFAULT_SPLIT } from '../lib/useFeeCalc'
import './fee-tri.css'

/** Proposal fee triangulator: three independent ways to price a job, one per corner of a triangle,
 *  with the average (mean) of the fees that have been filled in shown in the middle. State and autosave live in useFeeCalc. */

/** What the triangulator hands to "New proposal": the fee, the area and the phase split. */
export type { FeeSeed } from '../lib/feeSeed'
import type { FeeSeed } from '../lib/feeSeed'

export default function FeeTriangulator({ onCreateAgreement }: { onCreateAgreement: (seed: FeeSeed) => void }) {
  const F = useFeeCalc()
  const { people, s, setS, set, projects, saved, cur, name, setName, msg, err, setErr, busy, saveState, years, shownYear, setYear, inYear, setRow, pickPerson,
    hourly, hours, bySf, cost, byPct, fees, filled, avg, lo, hi, spread, splitTotal, setSplit, splitOk, flush, saveNew, open, startNew, rename, remove, fmtD } = F
  const createAgreement = () => { const sd = F.seed(); if (typeof sd === 'string') return setErr(sd); setErr(''); onCreateAgreement(sd) }
  // the triangle: corners in SVG units (viewBox 0 0 300 260)
  const V = useMemo(() => [{ x: 150, y: 18 }, { x: 22, y: 242 }, { x: 278, y: 242 }], [])
  const C = { x: 150, y: (18 + 242 + 242) / 3 }


  return (
    <section className="card pad ft" aria-labelledby="ft-h">
      <div className="ft-layout">
      <div className="ft-main">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <h2 id="ft-h" style={{ margin: 0 }}>Fee triangulator</h2>
        <button type="button" className="btn secondary small" onClick={startNew} title="Start a blank fee. Saved fees stay in the list.">+ New</button>
      </div>
      <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>Price the job three ways. The middle shows the average of the methods you fill in.</p>
      <div className="ft-save">
        <label className="sr" htmlFor="ft-name">Fee name</label>
        <input id="ft-name" className="input" placeholder="Name this fee, e.g. Diamond Block — Phase 1" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void flush() }} />
        <label className="sr" htmlFor="ft-proj">Project</label>
        <select id="ft-proj" className="input" style={{ maxWidth: 260 }} value={s.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value })} title="The project this fee is for. It stays scratch work until you create or update the project's agreement.">
          <option value="">No project yet</option>
          {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</select>
        {cur && <button type="button" className="btn secondary" disabled={busy} onClick={saveNew} title="Save a separate copy of these inputs; the original stays as it was">Save as copy</button>}
        <span className="muted" role="status" style={{ fontSize: 13, alignSelf: 'center' }}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : ''}</span>
      </div>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>{cur ? <>Editing <strong>{cur.name}</strong>. Changes save automatically.</> : 'Start typing and this calculation saves itself to Saved fees. Name it any time.'}</p>
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
          Create or update agreement</button>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>Carries the {avg ? money(Math.round(avg)) : 'average'} fee, these phases and one payment per phase into the project’s agreement: a new one, or its draft if it has one (each project has one agreement). The project’s phases then follow it. A signed agreement can’t take a new fee; use Change fee on the project.</p>
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
                <span className="ft-item-m"><span>{(() => { const pr = projects.data?.find((p) => p.id === (x.project_id ?? x.inputs.projectId)); return pr ? `${pr.number} · ` : '' })()}{fmtD(x.created_at)}</span><span className="num">{savedAvg(x) ? money(savedAvg(x)) : '—'}</span></span>
              </button>
              <RowMenu label={`Actions for ${x.name}`} items={[{ label: 'Open', onSelect: () => open(x) }, { label: 'Rename…', onSelect: () => rename(x) }, 'divider', { label: 'Delete', danger: true, onSelect: () => remove(x) }]} />
            </li>))}
        </ul>
      </aside>
      </div>
    </section>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, money, PHASES } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/useQuery'
import { useFeeCalc, newRow, num, vsAvg, savedAvg, DEFAULT_SPLIT, type FeeCalc } from '../lib/useFeeCalc'
import { applyFeeToProject } from '../lib/applyFee'
import RowMenu from '../components/RowMenu'

/** Phone fee calculator: the desktop triangulator laid out for a phone. The triangle becomes a range line,
 *  each method opens in a bottom sheet, and the phase split has its own sheet. Same saved fees as the desktop. */

const PH_COLOR: Record<string, string> = { CE: '#8a6d3b', SD: '#2b5c8a', DD: '#4f86b8', CD: '#02253d', BN: '#a37b2c', PM: '#6b7280', CA: '#2e7d4f' }
/** Whole dollars: cents are noise at proposal scale. */
const usd = (n: number) => money(Math.round(n)).replace(/\.00$/, '')
const METHODS = ['Hourly', 'Price per SF', '% of construction'] as const
type Sheet = null | 'saved' | 'phases' | { m: 0 | 1 | 2 }

export default function FeeCalcScreen() {
  const F = useFeeCalc()
  const { s, set, name, setName, cur, saveState, err, msg, fees, filled, avg, lo, hi, spread, splitTotal, splitOk, hours, cost } = F
  const nav = useNavigate()
  const { profile } = useAuth()
  const [sheet, setSheet] = useState<Sheet>(null)
  const [note, setNote] = useState<{ text: string; id?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { document.body.style.overflow = sheet ? 'hidden' : ''; return () => { document.body.style.overflow = '' } }, [sheet])

  const proj = F.projects.data?.find((p) => p.id === s.projectId)
  // the project's open agreement decides the button: update its draft, open it if it's out for signature, or create one
  const open = useLoad(async () => {
    if (!s.projectId) return null
    const { data } = await supabase.from('agreements').select('id, status').eq('project_id', s.projectId).in('status', ['draft', 'sent']).limit(1)
    return (data?.[0] ?? null) as { id: string; status: string } | null
  }, [s.projectId])
  const ag = open.data
  const go = async () => {
    if (!proj) return
    if (ag?.status === 'sent') return nav('/proposals/' + ag.id)
    const sd = F.seed()
    if (typeof sd === 'string') return F.setErr(sd)
    await F.flush()
    setBusy(true); F.setErr(''); setNote(null)
    const r = await applyFeeToProject(proj.id, sd, profile?.id ?? null, (m) => window.confirm(m))
    setBusy(false)
    if ('error' in r) return F.setErr(r.error)
    if ('cancelled' in r) return
    setNote({ text: r.created ? `Created ${proj.number}’s proposal at ${usd(sd.fee)}.` : `Updated ${proj.number}’s proposal to ${usd(sd.fee)}.`, id: r.id })
    open.reload()
  }
  const goLabel = !proj ? 'Choose a project to make a proposal'
    : ag?.status === 'sent' ? `Open ${proj.number} proposal (out for signature)`
    : `${ag ? 'Update' : 'Create'} ${proj.number} proposal · ${avg ? usd(avg) : '—'}`

  // where each method sits on the range line (0–100%)
  const span = hi - lo
  const at = (v: number) => (span > 0 ? (v - lo) / span * 100 : 50)
  const sums = [
    hours ? `${s.rows.filter((r) => num(r.hours) > 0).length} ${s.rows.filter((r) => num(r.hours) > 0).length === 1 ? 'person' : 'people'} · ${hours.toLocaleString()} h` : 'Hours × rate per person',
    num(s.sf) || num(s.perSf) ? `${num(s.sf).toLocaleString()} SF × ${usd(num(s.perSf))}` : 'Area × fee per SF',
    cost ? `${usd(cost)} × ${num(s.pct)}%` : 'Construction cost × %',
  ]
  const shown = PHASES.map(([c, n]) => ({ c, n, v: num(s.split[c] ?? '0') })).filter((x) => x.v > 0)

  return <div className="fc">
    <div className="fc-top">
      <label className="sr" htmlFor="fc-name">Fee name</label>
      <input id="fc-name" className="fc-name" placeholder="Name this fee" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void F.flush()} />
      <button type="button" className="fc-tbtn" onClick={() => setSheet('saved')} aria-label="Saved fees"><IconList /></button>
      <button type="button" className="fc-tbtn" onClick={() => { void F.startNew(); setNote(null) }} aria-label="New blank fee"><IconPlus /></button>
    </div>
    <div className="fc-meta">
      <label className="sr" htmlFor="fc-proj">Project</label>
      <select id="fc-proj" className={'fc-proj' + (proj ? ' on' : '')} value={s.projectId ?? ''} onChange={(e) => { set({ projectId: e.target.value }); setNote(null) }}>
        <option value="">No project yet</option>
        {(F.projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</select>
      <span className="fc-saved" role="status">{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : cur ? 'Saves as you type' : ''}</span>
    </div>
    {err && <p className="err fc-msg" role="alert">{err}</p>}
    {msg && <p className="ok fc-msg" role="status">{msg}</p>}

    <section className="fc-hero" aria-live="polite">
      <span className="fc-cap">Average fee</span>
      <strong className="num fc-avg">{avg ? usd(avg) : '—'}</strong>
      {filled.length > 1 ? <>
        <div className="fc-range" role="img" aria-label={`Range ${usd(lo)} to ${usd(hi)}, ${spread.toFixed(0)}% spread`}>
          <span className="fc-track" />
          <span className="fc-avgtick" style={{ left: `${at(avg)}%` }} />
          {fees.map((v, i) => v > 0 && <span key={i} className="fc-dot" style={{ left: `${at(v)}%` }}>{i + 1}</span>)}
        </div>
        <div className="fc-rlbl num"><span>{usd(lo)}</span><span>{spread.toFixed(0)}% spread</span><span>{usd(hi)}</span></div>
      </> : <span className="fc-hint">{filled.length === 1 ? 'One method filled in. Add another to see the range.' : 'Price the job up to three ways. The average is what goes on the proposal.'}</span>}
    </section>

    <h3 className="fc-h">Three ways</h3>
    <div className="fc-group">
      {METHODS.map((m, i) => <button key={m} type="button" className="fc-row" onClick={() => setSheet({ m: i as 0 | 1 | 2 })}>
        <span className={'fc-n' + (fees[i] > 0 ? ' on' : '')}>{i + 1}</span>
        <span className="fc-rt"><strong>{m}</strong><small>{sums[i]}</small></span>
        <span className="fc-ra"><b className="num">{fees[i] > 0 ? usd(fees[i]) : '—'}</b><small>{vsAvg(fees[i], avg).replace(' vs average', '')}</small></span>
        <span className="fc-chev" aria-hidden="true">›</span>
      </button>)}
    </div>

    <h3 className="fc-h">Fee by phase</h3>
    <button type="button" className="fc-group fc-phases" onClick={() => setSheet('phases')}>
      <span className="fc-bar" aria-hidden="true">{shown.map((x) => <span key={x.c} style={{ flex: x.v, background: PH_COLOR[x.c] }} />)}</span>
      <span className="fc-legend">{shown.map((x) => <span key={x.c}><i style={{ background: PH_COLOR[x.c] }} />{x.c} <span className="num">{x.v}%</span>{avg ? <span className="num muted"> {usd(avg * x.v / 100)}</span> : null}</span>)}</span>
      {!splitOk && <span className="fc-warn">Phases add up to {splitTotal.toLocaleString()}%, not 100%.</span>}
      <span className="fc-edit">Edit phases ›</span>
    </button>

    {note && <p className="fc-note" role="status">{note.text} {note.id && <button type="button" className="linkbtn" onClick={() => nav('/proposals/' + note.id)}>Open ›</button>}</p>}
    <div className="fc-go">
      <button type="button" className="btn m-primary" disabled={!proj || busy || (ag?.status !== 'sent' && (!avg || !splitOk))} onClick={go}>{busy ? 'Saving…' : goLabel}</button>
    </div>

    {sheet && <div className="fc-scrim" onClick={() => setSheet(null)} />}
    {sheet && <div className="fc-sheet" role="dialog" aria-modal="true" aria-label={sheet === 'saved' ? 'Saved fees' : sheet === 'phases' ? 'Fee by phase' : METHODS[sheet.m]}>
      <span className="fc-grab" aria-hidden="true" />
      {typeof sheet === 'object' && <MethodSheet F={F} m={sheet.m} setM={(m) => setSheet({ m })} onDone={() => setSheet(null)} />}
      {sheet === 'phases' && <PhaseSheet F={F} onDone={() => setSheet(null)} />}
      {sheet === 'saved' && <SavedSheet F={F} onPick={() => { setSheet(null); setNote(null) }} />}
    </div>}
  </div>
}

function SheetHead({ title, onDone }: { title: string; onDone?: () => void }) {
  return <div className="fc-sh"><h2>{title}</h2>{onDone && <button type="button" className="fc-done" onClick={onDone}>Done</button>}</div>
}

function MethodSheet({ F, m, setM, onDone }: { F: FeeCalc; m: 0 | 1 | 2; setM: (m: 0 | 1 | 2) => void; onDone: () => void }) {
  const { s, set, setS, setRow, pickPerson, people, fees, avg, cost, hours } = F
  return <>
    <SheetHead title={METHODS[m]} onDone={onDone} />
    <div className="cvp-seg fc-seg" role="group" aria-label="Method">
      {METHODS.map((x, i) => <button key={x} type="button" aria-pressed={i === m} onClick={() => setM(i as 0 | 1 | 2)}>{['Hourly', 'Per SF', '% of cost'][i]}</button>)}
    </div>
    <div className="fc-sb">
      {m === 0 && <>
        {s.rows.map((r, i) => <div key={r.key} className="fc-person">
          <div className="fc-prow">
            <label className="sr" htmlFor={`fc-p-${r.key}`}>Person {i + 1}</label>
            <select id={`fc-p-${r.key}`} className="input" value={r.profile_id} onChange={(e) => pickPerson(r.key, e.target.value)}>
              <option value="">Person…</option>
              {people.data?.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? 'Unnamed'}</option>)}</select>
            <button type="button" className="fc-x" aria-label={`Remove person ${i + 1}`} disabled={s.rows.length === 1 && !r.profile_id && !r.hours}
              onClick={() => setS((o) => ({ ...o, rows: o.rows.length > 1 ? o.rows.filter((x) => x.key !== r.key) : [newRow()] }))}>×</button>
          </div>
          <div className="fc-pair">
            <div><label className="l" htmlFor={`fc-h-${r.key}`}>Hours</label><input id={`fc-h-${r.key}`} className="input num" inputMode="decimal" placeholder="0" value={r.hours} onChange={(e) => setRow(r.key, { hours: e.target.value })} /></div>
            <div><label className="l" htmlFor={`fc-r-${r.key}`}>$/hr</label><input id={`fc-r-${r.key}`} className="input num" inputMode="decimal" placeholder="0" value={r.rate} onChange={(e) => setRow(r.key, { rate: e.target.value })} /></div>
            <span className="num fc-pamt">{usd(num(r.hours) * num(r.rate))}</span>
          </div>
        </div>)}
        <button type="button" className="linkbtn fc-add" onClick={() => set({ rows: [...s.rows, newRow()] })}>+ Add person</button>
      </>}
      {m === 1 && <div className="fc-pair">
        <div><label className="l" htmlFor="fc-sf">Area (SF)</label><input id="fc-sf" className="input num" inputMode="decimal" placeholder="0" value={s.sf} onChange={(e) => set({ sf: e.target.value })} /></div>
        <div><label className="l" htmlFor="fc-psf">Fee per SF ($)</label><input id="fc-psf" className="input num" inputMode="decimal" placeholder="0.00" value={s.perSf} onChange={(e) => set({ perSf: e.target.value })} /></div>
      </div>}
      {m === 2 && <>
        <div className="fc-pair">
          <div><label className="l" htmlFor="fc-sf3">Area (SF)</label><input id="fc-sf3" className="input num" inputMode="decimal" placeholder="0" value={s.sf} onChange={(e) => set({ sf: e.target.value })} /></div>
          <div><label className="l" htmlFor="fc-cpsf">Cost per SF ($)</label><input id="fc-cpsf" className="input num" inputMode="decimal" placeholder="0.00" value={s.costPerSf} onChange={(e) => set({ costPerSf: e.target.value })} /></div>
        </div>
        <div className="fc-pair" style={{ marginTop: 10 }}>
          <div><label className="l" htmlFor="fc-pct">Fee (%)</label><input id="fc-pct" className="input num" inputMode="decimal" placeholder="0.0" value={s.pct} onChange={(e) => set({ pct: e.target.value })} /></div>
          <div className="fc-calc"><span className="l">Construction cost</span><span className="num">{cost ? usd(cost) : '—'}</span></div>
        </div>
        <p className="muted fc-fine">The area is shared with Price per SF.</p>
      </>}
    </div>
    <div className="fc-sf-foot">
      <span><span className="l">{METHODS[m]}{m === 0 && hours ? ` · ${hours.toLocaleString()} h` : ''}</span><b className="num">{fees[m] > 0 ? usd(fees[m]) : '—'}</b></span>
      <span className="muted">Average {avg ? usd(avg) : '—'}</span>
    </div>
  </>
}

function PhaseSheet({ F, onDone }: { F: FeeCalc; onDone: () => void }) {
  const { s, set, setSplit, avg, splitTotal, splitOk } = F
  const step = (c: string, d: number) => setSplit(c, String(Math.max(0, Math.min(100, num(s.split[c] ?? '0') + d))))
  return <>
    <SheetHead title="Fee by phase" onDone={onDone} />
    <div className="fc-sb">
      <span className="fc-bar" aria-hidden="true">{PHASES.map(([c]) => { const v = num(s.split[c] ?? '0'); return v > 0 ? <span key={c} style={{ flex: v, background: PH_COLOR[c] }} /> : null })}</span>
      <div className="fc-plist">
        {PHASES.map(([c, n]) => { const v = num(s.split[c] ?? '0'); return <div key={c} className={'fc-ph' + (v > 0 ? '' : ' off')}>
          <span className="fc-phn"><i style={{ background: PH_COLOR[c] }} /><strong>{c}</strong><small>{n}</small></span>
          <span className="fc-step">
            <button type="button" aria-label={`${n} minus 5%`} onClick={() => step(c, -5)}>−</button>
            <label className="sr" htmlFor={`fc-sp-${c}`}>{n} percent</label>
            <input id={`fc-sp-${c}`} className="num" inputMode="decimal" value={s.split[c] ?? ''} placeholder="0" onChange={(e) => setSplit(c, e.target.value)} />
            <button type="button" aria-label={`${n} plus 5%`} onClick={() => step(c, 5)}>+</button>
          </span>
          <span className="num fc-phd">{avg && v ? usd(avg * v / 100) : '—'}</span>
        </div> })}
      </div>
      <button type="button" className="linkbtn fc-add" onClick={() => set({ split: DEFAULT_SPLIT })}>Reset to 15 / 20 / 40 / 5 / 20</button>
    </div>
    <div className={'fc-sf-foot' + (splitOk ? '' : ' warn')}>
      <span><span className="l">Total</span><b className="num">{splitTotal.toLocaleString()}%</b></span>
      <span className={splitOk ? 'muted' : ''}>{splitOk ? (avg ? usd(avg) : '—') : splitTotal < 100 ? `${(100 - splitTotal).toLocaleString()}% unassigned` : `Over by ${(splitTotal - 100).toLocaleString()}%`}</span>
    </div>
  </>
}

function SavedSheet({ F, onPick }: { F: FeeCalc; onPick: () => void }) {
  const { years, shownYear, setYear, inYear, cur, projects, saved } = F
  return <>
    <SheetHead title="Saved fees" />
    <div className="fc-sb">
      {years.length > 1 && <div className="cvp-seg fc-seg" role="group" aria-label="Year" style={{ gridTemplateColumns: `repeat(${years.length}, minmax(0,1fr))` }}>
        {years.map((y) => <button key={y} type="button" aria-pressed={y === shownYear} onClick={() => setYear(y)}>{y}</button>)}</div>}
      {saved.error && <p className="err">{saved.error}</p>}
      {saved.data && inYear.length === 0 && <p className="muted">Nothing saved yet. Start typing and a fee saves itself.</p>}
      <ul className="fc-slist">
        {inYear.map((x) => { const pr = projects.data?.find((p) => p.id === (x.project_id ?? x.inputs.projectId)); return <li key={x.id} className={cur?.id === x.id ? 'on' : ''}>
          <button type="button" className="fc-sitem" onClick={() => { void F.open(x); onPick() }}>
            <strong>{x.name}</strong><small>{pr ? `${pr.number} · ` : ''}{F.fmtD(x.updated_at || x.created_at)}</small></button>
          <span className="num fc-samt">{savedAvg(x) ? usd(savedAvg(x)) : '—'}</span>
          <RowMenu label={`Actions for ${x.name}`} items={[{ label: 'Rename…', onSelect: () => F.rename(x) }, 'divider', { label: 'Delete', danger: true, onSelect: () => F.remove(x) }]} />
        </li> })}
      </ul>
    </div>
  </>
}

const S = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, 'aria-hidden': true }
function IconList() { return <svg {...S}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg> }
function IconPlus() { return <svg {...S}><path d="M12 5v14M5 12h14" /></svg> }

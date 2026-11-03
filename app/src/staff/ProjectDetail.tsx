import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, money, SECTOR_COLOR, CATEGORY_NAME, PHASES, PHASE_NAME } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'

type Phase = { id: string; code: string; fee: number; status: string; start_date: string | null; end_date: string | null }
type Entry = { phase_id: string | null; minutes: number; profiles: { full_name: string | null; bill_rate: number | null } | null }

export default function ProjectDetail() {
  const { id } = useParams()
  const { data, error, reload } = useLoad(async () => {
    const p = must(await supabase.from('projects').select('*, clients(name)').eq('id', id!).single()) as unknown as { id: string; number: string; name: string; status: string; category: string | null; sector: string | null; clients: { name: string } | null }
    const phases = must(await supabase.from('phases').select('id, code, fee, status, start_date, end_date').eq('project_id', id!)) as Phase[]
    const billed = must(await supabase.from('phase_billing').select('phase_id, billed').eq('project_id', id!)) as { phase_id: string; billed: number }[]
    const time = must(await supabase.from('time_entries').select('phase_id, minutes, profiles(full_name, bill_rate)').eq('project_id', id!)) as unknown as Entry[]
    return { p, phases: phases.sort((a, b) => PHASES.findIndex(([c]) => c === a.code) - PHASES.findIndex(([c]) => c === b.code)), billed, time }
  }, [id])
  if (error) return <p className="err">{error}</p>
  if (!data) return <p>Loading…</p>
  const { p, phases, billed, time } = data
  const billedBy = Object.fromEntries(billed.map((b) => [b.phase_id, Number(b.billed)]))
  const used = (phaseId: string) => time.filter((t) => t.phase_id === phaseId).reduce((a, t) => ({ hrs: a.hrs + t.minutes / 60, cost: a.cost + (t.minutes / 60) * Number(t.profiles?.bill_rate ?? 0) }), { hrs: 0, cost: 0 })
  const totFee = phases.reduce((a, x) => a + Number(x.fee), 0)
  const totBilled = phases.reduce((a, x) => a + (billedBy[x.id] ?? 0), 0)
  const totHrs = time.reduce((a, t) => a + t.minutes / 60, 0)
  const missing = PHASES.filter(([c]) => !phases.some((x) => x.code === c))

  return (
    <div className="stack">
      <Link to="/projects" style={{ fontWeight: 700, textDecoration: 'none' }}>‹ All projects</Link>
      <div className="row between">
        <h1 className="row" style={{ gap: 12 }}><span className="tag" style={{ background: SECTOR_COLOR[p.sector ?? 'internal'], height: 30, fontSize: 16 }}>{p.number}</span>{p.name}
          {p.category && <abbr className="pill" title={CATEGORY_NAME[p.category]}>{p.category}</abbr>}</h1>
        <StatusSelect id={p.id} value={p.status} onSaved={reload} />
      </div>
      <p className="muted" style={{ margin: 0 }}>{p.clients?.name ?? 'No client'}</p>
      <section className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }} aria-label="Summary">
        {[['Total fee', money(totFee)], ['Billed', money(totBilled)], ['Left to bill', money(totFee - totBilled)], ['Hours logged', totHrs.toFixed(1)]].map(([l, v]) => (
          <div key={l} style={{ padding: '16px 20px', borderRight: '1px solid #ece9e3' }}><div className="muted" style={{ fontSize: 14 }}>{l}</div><div className="num" style={{ fontSize: 26, fontWeight: 700 }}>{v}</div></div>))}
      </section>
      <section className="card pad stack">
        <h2>Phases & budget</h2>
        <div style={{ overflowX: 'auto' }}><table className="table" style={{ minWidth: 980 }}>
          <thead><tr><th>Phase</th><th>Status</th><th>Start</th><th>End</th><th className="r">Fee</th><th className="r">Billed</th><th className="r">Hours</th><th>Fee used (labor at rates)</th><th></th></tr></thead>
          <tbody>{phases.map((ph) => <PhaseRow key={ph.id} ph={ph} billed={billedBy[ph.id] ?? 0} used={used(ph.id)} onSaved={reload} />)}</tbody>
        </table></div>
        {missing.length > 0 && <AddPhase projectId={p.id} codes={missing.map(([c]) => c)} onSaved={reload} />}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}><em>Fee used = hours × each person’s billable rate. The bar turns orange at 75% and red at 90%.</em></p>
      </section>
    </div>
  )
}

function StatusSelect({ id, value, onSaved }: { id: string; value: string; onSaved: () => void }) {
  return <div><label className="sr" htmlFor="ps">Project status</label>
    <select id="ps" className="input" style={{ width: 180 }} value={value} onChange={async (e) => { await supabase.from('projects').update({ status: e.target.value }).eq('id', id); onSaved() }}>
      <option value="active">Active</option><option value="paused">Paused</option><option value="complete">Complete</option><option value="proposal">Proposal</option></select></div>
}

function PhaseRow({ ph, billed, used, onSaved }: { ph: Phase; billed: number; used: { hrs: number; cost: number }; onSaved: () => void }) {
  const [f, setF] = useState({ fee: String(ph.fee), status: ph.status, start_date: ph.start_date ?? '', end_date: ph.end_date ?? '' })
  const [msg, setMsg] = useState('')
  const dirty = f.fee !== String(ph.fee) || f.status !== ph.status || f.start_date !== (ph.start_date ?? '') || f.end_date !== (ph.end_date ?? '')
  const pct = Number(ph.fee) ? used.cost / Number(ph.fee) * 100 : 0
  const save = async () => {
    const { error } = await supabase.from('phases').update({ fee: Number(f.fee) || 0, status: f.status, start_date: f.start_date || null, end_date: f.end_date || null }).eq('id', ph.id)
    setMsg(error ? error.message : ''); if (!error) onSaved()
  }
  return (
    <tr>
      <td><strong>{ph.code}</strong> <span className="muted">{PHASE_NAME[ph.code]}</span>{msg && <div className="err">{msg}</div>}</td>
      <td><label className="sr" htmlFor={'st' + ph.id}>Status</label><select id={'st' + ph.id} className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
        <option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="paused">Paused</option><option value="complete">Complete</option></select></td>
      <td><label className="sr" htmlFor={'sd' + ph.id}>Start</label><input id={'sd' + ph.id} type="date" className="input" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></td>
      <td><label className="sr" htmlFor={'ed' + ph.id}>End</label><input id={'ed' + ph.id} type="date" className="input" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></td>
      <td className="r"><label className="sr" htmlFor={'fe' + ph.id}>Fee</label><input id={'fe' + ph.id} className="input num" style={{ width: 120, textAlign: 'right' }} inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /></td>
      <td className="r num">{money(billed)}</td>
      <td className="r num">{used.hrs.toFixed(1)}</td>
      <td style={{ minWidth: 160 }}><div style={{ height: 8, borderRadius: 999, background: '#ece9e3', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: Math.min(100, pct) + '%', background: pct >= 90 ? '#d92d20' : pct >= 75 ? '#dc6803' : 'var(--navy)' }} /></div>
        <div className="muted num" style={{ fontSize: 12, marginTop: 4 }}>{money(used.cost)} · {pct.toFixed(0)}%</div></td>
      <td>{dirty && <button className="btn small" onClick={save}>Save</button>}</td>
    </tr>)
}

function AddPhase({ projectId, codes, onSaved }: { projectId: string; codes: string[]; onSaved: () => void }) {
  const [code, setCode] = useState(codes[0]); const [fee, setFee] = useState('')
  return <div className="row">
    <label className="sr" htmlFor="ap-c">Phase</label><select id="ap-c" className="input" style={{ width: 260 }} value={code} onChange={(e) => setCode(e.target.value)}>{codes.map((c) => <option key={c} value={c}>{c} · {PHASE_NAME[c]}</option>)}</select>
    <label className="sr" htmlFor="ap-f">Fee</label><input id="ap-f" className="input num" style={{ width: 140 }} placeholder="Fee $" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
    <button className="btn small secondary" onClick={async () => { await supabase.from('phases').insert({ project_id: projectId, code, fee: Number(fee) || 0 }); setFee(''); onSaved() }}>+ Add phase</button>
  </div>
}

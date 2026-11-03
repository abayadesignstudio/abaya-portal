import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, money, SECTOR_COLOR, CATEGORY_NAME, PHASES } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'

type Row = { id: string; number: string; name: string; status: string; category: string | null; sector: string | null; next_milestone: string | null
  clients: { name: string } | null; phases: { code: string; status: string; fee: number }[] }

const STATUS_STYLE: Record<string, [string, string, string]> = {
  active: ['In progress', '#fff', '#039855'], paused: ['Paused', '#fff', '#d92d20'], complete: ['Complete', '#344054', '#e4e7ec'], proposal: ['Proposal', '#344054', '#fff'],
}
const PH_COLOR: Record<string, [string, string]> = { complete: ['#d0d5dd', '#344054'], in_progress: ['#039855', '#fff'], paused: ['#d92d20', '#fff'], not_started: ['#fff', '#98a2b3'] }

export default function Projects() {
  const [status, setStatus] = useState('active')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const { data, error, reload } = useLoad(async () => must(await supabase.from('projects')
    .select('id, number, name, status, category, sector, next_milestone, clients(name), phases(code, status, fee)').order('number', { ascending: false })) as unknown as Row[])
  const rows = useMemo(() => (data ?? []).filter((p) => p.number !== 'OH' && (status === 'all' || p.status === status) &&
    (!q || `${p.number} ${p.name} ${p.clients?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [data, status, q])
  const count = (s: string) => (data ?? []).filter((p) => p.number !== 'OH' && (s === 'all' || p.status === s)).length

  return (
    <div className="stack">
      <div className="row between"><h1>Projects</h1><button className="btn" onClick={() => setAdding(!adding)}>{adding ? 'Close' : '+ New project'}</button></div>
      {adding && <NewProject onDone={() => { setAdding(false); reload() }} />}
      <div className="row between">
        <div className="row" role="group" aria-label="Status">
          {['active', 'paused', 'complete', 'all'].map((s) => (
            <button key={s} className={'btn small' + (status === s ? '' : ' secondary')} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s[0].toUpperCase() + s.slice(1)} ({count(s)})</button>))}
        </div>
        <div style={{ width: 300, maxWidth: '100%' }}><label className="sr" htmlFor="pq">Search</label><input id="pq" className="input" placeholder="Search number, name or client" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {error && <p className="err">{error}</p>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 900 }}>
          <thead><tr><th>Project</th><th>Client</th><th>Phases</th><th className="r">Fee</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const st = STATUS_STYLE[p.status] ?? STATUS_STYLE.active
              const byCode = Object.fromEntries(p.phases.map((ph) => [ph.code, ph]))
              const fee = p.phases.reduce((a, ph) => a + Number(ph.fee), 0)
              return (
                <tr key={p.id}>
                  <td><div className="row" style={{ gap: 8 }}>
                    <span className="tag" style={{ background: SECTOR_COLOR[p.sector ?? 'internal'] }} title={p.sector ?? ''}>{p.number}</span>
                    <Link to={`/projects/${p.id}`} style={{ fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}>{p.name}</Link>
                    {p.category && <abbr className="pill" title={CATEGORY_NAME[p.category]}>{p.category}</abbr>}
                  </div>{p.next_milestone && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}><em>{p.next_milestone}</em></div>}</td>
                  <td>{p.clients?.name ?? '—'}</td>
                  <td><div className="row" style={{ gap: 3, flexWrap: 'nowrap' }} aria-label="Phase progress">
                    {PHASES.map(([code]) => { const ph = byCode[code]; const [bg, fg] = ph ? PH_COLOR[ph.status] : ['transparent', '#d0d5dd']
                      return <span key={code} title={ph ? `${code}: ${ph.status.replace('_', ' ')}` : `${code}: not in contract`} style={{ width: 30, height: 22, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: bg, color: fg, border: ph ? '1px solid #d0d5dd' : '1px dashed #e4e0d8' }}>{code}</span> })}
                  </div></td>
                  <td className="r num">{money(fee)}</td>
                  <td><span className="status" style={{ color: st[1], background: st[2] }}>{st[0]}</span></td>
                </tr>)
            })}
            {data && rows.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 28 }}><em>No projects match.</em></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function NewProject({ onDone }: { onDone: () => void }) {
  const clients = useLoad(async () => must(await supabase.from('clients').select('id, name').order('name')) as { id: string; name: string }[])
  const [f, setF] = useState({ number: '', name: '', client: '', newClient: '', category: 'FO', sector: 'commercial' })
  const [fees, setFees] = useState<Record<string, string>>({})
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      let clientId = f.client || null
      if (f.client === 'new') clientId = (must(await supabase.from('clients').insert({ name: f.newClient.trim() }).select('id').single()) as { id: string }).id
      const p = must(await supabase.from('projects').insert({ number: f.number.trim(), name: f.name.trim(), client_id: clientId, category: f.category, sector: f.sector }).select('id').single()) as { id: string }
      const ph = PHASES.filter(([c]) => fees[c] !== undefined && fees[c] !== '').map(([c]) => ({ project_id: p.id, code: c, fee: Number(fees[c]) || 0 }))
      if (ph.length) must(await supabase.from('phases').insert(ph))
      onDone()
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)) }
    setBusy(false)
  }
  return (
    <form onSubmit={save} className="card pad stack">
      <h2>New project</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0,2fr) minmax(0,1.4fr) 180px 180px', gap: 10 }}>
        <div><label className="l" htmlFor="np-n">Number</label><input id="np-n" className="input" required placeholder="2611" value={f.number} onChange={set('number')} /></div>
        <div><label className="l" htmlFor="np-name">Name</label><input id="np-name" className="input" required value={f.name} onChange={set('name')} /></div>
        <div><label className="l" htmlFor="np-c">Client</label><select id="np-c" className="input" value={f.client} onChange={set('client')}>
          <option value="">—</option>{clients.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="new">+ New client…</option></select></div>
        <div><label className="l" htmlFor="np-cat">Type</label><select id="np-cat" className="input" value={f.category} onChange={set('category')}><option value="S">Shell (S)</option><option value="FO">Interior Finish-Out (FO)</option><option value="CON">Consultation (CON)</option></select></div>
        <div><label className="l" htmlFor="np-sec">Building type</label><select id="np-sec" className="input" value={f.sector} onChange={set('sector')}><option value="commercial">Commercial / Retail</option><option value="residential">Residential</option><option value="medical">Medical</option><option value="consultation">Consultation</option><option value="civic">Civic</option><option value="internal">Internal</option></select></div>
      </div>
      {f.client === 'new' && <div style={{ maxWidth: 420 }}><label className="l" htmlFor="np-nc">New client name</label><input id="np-nc" className="input" required value={f.newClient} onChange={set('newClient')} /></div>}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="l">Phase fees (leave blank for phases not in the contract)</legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 8 }}>
          {PHASES.map(([c, n]) => <div key={c}><label className="l" htmlFor={'fee-' + c} title={n}>{c}</label><input id={'fee-' + c} className="input num" inputMode="decimal" placeholder="$" value={fees[c] ?? ''} onChange={(e) => setFees({ ...fees, [c]: e.target.value })} /></div>)}
        </div></fieldset>
      {err && <p className="err" role="alert">{err}</p>}
      <div><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Create project'}</button></div>
    </form>
  )
}

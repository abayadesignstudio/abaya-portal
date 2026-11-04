import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, money, SECTOR_COLOR, CATEGORY_NAME, PHASES } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import ProjectsGantt from './ProjectsGantt'
import './admin.css'

type Row = { id: string; number: string; name: string; status: string; category: string | null; sector: string | null; next_milestone: string | null
  clients: { name: string } | null; phases: { code: string; status: string; fee: number; start_date: string | null; end_date: string | null }[] }
type TimeRow = { project_id: string; minutes: number; profiles: { bill_rate: number | null } | null }
type OpenInv = { project_id: string; total: number; amount_paid: number; due_date: string | null }

const STATUS_STYLE: Record<string, [string, string, string]> = {
  active: ['In progress', '#fff', '#039855'], paused: ['Paused', '#fff', '#d92d20'], complete: ['Complete', '#344054', '#e4e7ec'], proposal: ['Proposal', '#344054', '#fff'],
}
const PH_COLOR: Record<string, [string, string, string]> = {
  complete: ['#d0d5dd', '#344054', 'complete'], in_progress: ['#039855', '#fff', 'in progress'], paused: ['#d92d20', '#fff', 'paused'], not_started: ['#fff', '#667085', 'not started'],
}
const SECTORS: [string, string][] = [['commercial', 'Commercial / Retail'], ['residential', 'Residential'], ['medical', 'Medical'], ['consultation', 'Consultation'], ['civic', 'Civic'], ['internal', 'Internal']]
const TYPES: [string, string][] = [['all', 'All types'], ['S', 'Shell (S)'], ['FO', 'Finish-Out (FO)'], ['CON', 'Consultation (CON)']]
const today = new Date().toISOString().slice(0, 10)
const SORTS: [string, string][] = [['new', 'Newest to oldest'], ['old', 'Oldest to newest'], ['az', 'Alphabetical (A–Z)'], ['za', 'Alphabetical (Z–A)'], ['num-asc', 'Project number (asc)'], ['num-desc', 'Project number (desc)']]
const firstStart = (p: Row) => p.phases.reduce<string | null>((m, ph) => (ph.start_date && (!m || ph.start_date < m) ? ph.start_date : m), null)
function sortRows(rows: Row[], by: string) {
  const r = [...rows]
  const byDate = (dir: 1 | -1) => (a: Row, b: Row) => { const x = firstStart(a), y = firstStart(b); return !x && !y ? b.number.localeCompare(a.number) : !x ? 1 : !y ? -1 : dir * x.localeCompare(y) }
  if (by === 'new') r.sort(byDate(-1)); else if (by === 'old') r.sort(byDate(1))
  else if (by === 'az') r.sort((a, b) => a.name.localeCompare(b.name)); else if (by === 'za') r.sort((a, b) => b.name.localeCompare(a.name))
  else if (by === 'num-asc') r.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })); else r.sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true }))
  return r
}
const remember = (k: string, d: string) => { try { return localStorage.getItem(k) || d } catch { return d } }
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

export default function Projects() {
  const [status, setStatus] = useState('active')
  const [cats, setCats] = useState<string[]>([]) // project types to show; none picked = all types
  const typeOk = (c: string | null) => cats.length === 0 || (!!c && cats.includes(c))
  const toggleType = (id: string) => setCats(id === 'all' ? [] : cats.includes(id) ? cats.filter((x) => x !== id) : [...cats, id])
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [view, setView] = useState(() => remember('abaya.projects.view', 'timeline'))
  const [sort, setSort] = useState(() => remember('abaya.projects.sort', 'new'))
  const [err, setErr] = useState('')
  const { data, error, reload } = useLoad(async () => {
    const projects = must(await supabase.from('projects')
      .select('id, number, name, status, category, sector, next_milestone, clients(name), phases(code, status, fee, start_date, end_date)').order('number', { ascending: false })) as unknown as Row[]
    const time = must(await supabase.from('time_entries').select('project_id, minutes, profiles(bill_rate)')) as unknown as TimeRow[]
    const open = must(await supabase.from('invoices').select('project_id, total, amount_paid, due_date').eq('status', 'open')) as OpenInv[]
    return { projects, time, open }
  })
  const all = useMemo(() => (data?.projects ?? []).filter((p) => p.number !== 'OH'), [data])
  const labor = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of data?.time ?? []) m[t.project_id] = (m[t.project_id] ?? 0) + (t.minutes / 60) * Number(t.profiles?.bill_rate ?? 0)
    return m
  }, [data])
  const owed = useMemo(() => {
    const m: Record<string, { amt: number; late: boolean }> = {}
    for (const i of data?.open ?? []) {
      const o = (m[i.project_id] ??= { amt: 0, late: false })
      o.amt += Number(i.total) - Number(i.amount_paid)
      if (i.due_date && i.due_date < today) o.late = true
    }
    return m
  }, [data])
  const rows = sortRows(all.filter((p) => (status === 'all' || p.status === status) && typeOk(p.category) &&
    (!q || `${p.number} ${p.name} ${p.clients?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()))), sort)
  const feeUsed = useMemo(() => Object.fromEntries(all.map((p) => { const fee = p.phases.reduce((a, ph) => a + Number(ph.fee), 0); return [p.id, fee ? (labor[p.id] ?? 0) / fee * 100 : null] })), [all, labor])
  const count = (s: string) => all.filter((p) => (s === 'all' || p.status === s) && typeOk(p.category)).length
  const unset = all.filter((p) => !p.sector).length

  const setSector = async (id: string, sector: string) => {
    const { error } = await supabase.from('projects').update({ sector }).eq('id', id)
    setErr(error?.message ?? ''); if (!error) reload()
  }

  return (
    <div className="stack">
      <div className="row between"><h1>Projects</h1><button className="btn" onClick={() => setAdding(!adding)}>{adding ? 'Close' : '+ New project'}</button></div>
      {adding && <NewProject onDone={() => { setAdding(false); reload() }} />}
      <div className="row between">
        <div className="row" role="group" aria-label="Status">
          {['active', 'paused', 'complete', 'all'].map((s) => (
            <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)} ({count(s)})</button>))}
        </div>
        <div style={{ width: 300, maxWidth: '100%' }}><label className="sr" htmlFor="pq">Search projects</label><input id="pq" className="input" placeholder="Search number, name or client" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="row between">
        <div className="row" role="group" aria-label="Project type">
          {TYPES.map(([id, l]) => <button key={id} className="chip" aria-pressed={id === 'all' ? cats.length === 0 : cats.includes(id)} onClick={() => toggleType(id)}>{l}</button>)}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="sr" htmlFor="p-sort">Sort by</label>
          <select id="p-sort" className="input" style={{ width: 'auto', minHeight: 36 }} value={sort} onChange={(e) => { setSort(e.target.value); keep('abaya.projects.sort', e.target.value) }}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>Sort by: {l}</option>)}</select>
          <div className="row" role="group" aria-label="View" style={{ gap: 0 }}>
            {[['timeline', 'Timeline'], ['table', 'Table']].map(([v, l], i) => <button key={v} className="chip" aria-pressed={view === v} style={{ borderRadius: i ? '0 999px 999px 0' : '999px 0 0 999px' }}
              onClick={() => { setView(v); keep('abaya.projects.view', v) }}>{l}</button>)}
          </div>
        </div>
      </div>
      {unset > 0 && <p className="muted" style={{ margin: 0, fontSize: 14 }}><strong>{unset} project{unset === 1 ? '' : 's'}</strong> have no building type yet; pick one in the row to set its color.</p>}
      {(error || err) && <p className="err" role="alert">{error || err}</p>}
      {view === 'timeline' && data && <ProjectsGantt rows={rows} feeUsed={feeUsed} />}
      {view === 'table' && <><div className="card tablewrap">
        <table className="table" style={{ minWidth: 1100 }}>
          <thead><tr><th>Project</th><th>Phases</th><th>Fee used</th><th className="r">Outstanding</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const st = STATUS_STYLE[p.status] ?? STATUS_STYLE.active
              const byCode = Object.fromEntries(p.phases.map((ph) => [ph.code, ph]))
              const fee = p.phases.reduce((a, ph) => a + Number(ph.fee), 0)
              const used = labor[p.id] ?? 0
              const pct = fee ? used / fee * 100 : 0
              const o = owed[p.id]
              return (
                <tr key={p.id}>
                  <td style={{ minWidth: 340 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="tag" style={{ background: SECTOR_COLOR[p.sector ?? 'internal'] }} title={p.sector ?? 'No building type'}>{p.number}</span>
                      <Link to={`/projects/${p.id}`} style={{ fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}>{p.name}</Link>
                      {p.category && <abbr className="pill" title={CATEGORY_NAME[p.category]}>{p.category}</abbr>}
                      {!p.sector && <><label className="sr" htmlFor={'sec-' + p.id}>Building type for {p.name}</label>
                        <select id={'sec-' + p.id} className="inline-select" value="" onChange={(e) => e.target.value && setSector(p.id, e.target.value)}>
                          <option value="">Set building type…</option>{SECTORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></>}
                    </div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{p.clients?.name ?? 'No client'}{p.next_milestone && <> · <em>{p.next_milestone}</em></>}</div>
                  </td>
                  <td><div className="row" style={{ gap: 3, flexWrap: 'nowrap' }} role="img" aria-label={PHASES.map(([c]) => `${c} ${byCode[c] ? PH_COLOR[byCode[c].status][2] : 'not in contract'}`).join(', ')}>
                    {PHASES.map(([code]) => { const ph = byCode[code]
                      return ph
                        ? <span key={code} className="ph-seg" style={{ background: PH_COLOR[ph.status][0], color: PH_COLOR[ph.status][1], border: '1px solid ' + (ph.status === 'not_started' ? '#b9b4aa' : 'transparent') }}>{code}</span>
                        : <span key={code} className="ph-seg" style={{ color: '#c9c4b8', border: '1px dashed #d6d1c6' }}>{code}</span> })}
                  </div></td>
                  <td style={{ minWidth: 170 }}>{fee > 0 ? <>
                    <div className="bar" aria-hidden="true"><span style={{ width: Math.min(100, pct) + '%', background: pct >= 90 ? '#d92d20' : pct >= 75 ? '#dc6803' : 'var(--navy)' }} /></div>
                    <div className="muted num" style={{ fontSize: 12, marginTop: 4 }}>{pct.toFixed(0)}% of {money(fee)}</div></> : <span className="muted" style={{ fontSize: 13 }}>No phase fees yet</span>}</td>
                  <td className="r num">{o && o.amt > 0.005 ? <><strong style={{ color: o.late ? 'var(--red)' : 'var(--text)' }}>{money(o.amt)}</strong><div style={{ fontSize: 12, color: o.late ? 'var(--red)' : 'var(--muted)' }}>{o.late ? 'past due' : 'outstanding'}</div></> : <span className="muted">—</span>}</td>
                  <td><span className="status" style={{ color: st[1], background: st[2] }}>{st[0]}</span></td>
                </tr>)
            })}
            {data && rows.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 28 }}><em>No projects match.</em></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}><em>Phase bar: gray complete, green in progress, red paused, outlined not started, dashed not in the contract. Fee used = hours × billable rates; orange at 75%, red at 90%.</em></p></>}
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

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, money, SECTOR_COLOR } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { newDoc } from '../lib/agreementTemplate'

type Row = { id: string; title: string; status: string; total_fee: number | null; updated_at: string
  clients: { name: string } | null; projects: { number: string; name: string; sector: string | null } | null }
type Proj = { id: string; number: string; name: string; address: string | null; category: string | null; client_id: string | null
  clients: { name: string; phone: string | null; billing_email: string | null; address: string | null } | null; phases: { code: string; fee: number }[] }

const STATUS: Record<string, [string, string, string]> = {
  draft: ['Draft', '#344054', '#fff'], sent: ['Sent', '#fff', '#2b5c8a'], signed: ['Signed', '#fff', '#039855'], void: ['Void', '#344054', '#e4e7ec'],
}

export default function Proposals() {
  const nav = useNavigate()
  const { profile } = useAuth()
  const [filter, setFilter] = useState('all')
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const list = useLoad(async () => must(await supabase.from('agreements')
    .select('id, title, status, total_fee, updated_at, clients(name), projects(number, name, sector)').order('updated_at', { ascending: false })) as unknown as Row[])
  const projects = useLoad(async () => must(await supabase.from('projects')
    .select('id, number, name, address, category, client_id, clients(name, phone, billing_email, address), phases(code, fee)')
    .neq('number', 'OH').in('status', ['active', 'paused', 'proposal']).order('number', { ascending: false })) as unknown as Proj[])

  const create = async () => {
    setBusy(true); setErr('')
    const p = projects.data?.find((x) => x.id === projectId)
    const fees = p ? Object.fromEntries(p.phases.filter((ph) => Number(ph.fee) > 0).map((ph) => [ph.code, Number(ph.fee)])) : {}
    const doc = newDoc(p ? {
      projName: p.name, projAddr: p.address ?? '', projType: p.category ?? 'S',
      ownerName: p.clients?.name ?? '', ownerPhone: p.clients?.phone ?? '', ownerEmail: p.clients?.billing_email ?? '', ownerAddr: p.clients?.address ?? '',
    } : {}, fees)
    const { data, error } = await supabase.from('agreements').insert({
      title: p ? `${p.name} — Proposal` : 'Untitled proposal', project_id: p?.id ?? null, client_id: p?.client_id ?? null,
      doc, total_fee: +doc.v.fee || 0, created_by: profile?.id,
    }).select('id').single()
    setBusy(false)
    if (error) return setErr(error.message)
    nav('/proposals/' + (data as { id: string }).id)
  }

  const rows = (list.data ?? []).filter((r) => filter === 'all' || r.status === filter)
  return (
    <div className="stack">
      <h1>Proposals &amp; agreements</h1>
      <section className="card pad stack" aria-labelledby="np-h">
        <h2 id="np-h">New proposal</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 320, flex: 1, maxWidth: 520 }}>
            <label className="l" htmlFor="np-proj">Start from a project (optional)</label>
            <select id="np-proj" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Blank — fill everything in the editor</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}{p.clients ? ` — ${p.clients.name}` : ''}</option>)}
            </select>
          </div>
          <button type="button" className="btn" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create proposal'}</button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}><em>Starting from a project fills in the owner, project name and address, and turns on the phases that have fees, with the fee total.</em></p>
        {err && <p className="err" role="alert">{err}</p>}
      </section>

      <div className="row" role="group" aria-label="Status">
        {['all', 'draft', 'sent', 'signed'].map((s) => (
          <button key={s} type="button" className={'btn small' + (filter === s ? '' : ' secondary')} aria-pressed={filter === s} onClick={() => setFilter(s)}>
            {s === 'all' ? 'All' : STATUS[s][0]} ({(list.data ?? []).filter((r) => s === 'all' || r.status === s).length})</button>))}
      </div>
      {list.error && <p className="err">{list.error}</p>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 820 }}>
          <thead><tr><th>Proposal</th><th>Client</th><th>Project</th><th className="r">Fee</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>
            {rows.map((r) => { const st = STATUS[r.status] ?? STATUS.draft
              return (
                <tr key={r.id}>
                  <td><Link to={`/proposals/${r.id}`} style={{ fontWeight: 700, color: 'var(--text)' }}>{r.title}</Link></td>
                  <td>{r.clients?.name ?? '—'}</td>
                  <td>{r.projects ? <span className="row" style={{ gap: 6 }}><span className="tag" style={{ background: SECTOR_COLOR[r.projects.sector ?? 'internal'] }}>{r.projects.number}</span>{r.projects.name}</span> : '—'}</td>
                  <td className="r num">{r.total_fee ? money(r.total_fee) : '—'}</td>
                  <td><span className="status" style={{ color: st[1], background: st[2] }}>{st[0]}</span></td>
                  <td className="num">{new Date(r.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                </tr>) })}
            {list.data && rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 28 }}><em>No proposals yet. Create one above.</em></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

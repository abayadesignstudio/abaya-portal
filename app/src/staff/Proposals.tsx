import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, money, SECTOR_COLOR } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { newDoc } from '../lib/agreementTemplate'
import RowMenu, { type RowMenuItem } from '../components/RowMenu'

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

  const [note, setNote] = useState('')
  const ok = (t: string) => { setNote(t); setErr(''); window.setTimeout(() => setNote((n) => (n === t ? '' : n)), 4000) }
  const fail = (t: string) => { setErr(t); setNote('') }
  const now = () => new Date().toISOString()

  const duplicate = async (r: Row) => {
    const { data: src, error } = await supabase.from('agreements').select('title, project_id, client_id, doc, total_fee').eq('id', r.id).single()
    if (error) return fail(error.message)
    const { error: e2 } = await supabase.from('agreements').insert({ ...src, title: `${src.title} (copy)`, status: 'draft', created_by: profile?.id })
    if (e2) return fail(e2.message)
    ok(`Duplicated “${r.title}” as a new draft.`); list.reload()
  }
  const rename = async (r: Row) => {
    const t = window.prompt('Proposal name', r.title)?.trim()
    if (!t || t === r.title) return
    const { error } = await supabase.from('agreements').update({ title: t, updated_at: now() }).eq('id', r.id)
    if (error) return fail(error.message)
    ok('Renamed.'); list.reload()
  }
  const setStatus = async (r: Row, status: string) => {
    if (status === 'void' && !window.confirm(`Void “${r.title}”? It stays on file, marked Void, and can’t be sent.`)) return
    const v: Record<string, unknown> = { status, updated_at: now() }
    if (status === 'sent') v.sent_at = now()
    if (status === 'signed') v.signed_at = now()
    if (status === 'draft') { v.sent_at = null; v.signed_at = null }
    const { error } = await supabase.from('agreements').update(v).eq('id', r.id)
    if (error) return fail(error.message)
    ok(`Marked ${STATUS[status][0].toLowerCase()}.`); list.reload()
  }
  const remove = async (r: Row) => {
    if (!window.confirm(`Delete “${r.title}” permanently? This can’t be undone.`)) return
    const { error } = await supabase.from('agreements').delete().eq('id', r.id)
    if (error) return fail(error.message)
    ok('Proposal deleted.'); list.setData((d) => (d ?? []).filter((x) => x.id !== r.id))
  }
  const menu = (r: Row): RowMenuItem[] => [
    { label: 'Open', onSelect: () => nav('/proposals/' + r.id) },
    { label: 'Rename…', onSelect: () => rename(r) },
    { label: 'Duplicate', onSelect: () => duplicate(r) },
    'divider',
    ...(['draft', 'sent', 'signed'] as const).filter((s) => s !== r.status)
      .map((s) => ({ label: `Mark as ${STATUS[s][0].toLowerCase()}`, onSelect: () => setStatus(r, s) })),
    ...(r.status !== 'void' ? [{ label: 'Void', onSelect: () => setStatus(r, 'void') }] : []),
    'divider',
    r.status === 'signed'
      ? { label: 'Delete', danger: true, disabled: true, hint: 'Signed agreements can’t be deleted. Void it instead.', onSelect: () => {} }
      : { label: 'Delete', danger: true, onSelect: () => remove(r) },
  ]

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
      </section>
      {err && <p className="err" role="alert">{err}</p>}
      {note && <p className="ok" role="status">{note}</p>}

      <div className="row" role="group" aria-label="Status">
        {['all', 'draft', 'sent', 'signed', 'void'].map((s) => (
          <button key={s} type="button" className={'btn small' + (filter === s ? '' : ' secondary')} aria-pressed={filter === s} onClick={() => setFilter(s)}>
            {s === 'all' ? 'All' : STATUS[s][0]} ({(list.data ?? []).filter((r) => s === 'all' || r.status === s).length})</button>))}
      </div>
      {list.error && <p className="err">{list.error}</p>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 820 }}>
          <thead><tr><th>Proposal</th><th>Client</th><th>Project</th><th className="r">Fee</th><th>Status</th><th>Updated</th><th aria-label="Actions" style={{ width: 52 }} /></tr></thead>
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
                  <td className="r" style={{ padding: '4px 8px' }}><RowMenu label={`Actions for ${r.title}`} items={menu(r)} /></td>
                </tr>) })}
            {list.data && rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 28 }}><em>No proposals yet. Create one above.</em></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

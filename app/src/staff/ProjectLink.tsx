import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { syncPctPhases } from '../lib/fees'
import { supabase } from '../lib/supabase'
import { must } from '../lib/useQuery'
import Combobox, { sectorColor } from '../components/Combobox'
import { typeCodes } from './TypePicker'

// Links a proposal to a project (and that project's client), so the Proposals list shows them and the
// cover can be filled from the project's records. A brand-new project can be created right here.
type Client = { id: string; name: string; phone: string | null; billing_email: string | null; address: string | null }
type Proj = { id: string; number: string; name: string; address: string | null; category: string | null; sector: string | null; client_id: string | null; clients: Client | null }
type Cover = Record<string, string>

const SECTORS: [string, string][] = [['commercial', 'Commercial / Retail'], ['residential', 'Residential'], ['medical', 'Medical'], ['civic', 'Civic'], ['consultation', 'Consultation']]

/** Cover fields the project/client can supply. */
function coverFrom(p: Proj): Cover {
  const c = p.clients
  const out: Cover = { projName: p.name, projAddr: p.address ?? '', ownerName: c?.name ?? '', ownerPhone: c?.phone ?? '', ownerEmail: c?.billing_email ?? '', ownerAddr: c?.address ?? '' }
  if (p.category && typeCodes(p.category).length) out.projType = p.category
  return out
}

export default function ProjectLink({ projectId, clientId, agreementId, cover, onLinked, fillCover }: {
  projectId: string | null; clientId: string | null; agreementId: string; cover: Cover
  onLinked: (projectId: string | null, clientId: string | null) => void
  fillCover: (values: Cover) => void
}) {
  const [projects, setProjects] = useState<Proj[] | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ number: '', name: '', client: '', newClient: '', sector: 'commercial' })

  const load = async () => {
    const [p, c] = await Promise.all([
      supabase.from('projects').select('id, number, name, address, category, sector, client_id, clients(id, name, phone, billing_email, address)').neq('number', 'OH').order('number', { ascending: false }),
      supabase.from('clients').select('id, name, phone, billing_email, address').order('name'),
    ])
    setProjects((p.data as unknown as Proj[]) ?? []); setClients((c.data as Client[]) ?? [])
  }
  useEffect(() => { load() }, [])

  const current = projects?.find((p) => p.id === projectId) ?? null
  const currentClient = current?.clients ?? clients.find((c) => c.id === clientId) ?? null

  const save = async (pid: string | null, cid: string | null) => {
    const { error } = await supabase.from('agreements').update({ project_id: pid, client_id: cid, updated_at: new Date().toISOString() }).eq('id', agreementId)
    if (error) throw new Error(error.message)
    // the old and new projects' percentage phases follow their (changed) agreement totals
    for (const x of new Set([projectId, pid])) if (x) syncPctPhases(x).catch(() => {})
    onLinked(pid, cid)
  }
  const blanksFrom = (p: Proj) => Object.fromEntries(Object.entries(coverFrom(p)).filter(([k, v]) => v && !(cover[k] ?? '').trim()))
  const differs = (p: Proj) => Object.entries(coverFrom(p)).some(([k, v]) => v && (cover[k] ?? '').trim() && (cover[k] ?? '').trim() !== v.trim())

  const link = async (p: Proj) => {
    setBusy(true); setMsg(null)
    try {
      await save(p.id, p.client_id)
      const fill = blanksFrom(p)
      if (Object.keys(fill).length) fillCover(fill)
      const n = Object.keys(fill).length
      setMsg({ ok: true, t: `Linked to ${p.number} · ${p.name}${p.clients ? ` (${p.clients.name})` : ''}.${n ? ` Filled ${n} blank cover field${n === 1 ? '' : 's'}.` : ''}` })
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }) }
    setBusy(false)
  }
  const replaceCover = () => {
    if (!current) return
    if (!window.confirm('Replace the owner and project details on the cover with the project’s records?')) return
    fillCover(coverFrom(current)); setMsg({ ok: true, t: 'Cover details replaced with the project’s.' })
  }
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null)
    try {
      let cid: string | null = f.client || null
      if (f.client === 'new') cid = (must(await supabase.from('clients').insert({ name: f.newClient.trim() }).select('id').single()) as { id: string }).id
      const cat = typeCodes(cover.projType)[0] ?? 'S'
      const p = must(await supabase.from('projects').insert({ number: f.number.trim(), name: f.name.trim(), client_id: cid, category: cat, sector: f.sector, address: cover.projAddr?.trim() || null }).select('id').single()) as { id: string }
      await load()
      await save(p.id, cid)
      setAdding(false); setF({ number: '', name: '', client: '', newClient: '', sector: 'commercial' })
      setMsg({ ok: true, t: `Project ${f.number.trim()} created and linked. Add its phase fees on the project page.` })
    } catch (x) { setMsg({ ok: false, t: (x as Error).message.includes('duplicate') ? 'That project number is already used.' : (x as Error).message }) }
    setBusy(false)
  }
  const openAdd = () => {
    const name = (cover.projName ?? '').trim()
    const match = clients.find((c) => c.name.trim().toLowerCase() === (cover.ownerName ?? '').trim().toLowerCase())
    setF({ number: '', name, client: match?.id ?? (cover.ownerName?.trim() ? 'new' : ''), newClient: match ? '' : (cover.ownerName ?? '').trim(), sector: 'commercial' })
    setAdding(true); setMsg(null)
  }

  const options = (projects ?? []).map((p) => ({ value: p.id, label: p.name, chip: p.number, color: sectorColor(p.sector), search: `${p.number} ${p.name} ${p.clients?.name ?? ''}`, hint: p.clients?.name ?? undefined }))

  return (
    <div className="ag-tool">
      <span className="l">Client &amp; project</span>
      {current
        ? <p style={{ margin: 0, fontSize: 13 }}><span className="tag" style={{ background: sectorColor(current.sector) }}>{current.number}</span> <Link to={`/projects/${current.id}`}>{current.name}</Link><br /><span className="muted">{currentClient?.name ?? 'No client on this project'}</span></p>
        : <p className="muted" style={{ margin: 0, fontSize: 13 }}>{currentClient ? <>Client: {currentClient.name} · no project</> : 'Not linked to a client or project.'}</p>}
      {!adding && <>
        <Combobox id="ag-proj" label={current ? 'Change project' : 'Link to a project'} placeholder={projects ? 'Search number, name or client' : 'Loading…'} options={options}
          value={projectId ?? ''} disabled={busy || !projects} onChange={(v) => { const p = projects?.find((x) => x.id === v); if (p && p.id !== projectId) link(p) }} />
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn small secondary" disabled={busy} onClick={openAdd}>+ New project…</button>
          {current && differs(current) && <button type="button" className="btn small secondary" disabled={busy} onClick={replaceCover}>Use project’s details</button>}
          {/* no Unlink: every agreement belongs to a project; link it to a different one instead */}
        </div>
      </>}
      {adding && (
        <form onSubmit={create} className="stack" style={{ gap: 8 }}>
          <div><label className="l" htmlFor="pl-n">Project number</label><input id="pl-n" className="input" required placeholder="e.g. 2611A" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></div>
          <div><label className="l" htmlFor="pl-name">Project name</label><input id="pl-name" className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><label className="l" htmlFor="pl-c">Client</label><select id="pl-c" className="input" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })}>
            <option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="new">+ New client…</option></select></div>
          {f.client === 'new' && <div><label className="l" htmlFor="pl-nc">New client name</label><input id="pl-nc" className="input" required value={f.newClient} onChange={(e) => setF({ ...f, newClient: e.target.value })} /></div>}
          <div><label className="l" htmlFor="pl-s">Building type</label><select id="pl-s" className="input" value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })}>
            {SECTORS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>
          <div className="row" style={{ gap: 6 }}><button className="btn small" disabled={busy}>{busy ? 'Creating…' : 'Create & link'}</button>
            <button type="button" className="btn small secondary" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>)}
      {msg && <p className={msg.ok ? 'ok' : 'err'} role={msg.ok ? 'status' : 'alert'} style={{ margin: 0, fontSize: 13 }}>{msg.t}</p>}
    </div>
  )
}

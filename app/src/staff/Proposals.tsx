import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { projectEstimates, seedFromEstimate } from '../lib/feeSeed'
import { supabase, money, SECTOR_COLOR } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { applyFeeToProject } from '../lib/applyFee'
import RowMenu, { type RowMenuItem } from '../components/RowMenu'
import { useRemembered } from '../lib/useRemembered'
import FeeTriangulator, { type FeeSeed } from './FeeTriangulator'

type Row = { id: string; title: string; status: string; total_fee: number | null; updated_at: string; project_id: string | null
  clients: { name: string } | null; projects: { number: string; name: string; sector: string | null } | null }
type Proj = { id: string; number: string; name: string; address: string | null; category: string | null; categories: string[] | null; client_id: string | null
  clients: { name: string; phone: string | null; billing_email: string | null; address: string | null } | null; phases: { code: string; fee: number }[] }

const STATUS: Record<string, [string, string, string]> = {
  draft: ['Draft', '#344054', '#fff'], sent: ['Sent', '#fff', '#2b5c8a'], signed: ['Signed', '#fff', '#039855'], void: ['Void', '#344054', '#e4e7ec'],
}

export default function Proposals() {
  const nav = useNavigate()
  const { profile } = useAuth()
  const [filter, setFilter] = useRemembered('abaya.proposals.filter', 'all')
  const [projectId, setProjectId] = useState('')
  // "+ New project…": every proposal belongs to a project; a prospective job starts as a project with status Proposal
  const [np, setNp] = useState({ number: '', name: '', client: '', newClient: '', category: 'S', sector: 'commercial' })
  const clients = useLoad(async () => must(await supabase.from('clients').select('id, name').order('name')) as { id: string; name: string }[])
  const allNumbers = useLoad(async () => (must(await supabase.from('projects').select('number')) as { number: string }[]).map((x) => x.number))
  /** Next free number for this month: YYMM + letter (2611A, 2611B, …). */
  const suggestNumber = () => {
    const d = new Date(); const ym = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`
    const taken = new Set((allNumbers.data ?? []).map((n) => n.toUpperCase()))
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!taken.has(ym + c)) return ym + c
    return ym
  }
  const [busy, setBusy] = useState(false)
  // fee carried over from the triangulator's Create agreement button
  const [seed, setSeed] = useState<FeeSeed | null>(null)
  const takeSeed = (x: FeeSeed) => { setSeed(x); if (x.projectId) setProjectId(x.projectId); setErr(''); setTimeout(() => { document.getElementById('np-h')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); document.getElementById('np-proj')?.focus({ preventScroll: true }) }, 50) }
  const [err, setErr] = useState('')
  // the project's saved fee (linked in the calculator) is used automatically when the proposal starts
  const loc = useLocation()
  useEffect(() => { const st = loc.state as { projectId?: string; estimateId?: string } | null; if (st?.projectId) setProjectId(st.projectId) }, [loc.state])
  useEffect(() => {
    if (!projectId || projectId === 'new' || (seed && !seed.auto && seed.projectId === projectId)) return
    let live = true
    projectEstimates(projectId).then((list) => {
      if (!live) return
      const want = (loc.state as { estimateId?: string } | null)?.estimateId
      const x = list.find((e) => e.id === want) ?? list[0]
      const sd = x ? seedFromEstimate(x) : null
      setSeed(sd ? { ...sd, auto: true } : (s) => (s?.auto ? null : s))
    }).catch(() => {})
    return () => { live = false }
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = useLoad(async () => must(await supabase.from('agreements')
    .select('id, title, status, total_fee, updated_at, project_id, clients(name), projects(number, name, sector)').order('updated_at', { ascending: false })) as unknown as Row[])
  const projects = useLoad(async () => must(await supabase.from('projects')
    .select('id, number, name, address, category, categories, client_id, clients(name, phone, billing_email, address), phases(code, fee)')
    .neq('number', 'OH').in('status', ['active', 'paused', 'proposal']).order('number', { ascending: false })) as unknown as Proj[])

  // the chosen project's open agreement (draft or out for signature), if any: one at a time, so the button updates or opens it
  const working = projectId && projectId !== 'new' ? (list.data ?? []).find((r) => r.project_id === projectId && (r.status === 'draft' || r.status === 'sent')) : undefined
  const signedOnProject = projectId && projectId !== 'new' ? (list.data ?? []).filter((r) => r.project_id === projectId && r.status === 'signed') : []
  const create = async () => {
    if (working && working.status !== 'draft') { nav('/proposals/' + working.id); return }
    setErr('')
    if (!projectId) return setErr('Choose the project this proposal is for, or pick “+ New project…”.')
    setBusy(true)
    let p = projects.data?.find((x) => x.id === projectId)
    if (projectId === 'new') {
      if (!np.number.trim() || !np.name.trim()) { setBusy(false); return setErr('Give the new project a number and a name.') }
      if (np.client === 'new' && !np.newClient.trim()) { setBusy(false); return setErr('Enter the new client’s name.') }
      try {
        let cid: string | null = np.client && np.client !== 'new' ? np.client : null
        if (np.client === 'new') cid = (must(await supabase.from('clients').insert({ name: np.newClient.trim() }).select('id').single()) as { id: string }).id
        const made = must(await supabase.from('projects').insert({ number: np.number.trim(), name: np.name.trim(), client_id: cid, category: np.category, sector: np.sector, status: 'proposal' })
          .select('id, number, name, address, category, categories, client_id, clients(name, phone, billing_email, address), phases(code, fee)').single()) as unknown as Proj
        p = made
      } catch (e) { setBusy(false); return setErr(/duplicate|unique/i.test(String((e as Error).message)) ? `Project number ${np.number.trim()} is already used.` : (e as Error).message) }
    }
    if (!p) { setBusy(false); return setErr('That project wasn’t found. Reload the page and try again.') }
    const r = await applyFeeToProject(p.id, seed, profile?.id ?? null, (m) => window.confirm(m))
    setBusy(false)
    if ('error' in r) return setErr(r.error)
    if ('cancelled' in r) return
    if (!r.created) setSeed(null)
    nav('/proposals/' + r.id, r.note ? { state: { note: r.note } } : undefined)
  }

  const [note, setNote] = useState('')
  const ok = (t: string) => { setNote(t); setErr(''); window.setTimeout(() => setNote((n) => (n === t ? '' : n)), 4000) }
  const fail = (t: string) => { setErr(t); setNote('') }
  const now = () => new Date().toISOString()

  const duplicate = async (r: Row) => {
    const { data: src, error } = await supabase.from('agreements').select('title, project_id, client_id, doc, total_fee').eq('id', r.id).single()
    if (error) return fail(error.message)
    // each project has one agreement, so the copy starts unlinked (link it to a project from the agreement)
    const { error: e2 } = await supabase.from('agreements').insert({ ...src, project_id: null, title: `${src.title} (copy)`, status: 'draft', created_by: profile?.id })
    if (e2) return fail(e2.message)
    ok(`Duplicated “${r.title}” as a new draft, not linked to a project.`); list.reload()
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
    ...(['draft', 'sent', 'signed'] as const).filter((s) => s !== r.status && r.status !== 'signed')
      .map((s) => ({ label: `Mark as ${STATUS[s][0].toLowerCase()}`, onSelect: () => setStatus(r, s) })),
    ...(r.status === 'signed'
      ? (profile?.role === 'admin' ? [{ label: 'Void signed agreement… (admin)', danger: true, onSelect: () => { if (window.confirm(`Void “${r.title}”? It’s signed: voiding unlocks its phase fees on the project. Only do this if the contract is cancelled or replaced.`)) setStatus(r, 'void') } }]
        : [{ label: 'Void', disabled: true, hint: 'Only an admin can void a signed agreement.', onSelect: () => {} }])
      : r.status !== 'void' ? [{ label: 'Void', onSelect: () => setStatus(r, 'void') }] : []),
    'divider',
    r.status === 'signed'
      ? { label: 'Delete', danger: true, disabled: true, hint: 'Signed agreements can’t be deleted. An admin can void it instead.', onSelect: () => {} }
      : { label: 'Delete', danger: true, onSelect: () => remove(r) },
  ]

  const rows = (list.data ?? []).filter((r) => filter === 'all' || r.status === filter)
  return (
    <div className="stack">
      <h1>Proposals/Agreements</h1>
      <FeeTriangulator onCreateAgreement={takeSeed} />
      <section className="card pad stack" aria-labelledby="np-h">
        <h2 id="np-h">New proposal</h2>
        {seed && <div className="np-seed" role="status">
          <span>{seed.auto ? 'This project’s saved fee' : 'Using the fee triangulator'}{seed.name ? <> (<strong>{seed.name}</strong>)</> : ''}: <strong className="num">{money(seed.fee)}</strong> across {seed.split.map(([c, v]) => `${c} ${v}%`).join(' · ')}. {seed.auto ? 'The proposal starts from it.' : 'Choose the project, then Create proposal.'}</span>
          <button type="button" className="linkbtn" onClick={() => setSeed(null)}>Don’t use</button>
        </div>}
        {!working && signedOnProject.length > 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Signed on this project: {signedOnProject.map((r) => r.title).join('; ')}. A new proposal leaves out the phases already signed{seed ? ' and carries only the rest of this fee' : ''}.</p>}
        {working && <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {working.status === 'draft' ? <>This project already has <Link to={`/proposals/${working.id}`}>{working.title}</Link> ({money(Number(working.total_fee ?? 0))}). {seed ? <>The button replaces its fee with <strong>{money(seed.fee)}</strong> and its fee by phase; its wording, scope and payment grouping stay.</> : 'The button opens it.'}</>
            : working.status === 'sent' ? <><Link to={`/proposals/${working.id}`}>{working.title}</Link> is out for signature. Unpublish it to change its fee.</>
            : <><Link to={`/proposals/${working.id}`}>{working.title}</Link> is signed. Change the fee on the project with Change fee.</>}</p>}
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 320, flex: 1, maxWidth: 520 }}>
            <label className="l" htmlFor="np-proj">Project</label>
            <select id="np-proj" className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value); if (e.target.value === 'new' && !np.number) setNp({ ...np, number: suggestNumber() }) }}>
              <option value="">Choose a project…</option>
              <option value="new">+ New project…</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}{p.clients ? ` — ${p.clients.name}` : ''}</option>)}
            </select>
          </div>
          <button type="button" className="btn" onClick={create} disabled={busy || !projectId}>{busy ? 'Working…' : !working ? 'Create proposal' : working.status === 'draft' ? (seed ? 'Update proposal with this fee' : 'Open proposal') : 'Open proposal'}</button>
        </div>
        {projectId === 'new' && <div className="np-grid">
          <div><label className="l" htmlFor="npn">Number</label><input id="npn" className="input" value={np.number} onChange={(e) => setNp({ ...np, number: e.target.value })} /></div>
          <div><label className="l" htmlFor="npname">Project name</label><input id="npname" className="input" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} placeholder="e.g. Smith Residence" /></div>
          <div><label className="l" htmlFor="npc">Client</label><select id="npc" className="input" value={np.client} onChange={(e) => setNp({ ...np, client: e.target.value })}>
            <option value="">—</option>{clients.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="new">+ New client…</option></select></div>
          {np.client === 'new' && <div><label className="l" htmlFor="npnc">New client name</label><input id="npnc" className="input" value={np.newClient} onChange={(e) => setNp({ ...np, newClient: e.target.value })} /></div>}
          <div><label className="l" htmlFor="npt">Type</label><select id="npt" className="input" value={np.category} onChange={(e) => setNp({ ...np, category: e.target.value })}>
            <option value="S">Shell (S)</option><option value="FO">Finish-Out (FO)</option><option value="CON">Consultation (CON)</option></select></div>
          <div><label className="l" htmlFor="nps">Building type</label><select id="nps" className="input" value={np.sector} onChange={(e) => setNp({ ...np, sector: e.target.value })}>
            <option value="commercial">Commercial / Retail</option><option value="residential">Residential</option><option value="medical">Medical</option><option value="consultation">Consultation</option><option value="civic">Civic</option><option value="internal">Internal</option></select></div>
        </div>}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}><em>Every proposal belongs to a project. For a new job, pick “+ New project…”: it’s created with status Proposal and moves to Active when you set it on the project page. Starting from a project fills in the owner, project name and address, and turns on the phases that have fees.</em></p>
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

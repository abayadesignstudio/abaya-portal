import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, money, PHASE_NAME } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { sortPhases, fmtDate, PHASE_STYLE } from '../lib/projectContent'
import Combobox, { sectorColor } from '../components/Combobox'
import { ClientProjectView, type EditSection } from '../client/ClientProject'
import ClientHeader from '../client/ClientHeader'
import ClientHome from '../client/ClientHome'
import ClientInvoices from '../client/ClientInvoices'
import { PreviewNav, type PreviewNavT } from '../client/preview'
import { UpdatesTab, DrawingsTab, ContractTab, RequestsTab, ClientAccessTab, type Phase, type Project, type Inv } from './ProjectDetail'
import './client-portal.css'

type Section = EditSection | 'access'
const SECTIONS: [Section, string][] = [['phases', 'Phases'], ['schedule', 'Schedule'], ['updates', 'Updates'], ['drawings', 'Drawings'], ['contract', 'Contract'],
  ['requests', 'Requests'], ['model', '3D model'], ['invoices', 'Invoices'], ['access', 'Client access']]
const TITLE = Object.fromEntries(SECTIONS) as Record<Section, string>
const KEY = 'abaya.clientPortal.project'
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

/** Staff page: see a project exactly as its client does, and edit each section in place. */
export default function ClientPortal() {
  const projects = useLoad(async () => must(await supabase.from('projects')
    .select('id, number, name, status, category, categories, sector, address, next_milestone, client_id, clients(name)')
    .order('number', { ascending: false })) as unknown as Project[])
  const [pid, setPid] = useState<string | null>(read(KEY))
  const list = projects.data ?? []
  const p = list.find((x) => x.id === pid) ?? list.find((x) => x.number === '2610A') ?? list.find((x) => x.status === 'active') ?? list[0]
  const pick = (id: string) => { setPid(id); write(KEY, id); setEdit(null); setPath('/projects') }
  // where the client is inside the preview: '/', '/invoices' or '/projects' (the picked project)
  const [path, setPath] = useState('/projects')
  const bodyRef = useRef<HTMLDivElement>(null)

  const [edit, setEdit] = useState<Section | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const t = useRef<number | undefined>(undefined)
  // any change in the editor refreshes the preview shortly after (reads only)
  const soon = () => { window.clearTimeout(t.current); t.current = window.setTimeout(() => setReloadKey((k) => k + 1), 900) }
  useEffect(() => () => window.clearTimeout(t.current), [])

  const go = (to: string) => {
    const m = to.match(/^\/projects\/(.+)$/)
    if (m) { setPid(m[1]); write(KEY, m[1]); setPath('/projects') } else setPath(to)
    if (to !== '/projects' && !m) setEdit((e) => (e === 'invoices' || e === 'access' ? e : null))
    bodyRef.current?.scrollIntoView({ block: 'nearest' })
  }
  if (projects.error) return <p className="err">{projects.error}</p>
  if (!projects.data) return <p>Loading…</p>
  if (!p) return <p className="card pad muted">No projects yet.</p>

  const options = list.map((x) => ({ value: x.id, label: `${x.number} · ${x.name}`, chip: x.number, color: sectorColor(x.sector),
    search: `${x.number} ${x.name} ${x.clients?.name ?? ''}`, hint: x.clients?.name ?? 'No client', group: x.status === 'active' ? 'Active' : x.status === 'proposal' ? 'Proposal' : x.status === 'paused' ? 'Paused' : 'Complete' }))
    .sort((a, b) => ['Active', 'Proposal', 'Paused', 'Complete'].indexOf(a.group) - ['Active', 'Proposal', 'Paused', 'Complete'].indexOf(b.group))

  const nav: PreviewNavT = { go, path, clientId: p.client_id }
  return (
    <div className="stack cp-page">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Client portal</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>What your client sees for this project. Click <strong>✎ Edit</strong> on any section to change it.</p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div style={{ width: 340 }}><Combobox id="cp-proj" label="Project" options={options} value={p.id} onChange={(v) => v && pick(v)} placeholder="Find a project…" /></div>
          <button type="button" className="btn small secondary" onClick={() => setReloadKey((k) => k + 1)}>↻ Refresh</button>
          <Link className="btn small secondary" to={`/projects/${p.id}`}>Open project ›</Link>
        </div>
      </div>

      {!p.client_id && <p className="card pad" style={{ borderLeft: '4px solid var(--amber)', margin: 0 }}>No client is set on this project, so nobody can see this portal yet. <button type="button" className="linkish" onClick={() => setEdit('access')}>Set up client access</button></p>}

      <div className={'cp-wrap' + (edit ? ' editing' : '')}>
        <div className="cp-frame" aria-label="Client view preview">
          <div className="cp-chrome"><span /><span /><span /><em>Client view · {p.clients?.name ?? 'no client yet'}</em>
            <button type="button" className="cp-access" onClick={() => setEdit('access')}>Client access</button></div>
          <PreviewNav.Provider value={nav}>
            <ClientHeader preview={nav} email={p.clients?.name ?? null} />
            <div className="cp-body" ref={bodyRef}>
              {path === '/' ? <ClientHome key={'h' + reloadKey} />
                : path.startsWith('/invoices') ? <ClientInvoices key={'i' + reloadKey} />
                : <ClientProjectView key={p.id} projectId={p.id} preview={{ onEdit: setEdit, active: edit === 'access' ? null : edit, reloadKey }} />}
            </div>
          </PreviewNav.Provider>
        </div>

        {edit && <aside className="cp-panel card" aria-label={`Edit ${TITLE[edit]}`}
          onSubmitCapture={soon} onClickCapture={(e) => { if ((e.target as HTMLElement).closest('button')) soon() }} onChangeCapture={(e) => { const el = e.target as HTMLElement; if (el.tagName === 'SELECT' || (el as HTMLInputElement).type === 'date' || (el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'file') soon() }}>
          <div className="cp-panel-h">
            <strong>Edit · {TITLE[edit]}</strong>
            <button type="button" className="cp-x" onClick={() => setEdit(null)} aria-label="Close editor">×</button>
          </div>
          <nav className="cp-tabs" aria-label="Sections">
            {SECTIONS.map(([k, l]) => <button key={k} type="button" aria-current={edit === k ? 'page' : undefined} onClick={() => setEdit(k)}>{l}</button>)}
          </nav>
          <div className="cp-panel-b">
            <Editor key={p.id + edit} section={edit} project={p} onSaved={soon} />
          </div>
        </aside>}
      </div>
    </div>
  )
}


function Editor({ section, project, onSaved }: { section: Section; project: Project; onSaved: () => void }) {
  const d = useLoad(async () => ({
    phases: sortPhases(must(await supabase.from('phases').select('id, code, fee, fee_pct, status, start_date, end_date, meetings_included').eq('project_id', project.id)) as Phase[]),
    invoices: must(await supabase.from('invoices').select('id, number, status, total, amount_paid, issue_date, due_date').eq('project_id', project.id).order('issue_date', { ascending: false })) as Inv[],
  }), [project.id])
  if (d.error) return <p className="err">{d.error}</p>
  if (!d.data) return <p className="muted">Loading…</p>
  const { phases, invoices } = d.data
  switch (section) {
    case 'updates': return <UpdatesTab projectId={project.id} />
    case 'drawings': return <DrawingsTab projectId={project.id} phases={phases} invoices={invoices} />
    case 'contract': return <ContractTab projectId={project.id} phases={phases} onSaved={() => { d.reload(); onSaved() }} />
    case 'requests': return <RequestsTab projectId={project.id} />
    case 'access': return <ClientAccessTab project={project} />
    case 'model': return <ModelEditor projectId={project.id} onSaved={onSaved} />
    case 'phases': case 'schedule': return <PhasesEditor phases={phases} onSaved={() => { d.reload(); onSaved() }} projectId={project.id} />
    case 'invoices': return <InvoicesEditor invoices={invoices} />
  }
}

function PhasesEditor({ projectId, phases, onSaved }: { projectId: string; phases: Phase[]; onSaved: () => void }) {
  const [err, setErr] = useState('')
  const save = async (id: string, patch: Partial<Phase>) => {
    setErr('')
    const { error } = await supabase.from('phases').update(patch).eq('id', id)
    if (error) setErr(error.message); else onSaved()
  }
  if (!phases.length) return <p className="muted">No phases yet. Add them on the <Link to={`/projects/${projectId}`}>project page</Link>.</p>
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>The client sees each phase’s status in “Where we are” and its dates in the Schedule.</p>
      {phases.map((ph) => (
        <div key={ph.id} className="cp-phase">
          <div className="row between"><strong>{ph.code} · {PHASE_NAME[ph.code] ?? ph.code}</strong>
            <label className="sr" htmlFor={'ps' + ph.id}>Status</label>
            <select id={'ps' + ph.id} className="input" style={{ width: 150, minHeight: 34 }} value={ph.status} onChange={(e) => save(ph.id, { status: e.target.value })}>
              {Object.entries(PHASE_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
          <div className="row" style={{ gap: 8 }}>
            <label className="cp-date">Start<input type="date" className="input" defaultValue={ph.start_date ?? ''} onBlur={(e) => e.target.value !== (ph.start_date ?? '') && save(ph.id, { start_date: e.target.value || null })} /></label>
            <label className="cp-date">End<input type="date" className="input" defaultValue={ph.end_date ?? ''} onBlur={(e) => e.target.value !== (ph.end_date ?? '') && save(ph.id, { end_date: e.target.value || null })} /></label>
          </div>
        </div>
      ))}
      {err && <p className="err" role="alert">{err}</p>}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Fees and teams are set on the <Link to={`/projects/${projectId}`}>project page</Link>.</p>
    </div>
  )
}

function ModelEditor({ projectId, onSaved }: { projectId: string; onSaved: () => void }) {
  const files = useLoad(async () => ((await supabase.storage.from('models').list(projectId)).data ?? []).filter((f) => f.name && !f.name.startsWith('.')), [projectId])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const upload = async (f: File | undefined) => {
    if (!f) return
    setErr(''); setBusy(true)
    const { error } = await supabase.storage.from('models').upload(`${projectId}/${f.name}`, f, { upsert: true })
    setBusy(false)
    if (error) return setErr(error.message)
    files.reload(); onSaved()
  }
  const remove = async (name: string) => {
    if (!window.confirm(`Remove ${name} from the client portal? This deletes the file.`)) return
    const { error } = await supabase.storage.from('models').remove([`${projectId}/${name}`])
    if (error) return setErr(error.message)
    files.reload(); onSaved()
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Upload the exported model (.glb or .gltf). The client can download it from the 3D model card.</p>
      <label className="btn small secondary" style={{ alignSelf: 'flex-start' }}>{busy ? 'Uploading…' : 'Upload model'}
        <input type="file" accept=".glb,.gltf,.skp" hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} /></label>
      {err && <p className="err" role="alert">{err}</p>}
      {files.data?.length === 0 && <p className="muted" style={{ margin: 0 }}><em>No model uploaded.</em></p>}
      <ul className="cp-files">{files.data?.map((f) => <li key={f.name}><span>{f.name}</span>
        <span className="muted">{f.updated_at ? fmtDate(f.updated_at) : ''}</span>
        <button type="button" className="linkish" onClick={() => remove(f.name)}>Remove</button></li>)}</ul>
    </div>
  )
}

function InvoicesEditor({ invoices }: { invoices: Inv[] }) {
  const shown = invoices.filter((i) => i.status !== 'draft')
  const drafts = invoices.filter((i) => i.status === 'draft')
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Clients see sent invoices only — drafts stay hidden until you send them.</p>
      <ul className="cp-files">{invoices.map((i) => <li key={i.id}><Link to={`/invoices/${i.id}`}>{i.number}</Link>
        <span className="muted">{i.status === 'draft' ? 'Draft · hidden' : i.status}</span><span>{money(i.total)}</span></li>)}</ul>
      {!invoices.length && <p className="muted" style={{ margin: 0 }}><em>No invoices yet.</em></p>}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{shown.length} visible · {drafts.length} draft{drafts.length === 1 ? '' : 's'}</p>
      <Link className="btn small" style={{ alignSelf: 'flex-start' }} to="/invoices/new">New invoice</Link>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, money, SECTOR_COLOR, CATEGORY_NAME, PHASES, PHASE_NAME } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { useAuth } from '../lib/auth'
import UpdateCard from '../client/UpdateCard'
import BudgetTab from './budget/BudgetTab'
import './budget.css'
import { sortPhases, fmtDate, signedPhotoUrls, uid, extOf,
  type Update, type Drawing, type ContractItem, type Meeting, type ServiceRequest } from '../lib/projectContent'

type Phase = { id: string; code: string; fee: number; status: string; start_date: string | null; end_date: string | null; meetings_included: number | null }
type Entry = { phase_id: string | null; minutes: number; profiles: { full_name: string | null; bill_rate: number | null } | null }
type Project = { id: string; number: string; name: string; status: string; category: string | null; sector: string | null; address: string | null; next_milestone: string | null; client_id: string | null; clients: { name: string } | null }
type Inv = { id: string; number: string; status: string; total: number }

// Project sub-menu, Monograph-style: core pages, then client-facing content
const NAV_MAIN = [['overview', 'Overview'], ['budget', 'Budget'], ['settings', 'Details'], ['drawings', 'Files']] as const
const NAV_CLIENT = [['updates', 'Updates'], ['contract', 'Contract'], ['requests', 'Requests'], ['client', 'Client access']] as const
type Tab = typeof NAV_MAIN[number][0] | typeof NAV_CLIENT[number][0]
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function ProjectDetail() {
  const { id } = useParams()
  const [tab, setTab] = useState<Tab>('budget')
  useEffect(() => { setTab('budget') }, [id])
  const { data, error, reload } = useLoad(async () => {
    const p = must(await supabase.from('projects').select('id, number, name, status, category, sector, address, next_milestone, client_id, clients(name)').eq('id', id!).single()) as unknown as Project
    const phases = sortPhases(must(await supabase.from('phases').select('id, code, fee, status, start_date, end_date, meetings_included').eq('project_id', id!)) as Phase[])
    const billed = must(await supabase.from('phase_billing').select('phase_id, billed').eq('project_id', id!)) as { phase_id: string; billed: number }[]
    const time = must(await supabase.from('time_entries').select('phase_id, minutes, profiles(full_name, bill_rate)').eq('project_id', id!)) as unknown as Entry[]
    const invoices = must(await supabase.from('invoices').select('id, number, status, total').eq('project_id', id!).order('issue_date', { ascending: false })) as Inv[]
    return { p, phases, billed, time, invoices }
  }, [id])
  if (error) return <p className="err">{error}</p>
  if (!data) return <p>Loading…</p>
  const { p, phases, billed, time, invoices } = data
  const billedBy = Object.fromEntries(billed.map((b) => [b.phase_id, Number(b.billed)]))
  const used = (phaseId: string) => time.filter((t) => t.phase_id === phaseId).reduce((a, t) => ({ hrs: a.hrs + t.minutes / 60, cost: a.cost + (t.minutes / 60) * Number(t.profiles?.bill_rate ?? 0) }), { hrs: 0, cost: 0 })
  const totFee = phases.reduce((a, x) => a + Number(x.fee), 0)
  const totBilled = invoices.filter((i) => i.status === 'open' || i.status === 'paid').reduce((a, i) => a + Number(i.total), 0)
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
      <p className="muted" style={{ margin: 0 }}>{p.clients?.name ?? 'No client'}{p.address ? ` · ${p.address}` : ''}</p>
      <div className="pb-layout">
        <nav className="pb-subnav" aria-label="Project">
          {NAV_MAIN.map(([k, l]) => <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>)}
          <p className="pb-sep">Client portal</p>
          {NAV_CLIENT.map(([k, l]) => <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>)}
        </nav>
        <div className="stack" style={{ minWidth: 0 }}>
      {tab === 'overview' && <>
      <section className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }} aria-label="Summary">
        {[['Total fee', money(totFee)], ['Invoiced', money(totBilled)], ['Left to bill', money(totFee - totBilled)], ['Hours logged', totHrs.toFixed(1)]].map(([l, v]) => (
          <div key={l} style={{ padding: '16px 20px', borderRight: '1px solid #ece9e3' }}><div className="muted" style={{ fontSize: 14 }}>{l}</div><div className="num" style={{ fontSize: 26, fontWeight: 700 }}>{v}</div></div>))}
      </section>
      <section className="card pad stack">
        <h2>Phases</h2>
        <div style={{ overflowX: 'auto' }}><table className="table" style={{ minWidth: 980 }}>
          <thead><tr><th>Phase</th><th>Status</th><th>Start</th><th>End</th><th className="r">Fee</th><th className="r">Billed</th><th className="r">Hours</th><th>Fee used (labor at rates)</th><th></th></tr></thead>
          <tbody>{phases.map((ph) => <PhaseRow key={ph.id} ph={ph} billed={billedBy[ph.id] ?? 0} used={used(ph.id)} onSaved={reload} />)}</tbody>
        </table></div>
        {missing.length > 0 && <AddPhase projectId={p.id} codes={missing.map(([c]) => c)} onSaved={reload} />}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}><em>Fee used = hours × each person’s billable rate. The bar turns orange at 75% and red at 90%. Phase start and end dates drive the client’s schedule. Assign the team and hours on the Budget page.</em></p>
      </section>
      </>}
      {tab === 'budget' && <BudgetTab key={p.id + phases.map((x) => x.id + x.fee + x.status).join()} projectId={p.id} />}
      {tab === 'updates' && <UpdatesTab projectId={p.id} />}
      {tab === 'drawings' && <DrawingsTab projectId={p.id} phases={phases} invoices={invoices} />}
      {tab === 'contract' && <ContractTab projectId={p.id} phases={phases} onSaved={reload} />}
      {tab === 'requests' && <RequestsTab projectId={p.id} />}
      {tab === 'client' && <ClientAccessTab project={p} />}
      {tab === 'settings' && <SettingsTab project={p} onSaved={reload} />}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Settings ---------------- */
function SettingsTab({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const clients = useLoad(async () => must(await supabase.from('clients').select('id, name').order('name')) as { id: string; name: string }[])
  const [f, setF] = useState({ number: project.number, name: project.name, client_id: project.client_id ?? '', category: project.category ?? '', sector: project.sector ?? '', status: project.status, address: project.address ?? '', next_milestone: project.next_milestone ?? '' })
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setMsg('') }
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const { error } = await supabase.from('projects').update({ number: f.number.trim(), name: f.name.trim(), client_id: f.client_id || null, category: f.category || null, sector: f.sector || null,
      status: f.status, address: f.address || null, next_milestone: f.next_milestone || null }).eq('id', project.id)
    if (error) setErr(error.message); else { setMsg('Saved.'); onSaved() }
  }
  return (
    <form onSubmit={save} className="card pad stack">
      <h2>Project settings</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <div><label className="l" htmlFor="s-num">Number</label><input id="s-num" className="input" required value={f.number} onChange={set('number')} /></div>
        <div><label className="l" htmlFor="s-name">Name</label><input id="s-name" className="input" required value={f.name} onChange={set('name')} /></div>
        <div><label className="l" htmlFor="s-cl">Client</label><select id="s-cl" className="input" value={f.client_id} onChange={set('client_id')}><option value="">—</option>{clients.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="l" htmlFor="s-cat">Type</label><select id="s-cat" className="input" value={f.category} onChange={set('category')}><option value="">—</option><option value="S">Shell (S)</option><option value="FO">Interior Finish-Out (FO)</option><option value="CON">Consultation (CON)</option></select></div>
        <div><label className="l" htmlFor="s-sec">Building type</label><select id="s-sec" className="input" value={f.sector} onChange={set('sector')}><option value="">—</option><option value="commercial">Commercial / Retail</option><option value="residential">Residential</option><option value="medical">Medical</option><option value="consultation">Consultation</option><option value="civic">Civic</option><option value="internal">Internal</option></select></div>
        <div><label className="l" htmlFor="s-st">Status</label><select id="s-st" className="input" value={f.status} onChange={set('status')}><option value="active">Active</option><option value="paused">Paused</option><option value="complete">Complete</option><option value="proposal">Proposal</option></select></div>
        <div style={{ gridColumn: 'span 2' }}><label className="l" htmlFor="s-ad">Address</label><input id="s-ad" className="input" value={f.address} onChange={set('address')} /></div>
        <div style={{ gridColumn: 'span 2' }}><label className="l" htmlFor="s-nm">Next milestone (shown on the projects list)</label><input id="s-nm" className="input" value={f.next_milestone} onChange={set('next_milestone')} /></div>
      </div>
      {err && <p className="err" role="alert">{err}</p>}{msg && <p className="ok" role="status">{msg}</p>}
      <div><button className="btn">Save settings</button></div>
    </form>
  )
}

/* ---------------- Updates feed ---------------- */
function UpdatesTab({ projectId }: { projectId: string }) {
  const { profile } = useAuth()
  const list = useLoad(async () => must(await supabase.from('updates').select('*, profiles:author(full_name)').eq('project_id', projectId).order('created_at', { ascending: false })) as unknown as Update[], [projectId])
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => { const paths = (list.data ?? []).flatMap((u) => u.photo_paths); signedPhotoUrls(paths).then(setUrls) }, [list.data])
  const [f, setF] = useState({ kind: 'memo', title: '', body: '', items: '', visible: true, notify: 'digest' })
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const post = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!f.body.trim() && !f.items.trim() && !files.length) return setErr('Write something, add list items, or attach photos.')
    setBusy(true)
    try {
      const paths: string[] = []
      for (const file of files) {
        const path = `${projectId}/${uid()}.${extOf(file.name)}`
        const { error } = await supabase.storage.from('photos').upload(path, file, { contentType: file.type || undefined })
        if (error) throw error
        paths.push(path)
      }
      const items = f.items.split('\n').map((s) => s.trim()).filter(Boolean)
      const kind = files.length && f.kind === 'memo' && !f.body.trim() ? 'photos' : f.kind
      const u = must(await supabase.from('updates').insert({ project_id: projectId, author: profile?.id, kind, title: f.title.trim() || null, body: f.body.trim() || null,
        items, photo_paths: paths, visible_to_client: f.visible, notify: f.visible ? f.notify : 'none' }).select('id').single()) as { id: string }
      if (kind === 'meeting') await supabase.from('meetings').insert({ project_id: projectId, title: f.title.trim() || 'Meeting', update_id: u.id })
      setF({ ...f, title: '', body: '', items: '' }); setFiles([]); list.reload()
    } catch (x) { setErr(errText(x)) }
    setBusy(false)
  }
  const remove = async (u: Update) => {
    if (u.photo_paths.length) await supabase.storage.from('photos').remove(u.photo_paths)
    await supabase.from('updates').delete().eq('id', u.id); list.reload()
  }
  return (
    <div className="stack">
      <form onSubmit={post} className="card pad stack" aria-label="Post an update">
        <h2>Post an update</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '200px minmax(0,1fr)', gap: 12 }}>
          <div><label className="l" htmlFor="u-k">Kind</label><select id="u-k" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="memo">Memo</option><option value="list">List</option><option value="meeting">Meeting notes (counts as a meeting)</option><option value="change">Change from a meeting</option><option value="photos">Photos</option></select></div>
          <div><label className="l" htmlFor="u-t">Title (optional)</label><input id="u-t" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        </div>
        <div><label className="l" htmlFor="u-b">Message</label><textarea id="u-b" className="input" rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Write an update for the client…" /></div>
        {(f.kind === 'list' || f.kind === 'change' || f.kind === 'meeting') && <div><label className="l" htmlFor="u-i">{f.kind === 'change' ? 'Changes (one per line)' : 'Items (one per line)'}</label><textarea id="u-i" className="input" rows={4} value={f.items} onChange={(e) => setF({ ...f, items: e.target.value })} /></div>}
        <div><label className="l" htmlFor="u-p">Photos</label><input id="u-p" type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />{files.length > 0 && <span className="muted" style={{ marginLeft: 8 }}>{files.length} selected</span>}</div>
        <div className="row" style={{ gap: 16 }}>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.visible} onChange={(e) => setF({ ...f, visible: e.target.checked })} style={{ width: 18, height: 18 }} />Visible to client</label>
          <label className="sr" htmlFor="u-n">Notify client</label>
          <select id="u-n" className="input" style={{ width: 'auto' }} disabled={!f.visible} value={f.notify} onChange={(e) => setF({ ...f, notify: e.target.value })}>
            <option value="digest">Include in tonight’s summary</option><option value="now">Email the client now</option><option value="none">Don’t notify</option></select>
          <button className="btn" disabled={busy}>{busy ? 'Posting…' : 'Post'}</button>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}><em>Client emails aren’t connected yet — notices are queued on the Notifications page.</em></p>
      </form>
      {list.error && <p className="err">{list.error}</p>}
      {list.data?.length === 0 && <p className="muted card pad"><em>No updates yet.</em></p>}
      {list.data?.map((u) => <UpdateCard key={u.id} u={u} urls={urls} onDelete={() => remove(u)} />)}
    </div>
  )
}

/* ---------------- Drawings ---------------- */
function DrawingsTab({ projectId, phases, invoices }: { projectId: string; phases: Phase[]; invoices: Inv[] }) {
  const { profile } = useAuth()
  const list = useLoad(async () => must(await supabase.from('drawings').select('*').eq('project_id', projectId).order('issued_on', { ascending: false })) as Drawing[], [projectId])
  const [f, setF] = useState({ title: '', phase_id: '', sheet_count: '', issued_on: new Date().toISOString().slice(0, 10), lock: '' })
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const unpaid = invoices.filter((i) => i.status === 'open' || i.status === 'draft')
  const invNum = Object.fromEntries(invoices.map((i) => [i.id, i]))
  const upload = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!file) return setErr('Choose a PDF.')
    setBusy(true)
    try {
      const path = `${projectId}/${uid()}.pdf`
      const { error } = await supabase.storage.from('drawings').upload(path, file, { contentType: 'application/pdf' })
      if (error) throw error
      must(await supabase.from('drawings').insert({ project_id: projectId, phase_id: f.phase_id || null, title: f.title.trim() || file.name.replace(/\.pdf$/i, ''),
        sheet_count: f.sheet_count ? Number(f.sheet_count) : null, issued_on: f.issued_on, storage_path: path, locked_until_invoice: f.lock || null, uploaded_by: profile?.id }))
      setF({ ...f, title: '', sheet_count: '' }); setFile(null); const fi = document.getElementById('d-f') as HTMLInputElement | null; if (fi) fi.value = ''; list.reload()
    } catch (x) { setErr(errText(x)) }
    setBusy(false)
  }
  const open = async (d: Drawing) => {
    const { data, error } = await supabase.storage.from('drawings').createSignedUrl(d.storage_path, 600)
    if (error) return setErr(error.message)
    window.open(data.signedUrl, '_blank', 'noopener')
  }
  const setLock = async (d: Drawing, v: string) => { await supabase.from('drawings').update({ locked_until_invoice: v || null }).eq('id', d.id); list.reload() }
  const remove = async (d: Drawing) => { await supabase.storage.from('drawings').remove([d.storage_path]); await supabase.from('drawings').delete().eq('id', d.id); list.reload() }
  const code = (pid: string | null) => phases.find((x) => x.id === pid)?.code
  return (
    <div className="stack">
      <form onSubmit={upload} className="card pad stack" aria-label="Upload drawings">
        <h2>Issue drawings</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,2fr) minmax(160px,1fr) 110px 160px', gap: 12 }}>
          <div><label className="l" htmlFor="d-t">Title</label><input id="d-t" className="input" value={f.title} placeholder="e.g. 100% CD set" onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div><label className="l" htmlFor="d-ph">Phase</label><select id="d-ph" className="input" value={f.phase_id} onChange={(e) => setF({ ...f, phase_id: e.target.value })}><option value="">—</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.code} · {PHASE_NAME[p.code]}</option>)}</select></div>
          <div><label className="l" htmlFor="d-s">Sheets</label><input id="d-s" className="input num" inputMode="numeric" value={f.sheet_count} onChange={(e) => setF({ ...f, sheet_count: e.target.value })} /></div>
          <div><label className="l" htmlFor="d-i">Issued</label><input id="d-i" type="date" className="input" value={f.issued_on} onChange={(e) => setF({ ...f, issued_on: e.target.value })} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) minmax(220px,1fr)', gap: 12 }}>
          <div><label className="l" htmlFor="d-f">PDF</label><input id="d-f" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          <div><label className="l" htmlFor="d-l">Hold until paid</label><select id="d-l" className="input" value={f.lock} onChange={(e) => setF({ ...f, lock: e.target.value })}>
            <option value="">Release now</option>{unpaid.map((i) => <option key={i.id} value={i.id}>Locked until invoice {i.number} ({money(i.total)}) is paid</option>)}</select></div>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        <div><button className="btn" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button></div>
      </form>
      <section className="card" style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 820 }}>
          <thead><tr><th>Drawing</th><th>Phase</th><th className="r">Sheets</th><th>Issued</th><th>Client access</th><th></th></tr></thead>
          <tbody>
            {list.data?.map((d) => { const inv = d.locked_until_invoice ? invNum[d.locked_until_invoice] : null; const locked = inv && inv.status !== 'paid'
              return <tr key={d.id}>
                <td><button className="linkbtn" onClick={() => open(d)}>{d.title}</button></td><td>{code(d.phase_id) ?? '—'}</td><td className="r num">{d.sheet_count ?? '—'}</td><td>{fmtDate(d.issued_on)}</td>
                <td><label className="sr" htmlFor={'lk' + d.id}>Hold until paid</label><select id={'lk' + d.id} className="input" style={{ minHeight: 36, color: locked ? 'var(--red)' : 'var(--green)', fontWeight: 700 }} value={d.locked_until_invoice ?? ''} onChange={(e) => setLock(d, e.target.value)}>
                  <option value="">Released</option>{invoices.map((i) => <option key={i.id} value={i.id}>{i.status === 'paid' ? `Released — ${i.number} paid` : `Locked until ${i.number} is paid`}</option>)}</select></td>
                <td><button className="btn small danger" onClick={() => remove(d)}>Delete</button></td></tr> })}
            {list.data?.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}><em>No drawings issued yet.</em></td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}

/* ---------------- Contract scope ---------------- */
function ContractTab({ projectId, phases, onSaved }: { projectId: string; phases: Phase[]; onSaved: () => void }) {
  const d = useLoad(async () => ({
    items: must(await supabase.from('contract_items').select('*').eq('project_id', projectId).order('sort')) as ContractItem[],
    meetings: must(await supabase.from('meetings').select('*').eq('project_id', projectId).order('held_on', { ascending: false })) as Meeting[],
  }), [projectId])
  const [ni, setNi] = useState({ title: '', phase_id: '' })
  const [nm, setNm] = useState({ title: '', phase_id: '', held_on: new Date().toISOString().slice(0, 10) })
  const held = (pid: string) => (d.data?.meetings ?? []).filter((m) => m.phase_id === pid).length
  const unassigned = (d.data?.meetings ?? []).filter((m) => !m.phase_id).length
  const setIncluded = async (ph: Phase, v: string) => { await supabase.from('phases').update({ meetings_included: v === '' ? null : Number(v) }).eq('id', ph.id); onSaved() }
  const addItem = async () => { if (!ni.title.trim()) return; await supabase.from('contract_items').insert({ project_id: projectId, phase_id: ni.phase_id || null, title: ni.title.trim(), sort: (d.data?.items.length ?? 0) + 1 }); setNi({ ...ni, title: '' }); d.reload() }
  const addMeeting = async () => { await supabase.from('meetings').insert({ project_id: projectId, phase_id: nm.phase_id || null, title: nm.title.trim() || 'Meeting', held_on: nm.held_on }); setNm({ ...nm, title: '' }); d.reload() }
  return (
    <div className="stack">
      <section className="card pad stack">
        <h2>Meetings per phase</h2>
        <table className="table"><thead><tr><th>Phase</th><th className="r">Included in contract</th><th className="r">Held</th><th>Status</th></tr></thead><tbody>
          {phases.map((ph) => { const h = held(ph.id); const inc = ph.meetings_included
            return <tr key={ph.id}><td><strong>{ph.code}</strong> <span className="muted">{PHASE_NAME[ph.code]}</span></td>
              <td className="r"><label className="sr" htmlFor={'mi' + ph.id}>Meetings included</label><input id={'mi' + ph.id} className="input num" style={{ width: 90, textAlign: 'right' }} inputMode="numeric" defaultValue={inc ?? ''} onBlur={(e) => { if (e.target.value !== String(inc ?? '')) setIncluded(ph, e.target.value) }} /></td>
              <td className="r num">{h}</td>
              <td>{inc == null ? <span className="muted">—</span> : h > inc ? <strong style={{ color: 'var(--red)' }}>{h - inc} over — additional service</strong> : <span style={{ color: 'var(--green)', fontWeight: 700 }}>{inc - h} left</span>}</td></tr> })}
        </tbody></table>
        {unassigned > 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{unassigned} meeting(s) not tied to a phase.</p>}
      </section>
      <section className="card pad stack">
        <h2>Meetings log</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div><label className="l" htmlFor="m-d">Date</label><input id="m-d" type="date" className="input" value={nm.held_on} onChange={(e) => setNm({ ...nm, held_on: e.target.value })} /></div>
          <div><label className="l" htmlFor="m-ph">Phase</label><select id="m-ph" className="input" value={nm.phase_id} onChange={(e) => setNm({ ...nm, phase_id: e.target.value })}><option value="">—</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></div>
          <div style={{ flex: 1, minWidth: 220 }}><label className="l" htmlFor="m-t">Title</label><input id="m-t" className="input" value={nm.title} onChange={(e) => setNm({ ...nm, title: e.target.value })} /></div>
          <button className="btn secondary" onClick={addMeeting}>+ Log meeting</button>
        </div>
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>{d.data?.meetings.map((m) => <li key={m.id} className="row between" style={{ padding: '8px 0', borderTop: '1px solid #efece6' }}>
          <span>{fmtDate(m.held_on)} · <strong>{m.title ?? 'Meeting'}</strong> {m.phase_id && <span className="muted">· {phases.find((p) => p.id === m.phase_id)?.code}</span>}</span>
          <span className="row"><label className="sr" htmlFor={'mp' + m.id}>Phase</label><select id={'mp' + m.id} className="input" style={{ minHeight: 34, width: 'auto' }} value={m.phase_id ?? ''} onChange={async (e) => { await supabase.from('meetings').update({ phase_id: e.target.value || null }).eq('id', m.id); d.reload() }}><option value="">No phase</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select>
            <button className="btn small danger" onClick={async () => { await supabase.from('meetings').delete().eq('id', m.id); d.reload() }}>×</button></span></li>)}</ul>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}><em>Posting “Meeting notes” in the updates feed logs a meeting automatically.</em></p>
      </section>
      <section className="card pad stack">
        <h2>Contracted drawings & deliverables</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 220 }}><label className="l" htmlFor="ci-t">Item</label><input id="ci-t" className="input" value={ni.title} placeholder="e.g. Reflected ceiling plans" onChange={(e) => setNi({ ...ni, title: e.target.value })} /></div>
          <div><label className="l" htmlFor="ci-p">Phase</label><select id="ci-p" className="input" value={ni.phase_id} onChange={(e) => setNi({ ...ni, phase_id: e.target.value })}><option value="">—</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></div>
          <button className="btn secondary" onClick={addItem}>+ Add</button>
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>{d.data?.items.map((it) => <li key={it.id} className="row between" style={{ padding: '8px 0', borderTop: '1px solid #efece6' }}>
          <span>{phases.find((p) => p.id === it.phase_id)?.code && <span className="pill" style={{ marginRight: 8 }}>{phases.find((p) => p.id === it.phase_id)?.code}</span>}{it.title}</span>
          <span className="row"><label className="sr" htmlFor={'cs' + it.id}>Status</label><select id={'cs' + it.id} className="input" style={{ minHeight: 34, width: 'auto' }} value={it.status} onChange={async (e) => { await supabase.from('contract_items').update({ status: e.target.value }).eq('id', it.id); d.reload() }}>
            <option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="complete">Complete</option></select>
            <button className="btn small danger" onClick={async () => { await supabase.from('contract_items').delete().eq('id', it.id); d.reload() }}>×</button></span></li>)}</ul>
      </section>
    </div>
  )
}

/* ---------------- Requests ---------------- */
function RequestsTab({ projectId }: { projectId: string }) {
  const list = useLoad(async () => must(await supabase.from('service_requests').select('*').eq('project_id', projectId).order('created_at', { ascending: false })) as ServiceRequest[], [projectId])
  const save = async (r: ServiceRequest, patch: Partial<ServiceRequest>) => { await supabase.from('service_requests').update(patch).eq('id', r.id); list.reload() }
  return (
    <section className="card pad stack">
      <h2>Additional service requests</h2>
      {list.data?.length === 0 && <p className="muted"><em>No requests from the client yet.</em></p>}
      {list.data?.map((r) => <div key={r.id} className="row between" style={{ padding: '10px 0', borderTop: '1px solid #efece6', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 240 }}><p style={{ margin: 0 }}>{r.description}</p><p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{fmtDate(r.created_at)}</p></div>
        <div className="row">
          <label className="sr" htmlFor={'rq' + r.id}>Quote</label><input id={'rq' + r.id} className="input num" style={{ width: 120 }} placeholder="Quote $" defaultValue={r.quote ?? ''} onBlur={(e) => save(r, { quote: e.target.value ? Number(e.target.value) : null })} />
          <label className="sr" htmlFor={'rs' + r.id}>Status</label><select id={'rs' + r.id} className="input" style={{ width: 'auto' }} value={r.status} onChange={(e) => save(r, { status: e.target.value })}>
            <option value="requested">Requested</option><option value="quoted">Quoted</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="done">Done</option></select>
        </div></div>)}
    </section>
  )
}

/* ---------------- Client access ---------------- */
function ClientAccessTab({ project }: { project: Project }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const d = useLoad(async () => {
    if (!project.client_id) return { contacts: [], invites: [], users: [] }
    const contacts = must(await supabase.from('client_contacts').select('*').eq('client_id', project.client_id).order('name')) as { id: string; name: string | null; email: string; receives_invoices: boolean; receives_updates: boolean }[]
    const invites = isAdmin ? (must(await supabase.from('invites').select('email').eq('client_id', project.client_id)) as { email: string }[]) : []
    const users = must(await supabase.from('profiles').select('email').eq('client_id', project.client_id)) as { email: string }[]
    return { contacts, invites, users }
  }, [project.client_id, isAdmin])
  const [nc, setNc] = useState({ name: '', email: '' }); const [err, setErr] = useState(''); const [msg, setMsg] = useState('')
  if (!project.client_id) return <p className="card pad muted">Set a client on the Settings tab first.</p>
  const invited = new Set([...(d.data?.invites ?? []), ...(d.data?.users ?? [])].map((x) => x.email.toLowerCase()))
  const signedIn = new Set((d.data?.users ?? []).map((x) => x.email.toLowerCase()))
  const add = async (e: React.FormEvent) => { e.preventDefault(); setErr('')
    const { error } = await supabase.from('client_contacts').insert({ client_id: project.client_id, name: nc.name.trim() || null, email: nc.email.trim().toLowerCase() })
    if (error) setErr(error.message); else { setNc({ name: '', email: '' }); d.reload() } }
  const invite = async (email: string, name: string | null) => { setErr(''); setMsg('')
    const { error } = await supabase.from('invites').upsert({ email: email.toLowerCase(), role: 'client', client_id: project.client_id, full_name: name, invited_by: profile?.id })
    if (error) setErr(error.message); else { setMsg(`${email} can now sign in at the portal with their email.`); d.reload() } }
  const toggle = async (id: string, k: 'receives_invoices' | 'receives_updates', v: boolean) => { await supabase.from('client_contacts').update({ [k]: v }).eq('id', id); d.reload() }
  return (
    <section className="card pad stack">
      <h2>Client access — {project.clients?.name}</h2>
      <p className="muted" style={{ margin: 0 }}>Contacts belong to the client, so they see every project for {project.clients?.name}.</p>
      <table className="table"><thead><tr><th>Name</th><th>Email</th><th>Invoices</th><th>Updates</th><th>Portal</th></tr></thead><tbody>
        {d.data?.contacts.map((c) => <tr key={c.id}><td>{c.name ?? '—'}</td><td>{c.email}</td>
          <td><input type="checkbox" aria-label={`${c.email} receives invoices`} checked={c.receives_invoices} onChange={(e) => toggle(c.id, 'receives_invoices', e.target.checked)} style={{ width: 18, height: 18 }} /></td>
          <td><input type="checkbox" aria-label={`${c.email} receives updates`} checked={c.receives_updates} onChange={(e) => toggle(c.id, 'receives_updates', e.target.checked)} style={{ width: 18, height: 18 }} /></td>
          <td>{signedIn.has(c.email.toLowerCase()) ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>Signed in</span> : invited.has(c.email.toLowerCase()) ? <span className="muted">Invited</span>
            : isAdmin ? <button className="btn small secondary" onClick={() => invite(c.email, c.name)}>Invite to portal</button> : <span className="muted">Admin can invite</span>}</td></tr>)}
        {d.data?.contacts.length === 0 && <tr><td colSpan={5} className="muted"><em>No contacts yet.</em></td></tr>}
      </tbody></table>
      <form onSubmit={add} className="row" style={{ alignItems: 'flex-end' }}>
        <div><label className="l" htmlFor="cc-n">Name</label><input id="cc-n" className="input" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} /></div>
        <div style={{ minWidth: 260 }}><label className="l" htmlFor="cc-e">Email</label><input id="cc-e" type="email" required className="input" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></div>
        <button className="btn secondary">+ Add contact</button>
      </form>
      {err && <p className="err" role="alert">{err}</p>}{msg && <p className="ok" role="status">{msg}</p>}
    </section>
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

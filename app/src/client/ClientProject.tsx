import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CLink as Link } from './preview'
import { supabase, money, SECTOR_COLOR, CATEGORY_NAME, PHASE_NAME, phaseLabel } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { sortPhases, fmtDate, signedPhotoUrls, drawingLink,
  type PhaseRow, type Update, type Drawing, type ContractItem, type Meeting, type ServiceRequest } from '../lib/projectContent'
import ClientGantt from './ClientGantt'
import UpdateCard from './UpdateCard'
import './client.css'
const ModelViewer = lazy(() => import('./ModelViewer'))
import Renderings from './Renderings'

type P = { id: string; number: string; name: string; sector: string | null; category: string | null; categories: string[] | null; address: string | null; status: string }
type Inv = { id: string; number: string; status: string; issue_date?: string | null; total: number; amount_paid: number; due_date: string | null }

export type EditSection = 'model' | 'phases' | 'drawings' | 'updates' | 'contract' | 'schedule' | 'requests' | 'invoices'
type Preview = { onEdit: (s: EditSection) => void; active: EditSection | null; reloadKey: number }

export default function ClientProject() {
  const { id } = useParams()
  return <ClientProjectView projectId={id!} />
}

// Staff "Client portal" page renders this same view with edit handles on each section
function Ed({ pv, s, children }: { pv?: Preview; s: EditSection; children: React.ReactNode }) {
  if (!pv) return <>{children}</>
  return <div className={'cp-ed' + (pv.active === s ? ' on' : '')}>{children}
    <button type="button" className="cp-ed-btn" onClick={() => pv.onEdit(s)} aria-label={`Edit ${s}`}>✎ Edit</button></div>
}

export function ClientProjectView({ projectId, preview: pv }: { projectId: string; preview?: Preview }) {
  const id = projectId
  const { profile } = useAuth()
  const d = useLoad(async () => ({
    p: must(await supabase.from('projects').select('id, number, name, sector, category, categories, address, status').eq('id', id!).single()) as P,
    phases: sortPhases(must(await supabase.from('phases').select('id, code, sort, name, fee, status, start_date, end_date, meetings_included').eq('project_id', id!).neq('code', 'AS')) as PhaseRow[]),
    updates: must(await supabase.from('updates').select('*').eq('project_id', id!).order('created_at', { ascending: false }).limit(30)) as Update[],
    drawings: must(await supabase.from('drawings').select('*').eq('project_id', id!).order('issued_on', { ascending: false })) as Drawing[],
    items: must(await supabase.from('contract_items').select('*').eq('project_id', id!).order('sort')) as ContractItem[],
    meetings: must(await supabase.from('meetings').select('*').eq('project_id', id!)) as Meeting[],
    requests: must(await supabase.from('service_requests').select('*').eq('project_id', id!).order('created_at', { ascending: false })) as ServiceRequest[],
    invoices: must(await supabase.from('invoices').select('id, number, status, issue_date, total, amount_paid, due_date').eq('project_id', id!).order('issue_date', { ascending: false })) as Inv[],
    agreements: must(await supabase.from('agreements').select('id, title, status, signed_at').eq('project_id', id!).in('status', ['sent', 'signed']).order('created_at', { ascending: false })) as { id: string; title: string; status: string; signed_at: string | null }[],
    team: must(await supabase.from('project_contacts').select('id, trade, contacts(name, company, email, phone)').eq('project_id', id!).eq('show_to_client', true).order('created_at')) as unknown as Team[],
    models: ((await supabase.storage.from('models').list(id!)).data ?? []).filter((f) => f.id && f.name && !f.name.startsWith('.')),
  }), [id])
  const reloadKey = pv?.reloadKey ?? 0
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } d.reload() }, [reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => { signedPhotoUrls((d.data?.updates ?? []).flatMap((u) => u.photo_paths)).then(setUrls) }, [d.data])
  const [lock, setLock] = useState<{ title: string; invoice: string | null } | null>(null)
  const [err, setErr] = useState('')

  if (d.error) return <p className="err">{d.error}</p>
  if (!d.data) return <p>Loading…</p>
  const { p, phases, drawings, items, meetings, requests, invoices, models, team, agreements } = d.data
  // staff can read hidden updates; the preview shows only what the client sees
  const updates = d.data.updates.filter((u) => u.visible_to_client)
  const invById = Object.fromEntries(invoices.map((i) => [i.id, i]))

  const openDrawing = async (dr: Drawing, download = false) => {
    setErr('')
    const inv = dr.locked_until_invoice ? invById[dr.locked_until_invoice] : null
    if (inv && inv.status !== 'paid') return setLock({ title: dr.title, invoice: inv.number })
    const r = await drawingLink(dr.id, download)
    if (r.locked) return setLock({ title: dr.title, invoice: r.invoice ?? null })
    if (r.error || !r.url) return setErr(r.error ?? 'Could not open the drawing.')
    window.open(r.url, '_blank', 'noopener')
  }

  return (
    <div className="stack">
      <Link to="/" style={{ fontWeight: 700, textDecoration: 'none' }}>‹ All projects</Link>
      <div>
        <h1 className="row" style={{ gap: 10 }}><span className="tag" style={{ background: SECTOR_COLOR[p.sector ?? 'internal'], height: 28, fontSize: 15 }}>{p.number}</span>{p.name}
          {(p.categories ?? []).map((c) => <abbr key={c} className="pill" title={CATEGORY_NAME[c]}>{c}</abbr>)}</h1>
        {p.address && <p className="muted" style={{ margin: '6px 0 0' }}>{p.address}</p>}
      </div>

      {agreements.map((a) => a.status === 'sent'
        ? <div key={a.id} className="card pad row between cs-ready"><span><strong>Your agreement is ready to sign.</strong> {a.title}</span>
            {pv ? <a className="btn" href={`#/proposals/${a.id}`}>Review &amp; sign</a> : <Link className="btn" to={`/agreements/${a.id}`}>Review &amp; sign</Link>}</div>
        : <div key={a.id} className="card pad row between" style={{ padding: '10px 16px' }}><span><span style={{ color: 'var(--green)', fontWeight: 700 }}>✓ Signed</span> {a.title}{a.signed_at ? ` · ${new Date(a.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</span>
            {pv ? <a className="btn small secondary" href={`#/proposals/${a.id}`}>View</a> : <Link className="btn small secondary" to={`/agreements/${a.id}`}>View</Link>}</div>)}

      <Ed pv={pv} s="model"><ModelPanel projectId={p.id} files={models.map((m) => ({ name: m.name, at: m.updated_at ?? m.created_at ?? '' }))} /></Ed>

      <Ed pv={pv} s="phases"><section className="card pad stack" aria-label="Phases">
        <h2>Schedule</h2>
        <ClientGantt phases={phases} />
      </section></Ed>

      <div className="cl-grid">
        <div className="stack">
          <Ed pv={pv} s="drawings"><Drawings phases={phases} drawings={drawings} invById={invById} onOpen={openDrawing} /></Ed>
          {err && <p className="err" role="alert">{err}</p>}
          <Ed pv={pv} s="updates"><section className="stack" aria-labelledby="feed-h">
            <h2 id="feed-h">Project updates</h2>
            {updates.length === 0 && <p className="muted card pad"><em>No updates yet.</em></p>}
            {updates.map((u) => <UpdateCard key={u.id} u={u} urls={urls} />)}
          </section></Ed>
        </div>
        <div className="stack">
          <Ed pv={pv} s="invoices"><InvoicesMini invoices={invoices} /></Ed>
          <Ed pv={pv} s="contract"><ContractPanel phases={phases} items={items} meetings={meetings} /></Ed>
          {team.length > 0 && <TeamPanel team={team} />}
          <Ed pv={pv} s="requests"><RequestPanel projectId={p.id} me={profile!.id} requests={requests} onSent={d.reload} preview={!!pv} /></Ed>
        </div>
      </div>

      {lock && <LockDialog title={lock.title} invoice={lock.invoice} onClose={() => setLock(null)} />}
    </div>
  )
}

function ModelPanel({ projectId, files }: { projectId: string; files: { name: string; at: string }[] }) {
  // view-only: newest .glb in the viewer, renderings in a gallery; no downloads
  const glb = [...files].filter((f) => /\.glb$/i.test(f.name)).sort((a, b) => b.at.localeCompare(a.at))[0]?.name
  const [url, setUrl] = useState<string | null>(null)
  const [imgs, setImgs] = useState<{ name: string; url: string }[]>([])
  const [tab, setTab] = useState<'model' | 'renderings' | null>(null)
  useEffect(() => {
    setUrl(null)
    // short-lived link: long enough for the viewer to load it, not worth sharing
    if (glb) supabase.storage.from('models').createSignedUrl(`${projectId}/${glb}`, 120).then(({ data }) => setUrl(data?.signedUrl ?? null))
  }, [projectId, glb])
  useEffect(() => {
    let live = true
    ;(async () => {
      const dir = `${projectId}/renderings`
      const list = ((await supabase.storage.from('models').list(dir, { sortBy: { column: 'name', order: 'asc' } })).data ?? []).filter((f) => f.id && !f.name.startsWith('.'))
      if (!list.length) { if (live) setImgs([]); return }
      const { data } = await supabase.storage.from('models').createSignedUrls(list.map((f) => `${dir}/${f.name}`), 3600)
      if (live) setImgs((data ?? []).filter((d) => d.signedUrl).map((d) => ({ name: d.path?.split('/').pop() ?? '', url: d.signedUrl as string })))
    })()
    return () => { live = false }
  }, [projectId])
  const show = tab ?? (glb ? 'model' : imgs.length ? 'renderings' : 'model')
  return (
    <section className="card" aria-label="3D model and renderings" style={{ overflow: 'hidden' }} onContextMenu={(e) => e.preventDefault()}>
      {show === 'renderings' && <Renderings images={imgs} />}
      {/* the viewer stays mounted while renderings are shown, so switching back doesn't reload the model */}
      {glb ? <div hidden={show !== 'model'}>{url ? <Suspense fallback={<div className="mv"><div className="mv-msg">Loading viewer…</div></div>}><ModelViewer url={url} /></Suspense>
          : <div className="mv"><div className="mv-msg">Loading model…</div></div>}</div>
        : show === 'model' && <div className="mv"><div className="mv-msg" style={{ textAlign: 'center', padding: 24 }}><div><strong style={{ fontSize: 18 }}>3D model</strong><p style={{ color: '#c5ccd8', margin: '8px 0 0', fontWeight: 400 }}>Your project’s 3D model will appear here once it’s published, so you can orbit around it and step through saved views.</p></div></div></div>}
      <div className="vis-tabs" role="tablist" aria-label="Project visuals">
        <button type="button" role="tab" aria-selected={show === 'model'} className={show === 'model' ? 'on' : ''} onClick={() => setTab('model')}>3D model</button>
        <button type="button" role="tab" aria-selected={show === 'renderings'} className={show === 'renderings' ? 'on' : ''} onClick={() => setTab('renderings')}>Renderings{imgs.length ? ` (${imgs.length})` : ''}</button>
      </div>
    </section>
  )
}

function Drawings({ phases, drawings, invById, onOpen }: { phases: PhaseRow[]; drawings: Drawing[]; invById: Record<string, Inv>; onOpen: (d: Drawing, dl?: boolean) => void }) {
  // latest phase first, so the newest work is at the top
  const groups = [...phases].reverse().map((ph) => ({ ph, list: drawings.filter((d) => d.phase_id === ph.id) })).filter((g) => g.list.length)
  const loose = drawings.filter((d) => !d.phase_id || !phases.some((p) => p.id === d.phase_id))
  if (!drawings.length) return <section className="card pad"><h2>Drawings</h2><p className="muted" style={{ margin: '8px 0 0' }}><em>No drawings have been issued yet.</em></p></section>
  const Row = ({ d, latest }: { d: Drawing; latest?: boolean }) => {
    const inv = d.locked_until_invoice ? invById[d.locked_until_invoice] : null
    const locked = !!inv && inv.status !== 'paid'
    return (
      <li style={{ padding: latest ? '12px 14px' : '10px 0', margin: latest ? '6px 0 10px' : 0, background: latest ? '#f4f7fa' : 'transparent', borderLeft: latest ? '4px solid var(--navy)' : 0, borderTop: latest ? 0 : '1px solid #efece6', borderRadius: latest ? 6 : 0 }}>
        <div className="row between">
          <div>{latest && <span className="pill" style={{ marginRight: 8, borderColor: 'var(--navy)', color: 'var(--navy)' }}>Latest issue</span>}<strong>{d.title}</strong>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Issued {fmtDate(d.issued_on)}{d.sheet_count ? ` · ${d.sheet_count} sheets` : ''}</div></div>
          <div className="row" style={{ gap: 6 }}>
            {locked && <span style={{ color: 'var(--red)', fontWeight: 700, fontSize: 13 }}>🔒 Held until {inv!.number} is paid</span>}
            <button className="btn small secondary" onClick={() => onOpen(d)}>{locked ? '🔒 View' : 'View'}</button>
            <button className="btn small secondary" onClick={() => onOpen(d, true)}>{locked ? '🔒 Download' : 'Download'}</button>
          </div>
        </div>
      </li>)
  }
  return (
    <section className="card pad stack" aria-labelledby="dr-h">
      <h2 id="dr-h">Drawings</h2>
      {groups.map(({ ph, list }) => (
        <div key={ph.id}><h3 style={{ margin: '4px 0', fontSize: 15 }}>{ph.code === 'CU' ? phaseLabel(ph) : `${ph.code} · ${PHASE_NAME[ph.code]}`}</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{list.map((d, i) => <Row key={d.id} d={d} latest={i === 0} />)}</ul></div>))}
      {loose.length > 0 && <div><h3 style={{ margin: '4px 0', fontSize: 15 }}>Other</h3><ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{loose.map((d) => <Row key={d.id} d={d} />)}</ul></div>}
    </section>
  )
}

function ContractPanel({ phases, items, meetings }: { phases: PhaseRow[]; items: ContractItem[]; meetings: Meeting[] }) {
  const withMeetings = phases.filter((p) => p.meetings_included != null || meetings.some((m) => m.phase_id === p.id))
  const ST: Record<string, [string, string]> = { complete: ['Complete', 'var(--green)'], in_progress: ['In progress', 'var(--amber)'], not_started: ['Not started', 'var(--muted)'] }
  return (
    <section className="card pad stack" aria-labelledby="ct-h">
      <h2 id="ct-h">Your contract</h2>
      <div>
        <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Meetings</h3>
        {withMeetings.length === 0 && <p className="muted" style={{ margin: 0 }}><em>Not set yet.</em></p>}
        {withMeetings.map((p) => { const held = meetings.filter((m) => m.phase_id === p.id).length; const inc = p.meetings_included ?? 0; const over = held > inc
          return <div key={p.id} style={{ margin: '0 0 10px' }}>
            <div className="row between" style={{ fontSize: 14 }}><span><strong>{p.code === 'CU' ? '' : p.code}</strong> {phaseLabel(p)}</span><span className="num" style={{ fontWeight: 700, color: over ? 'var(--red)' : 'var(--text)' }}>{held} of {inc}</span></div>
            <div aria-hidden="true" style={{ display: 'flex', gap: 4, marginTop: 4 }}>{Array.from({ length: Math.max(inc, held) }, (_, i) => <span key={i} style={{ flex: 1, height: 8, borderRadius: 4, background: i < held ? (i >= inc ? 'var(--red)' : 'var(--navy)') : '#ece9e3' }} />)}</div>
            {over && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--red)' }}>Meetings beyond the contract are billed as additional services.</p>}
          </div> })}
      </div>
      <div>
        <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Drawings in your contract</h3>
        {items.length === 0 ? <p className="muted" style={{ margin: 0 }}><em>Not set yet.</em></p> :
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{items.map((it) => { const [l, c] = ST[it.status] ?? ST.not_started
            return <li key={it.id} className="row between" style={{ padding: '6px 0', borderTop: '1px solid #efece6', fontSize: 14 }}><span>{phases.find((p) => p.id === it.phase_id)?.code && <span className="muted">{phases.find((p) => p.id === it.phase_id)?.code} · </span>}{it.title}</span><strong style={{ color: c }}>{l}</strong></li> })}</ul>}
      </div>
    </section>
  )
}

function RequestPanel({ projectId, me, requests, onSent, preview }: { projectId: string; me: string; requests: ServiceRequest[]; onSent: () => void; preview?: boolean }) {
  const [text, setText] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setOk('')
    if (preview) return setOk('Preview only — clients send requests from here.')
    if (!text.trim()) return setErr('Describe what you need.')
    const { error } = await supabase.from('service_requests').insert({ project_id: projectId, requested_by: me, description: text.trim() })
    if (error) return setErr(error.message)
    setText(''); setOk('Sent. We’ll reply with a quote before any extra work starts.'); onSent()
  }
  const L: Record<string, string> = { requested: 'Requested', quoted: 'Quote sent', approved: 'Approved', declined: 'Declined', done: 'Done' }
  return (
    <section className="card pad stack" aria-labelledby="rq-h">
      <h2 id="rq-h">Request additional services</h2>
      <form onSubmit={send} className="stack" style={{ gap: 8 }}>
        <label className="sr" htmlFor="rq-t">What do you need?</label>
        <textarea id="rq-t" className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. One more site visit, revised renderings, an extra layout option…" />
        <div><button className="btn small">Send request</button></div>
        {err && <p className="err" role="alert">{err}</p>}{ok && <p className="ok" role="status">{ok}</p>}
      </form>
      {requests.length > 0 && <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{requests.map((r) => <li key={r.id} style={{ padding: '6px 0', borderTop: '1px solid #efece6', fontSize: 14 }}>
        <div className="row between"><span>{r.description}</span><strong>{L[r.status] ?? r.status}{r.quote != null ? ` · ${money(r.quote)}` : ''}</strong></div></li>)}</ul>}
    </section>
  )
}

const INV_ST: Record<string, [string, string]> = { open: ['Open', 'var(--amber)'], paid: ['Paid', 'var(--green)'], void: ['Void', 'var(--muted)'], uncollectible: ['Closed', 'var(--muted)'] }
type Team = { id: string; trade: string; contacts: { name: string | null; company: string | null; email: string | null; phone: string | null } | null }
/** The trades and consultants on the project (only the ones staff marked "Client sees"). */
function TeamPanel({ team }: { team: Team[] }) {
  return (
    <section className="card pad stack" aria-labelledby="tm-h" style={{ gap: 10 }}>
      <h2 id="tm-h">Project team</h2>
      {team.filter((t) => t.contacts).map((t) => ({ ...t.contacts!, id: t.id, trade: t.trade })).map((c) => <div key={c.id} className="cp-team">
        <div className="muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>{c.trade}</div>
        <div><strong>{c.name || c.company}</strong>{c.name && c.company && <span className="muted"> · {c.company}</span>}</div>
        <div style={{ fontSize: 13.5 }}>{c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}{c.email && c.phone && ' · '}{c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}</div>
      </div>)}
    </section>
  )
}

function InvoicesMini({ invoices }: { invoices: Inv[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const shown = invoices.filter((i) => i.status !== 'draft')
  const bal = (i: Inv) => (i.status === 'open' ? Number(i.total) - Number(i.amount_paid) : 0)
  const owed = shown.reduce((a, i) => a + bal(i), 0)
  return (
    <section className="card pad stack" aria-labelledby="iv-h">
      <div className="row between"><h2 id="iv-h">Invoices</h2>{owed > 0 && <span><span className="muted">Balance </span><strong className="num">{money(owed)}</strong></span>}</div>
      {shown.length === 0 ? <p className="muted" style={{ margin: 0 }}><em>No invoices on this project yet.</em></p> : (
        <ul className="cp-inv">
          {shown.map((i) => {
            const late = i.status === 'open' && !!i.due_date && i.due_date < today
            const [label, color] = late ? ['Past due', 'var(--red)'] : INV_ST[i.status] ?? [i.status, 'var(--muted)']
            return (
              <li key={i.id} className={late ? 'late' : undefined}>
                <div className="row between"><strong>{i.number}</strong><strong className="num">{money(i.total)}</strong></div>
                <div className="row between" style={{ fontSize: 14 }}>
                  <span style={{ color: late ? 'var(--red)' : undefined }}>{i.status === 'paid' ? 'Paid in full' : `Due ${fmtDate(i.due_date)}`}</span>
                  <strong style={{ color }}>{label}</strong></div>
                {i.status === 'open' && Number(i.amount_paid) > 0 && <div className="muted" style={{ fontSize: 14 }}>Balance {money(bal(i))}</div>}
              </li>)
          })}
        </ul>)}
      {owed > 0 && <button type="button" className="btn secondary" disabled aria-describedby="iv-pay">Pay online</button>}
      {owed > 0 && <p id="iv-pay" className="muted" style={{ margin: 0, fontSize: 14 }}>Pay online — coming soon. For now, please pay by check or bank transfer as noted on the invoice.</p>}
      <Link to="/invoices" style={{ fontWeight: 700 }}>All invoices ›</Link>
    </section>
  )
}

function LockDialog({ title, invoice, onClose }: { title: string; invoice: string | null; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="modal-bg" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="lk-h" className="card pad stack" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <h2 id="lk-h">🔒 This set is held until payment</h2>
        <p style={{ margin: 0, lineHeight: 1.5 }}><strong>{title}</strong> will be available to view and download as soon as {invoice ? <>invoice <strong>{invoice}</strong></> : 'the related invoice'} is paid. Bank transfers (ACH) release the drawings once the payment clears, usually within 4 business days.</p>
        <div className="row between"><button className="btn secondary" onClick={onClose} autoFocus>Close</button><Link className="btn" to="/invoices">View invoice</Link></div>
      </div>
    </div>
  )
}

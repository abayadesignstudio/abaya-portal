import { Fragment, useEffect, useRef, useState } from 'react'
import TypePicker, { typeCodes } from './TypePicker'
import Avatar from '../components/Avatar'
import RowMenu from '../components/RowMenu'
import ContactForm from '../components/ContactForm'
import PhoneCell from '../components/PhoneCell'
import DuplicateProject from './DuplicateProject'
import { TRADES, contactName, backfillEmail, type LibContact } from '../lib/contacts'
import { Link, useLocation, useParams } from 'react-router-dom'
import ModelUpload from './ModelUpload'
import RenderingsUpload from './RenderingsUpload'
import { supabase, money, SECTOR_COLOR, CATEGORY_NAME, PHASES, PHASE_NAME, phaseLabel } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { useAuth } from '../lib/auth'
import UpdateCard from '../client/UpdateCard'
import BudgetTab, { TeamTable, type Person as TeamPerson } from './budget/BudgetTab'
import './budget.css'
import { linkedAgreements, contractFee, syncPctPhases, round2 } from '../lib/fees'
import { sortPhases, fmtDate, signedPhotoUrls, uid, extOf,
  type Update, type Drawing, type ContractItem, type Meeting, type ServiceRequest } from '../lib/projectContent'

export type Phase = { id: string; code: string; sort?: number | null; name?: string | null; billing?: string; parent_phase_id?: string | null; service_id?: string | null; fee: number; fee_pct: number | null; status: string; start_date: string | null; end_date: string | null; meetings_included: number | null }
type Entry = { phase_id: string | null; profile_id: string; minutes: number; profiles: { full_name: string | null; bill_rate: number | null } | null }
export type Project = { id: string; number: string; name: string; status: string; category: string | null; categories: string[] | null; sector: string | null; address: string | null; next_milestone: string | null; client_id: string | null; clients: { name: string } | null; outside_firm?: boolean }
export type Inv = { id: string; number: string; status: string; total: number; amount_paid: number | null; issue_date: string | null; due_date: string | null }

// Project sub-menu, Monograph-style: core pages, then client-facing content
const NAV_MAIN = [['overview', 'Overview'], ['budget', 'Budget'], ['settings', 'Details'], ['drawings', 'Files']] as const
const NAV_CLIENT = [['updates', 'Updates'], ['contacts', 'Contacts'], ['contract', 'Contract'], ['requests', 'Additional services']] as const
type Tab = typeof NAV_MAIN[number][0] | typeof NAV_CLIENT[number][0] | 'client'
/** Number of pages in a PDF (= sheets in a drawing set); null if it can't be read. */
async function pageCount(f: Blob): Promise<number | null> {
  try { const { PDFDocument } = await import('pdf-lib'); return (await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false })).getPageCount() } catch { return null }
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function ProjectDetail() {
  const { id } = useParams()
  const loc = useLocation()
  const startTab = ((s: Tab) => s === 'client' ? 'contacts' : s)(((loc.state as { tab?: Tab } | null)?.tab) ?? 'budget') // Client access now lives in Contacts
  const [tab, setTab] = useState<Tab>(startTab)
  const [teamErr, setTeamErr] = useState('')
  const [teamOpen, setTeamOpen] = useState<string | null>(null) // phase whose team editor is open, right in the table
  // phase reordering: grab the ⠿ handle and drag (or arrow keys on the handle)
  const [armed, setArmed] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [reorderErr, setReorderErr] = useState('')
  const [dup, setDup] = useState(false)
  useEffect(() => { setTab(startTab) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error, reload } = useLoad(async () => {
    const p = must(await supabase.from('projects').select('id, number, name, status, category, categories, sector, address, next_milestone, client_id, clients(name), outside_firm').eq('id', id!).single()) as unknown as Project
    const phases = sortPhases(must(await supabase.from('phases').select('id, code, sort, name, parent_phase_id, service_id, billing, fee, fee_pct, status, start_date, end_date, meetings_included').eq('project_id', id!)) as Phase[])
    const billed = must(await supabase.from('phase_billing').select('phase_id, billed').eq('project_id', id!)) as { phase_id: string; billed: number }[]
    const time = must(await supabase.from('time_entries').select('phase_id, profile_id, minutes, profiles(full_name, bill_rate)').eq('project_id', id!)) as unknown as Entry[]
    const invoices = must(await supabase.from('invoices').select('id, number, status, total, amount_paid, issue_date, due_date').eq('project_id', id!).order('issue_date', { ascending: false, nullsFirst: true })) as Inv[]
    const agreements = await linkedAgreements(id!)
    // who's on each phase (set on the Budget tab): hours × rate as a share of the phase fee
    const allocs = phases.length ? must(await supabase.from('phase_allocations').select('phase_id, profile_id, hours').in('phase_id', phases.map((x) => x.id))) as { phase_id: string; profile_id: string; hours: number }[] : []
    const people = must(await supabase.from('profiles').select('id, full_name, email, initials, title, bill_rate, avatar_url').in('role', ['admin', 'staff']).order('full_name')) as TeamPerson[]
    const members = must(await supabase.from('project_members').select('profile_id, role_label, bill_rate').eq('project_id', id!)) as { profile_id: string; role_label: string | null; bill_rate: number | null }[]
    return { p, phases, billed, time, invoices, agreements, allocs, people, members }
  }, [id])
  // coming back to the Overview after changing things on another tab (team, budget): show the latest
  const firstTab = useRef(true)
  useEffect(() => { if (firstTab.current) { firstTab.current = false; return } if (tab === 'overview') reload() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps
  // percentage phases follow the agreements' total (re-priced here if an agreement changed elsewhere)
  useEffect(() => {
    if (!data) return
    const cf = contractFee(data.agreements)
    if (cf !== null && data.phases.some((x) => x.fee_pct != null && Math.abs(round2(cf * Number(x.fee_pct) / 100) - Number(x.fee)) >= 0.005))
      syncPctPhases(data.p.id, cf).then((n) => { if (n) reload() })
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="err">{error}</p>
  if (!data) return <p>Loading…</p>
  const { p, phases, billed, time, invoices, agreements, allocs, people, members } = data
  const mains = phases.filter((x) => x.code !== 'AS')
  const reorder = async (fromId: string, toId: string) => {
    const ids = mains.map((x) => x.id), from = ids.indexOf(fromId), to = ids.indexOf(toId)
    if (from < 0 || to < 0 || from === to) return
    ids.splice(from, 1); ids.splice(to, 0, fromId)
    const res = await Promise.all(ids.map((pid, i) => supabase.from('phases').update({ sort: (i + 1) * 10 }).eq('id', pid)))
    const bad = res.find((r) => r.error); setReorderErr(bad?.error ? bad.error.message : ''); reload()
  }
  const dragFor = (ph: Phase): PhaseDrag | undefined => {
    if (ph.code === 'AS' || mains.length < 2) return undefined
    const i = mains.findIndex((x) => x.id === ph.id)
    return {
      handle: <button type="button" className="ph-grip" aria-label={`Reorder ${ph.code === 'CU' ? ph.name : ph.code}: drag, or use the arrow keys`} title="Drag to reorder"
        onMouseDown={() => setArmed(ph.id)} onMouseUp={() => setArmed(null)} onTouchStart={() => setArmed(ph.id)}
        onKeyDown={(e) => { const j = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1; if (j >= 0 && j < mains.length) { e.preventDefault(); reorder(ph.id, mains[j].id) } }}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="3" cy="3" r="1.6" /><circle cx="9" cy="3" r="1.6" /><circle cx="3" cy="9" r="1.6" /><circle cx="9" cy="9" r="1.6" /></svg></button>,
      row: {
        draggable: armed === ph.id,
        className: dragOver === ph.id && armed && armed !== ph.id ? (mains.findIndex((x) => x.id === armed) < i ? 'ph-drop below' : 'ph-drop') : armed === ph.id ? 'ph-dragging' : undefined,
        onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-phase', ph.id) },
        onDragOver: (e) => { if (armed) { e.preventDefault(); if (dragOver !== ph.id) setDragOver(ph.id) } },
        onDrop: (e) => { e.preventDefault(); const from = e.dataTransfer.getData('text/x-phase'); setDragOver(null); setArmed(null); if (from) reorder(from, ph.id) },
        onDragEnd: () => { setArmed(null); setDragOver(null) },
      },
    }
  }
  const roleOf = (pid: string) => members.find((m) => m.profile_id === pid)?.role_label ?? people.find((x) => x.id === pid)?.title ?? ''
  const runTeam = async (fn: () => Promise<unknown>) => { try { await fn(); setTeamErr(''); reload() } catch (e) { setTeamErr(errText(e)) } }
  const rateOf = (pid: string) => Number(members.find((m) => m.profile_id === pid)?.bill_rate ?? people.find((x) => x.id === pid)?.bill_rate ?? 0)
  const teamOf = (ph: Phase) => allocs.filter((a) => a.phase_id === ph.id).map((a) => {
    const who = people.find((x) => x.id === a.profile_id)
    return { id: a.profile_id, name: who?.full_name || who?.email || 'Someone', avatar: who?.avatar_url ?? null, initials: who?.initials || (who?.full_name || who?.email || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
      hours: Number(a.hours), pct: Number(ph.fee) ? Number(a.hours) * rateOf(a.profile_id) / Number(ph.fee) * 100 : 0 }
  })
  const billedBy = Object.fromEntries(billed.map((b) => [b.phase_id, Number(b.billed)]))
  const used = (phaseId: string) => time.filter((t) => t.phase_id === phaseId).reduce((a, t) => ({ hrs: a.hrs + t.minutes / 60, cost: a.cost + (t.minutes / 60) * Number(t.profiles?.bill_rate ?? 0) }), { hrs: 0, cost: 0 })
  // contract phases vs additional services (AS lines are billed on top of the agreement)
  const phaseSum = round2(phases.filter((x) => x.code !== 'AS').reduce((a, x) => a + Number(x.fee), 0))
  const asSum = round2(phases.filter((x) => x.code === 'AS').reduce((a, x) => a + Number(x.fee), 0))
  const cf = contractFee(agreements) // null when no agreement is linked
  const totFee = (cf ?? phaseSum) + asSum
  const agreementCodes = [...new Set(agreements.flatMap((g) => Object.entries(g.ph ?? {}).filter(([, v]) => v?.on).map(([k]) => k)))]
  const fromAgreement = PHASES.map(([c]) => c).filter((c) => agreementCodes.includes(c) && !phases.some((x) => x.code === c))
  const totBilled = invoices.filter((i) => i.status === 'open' || i.status === 'paid').reduce((a, i) => a + Number(i.total), 0)
  const totHrs = time.reduce((a, t) => a + t.minutes / 60, 0)
  // billed ahead of the work (a down payment, or billing faster than the work): billed minus work done.
  // Work done = a complete phase's whole fee; an active phase's hours at billing rates, up to its fee; nothing before it starts.
  const earned = (ph: Phase) => ph.status === 'complete' ? Number(ph.fee) : ph.status === 'not_started' ? 0 : Math.min(Number(ph.fee), used(ph.id).cost)
  const aheadOf = (ph: Phase) => Math.max(0, round2((billedBy[ph.id] ?? 0) - earned(ph)))
  const totAhead = round2(phases.reduce((a, ph) => a + aheadOf(ph), 0))
  const missing = PHASES.filter(([c]) => !phases.some((x) => x.code === c))

  return (
    <div className="stack">
      <Link to="/projects" style={{ fontWeight: 700, textDecoration: 'none' }}>‹ All projects</Link>
      <div className="row between">
        <h1 className="row" style={{ gap: 12 }}><span className="tag" style={{ background: SECTOR_COLOR[p.sector ?? 'internal'], height: 30, fontSize: 16 }}>{p.number}</span>{p.name}
          {(p.categories ?? []).map((c) => <abbr key={c} className="pill" title={CATEGORY_NAME[c]}>{c}</abbr>)}</h1>
        <div className="row" style={{ gap: 12 }}>
          <label className="row" style={{ gap: 6, fontSize: 14 }} title="One person’s own work: it stays in the portal, but its hours and money aren’t counted in firm totals (utilization, time this week, what we need, collected).">
            <input type="checkbox" checked={!!p.outside_firm} onChange={async (e) => { await supabase.from('projects').update({ outside_firm: e.target.checked }).eq('id', p.id); reload() }} />Outside the firm</label>
          <StatusSelect id={p.id} value={p.status} onSaved={reload} />
          <RowMenu label="Project actions" items={[{ label: 'Duplicate project…', onSelect: () => setDup(true) }]} />
          {dup && <DuplicateProject project={p} onClose={() => setDup(false)} />}
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>{p.clients?.name ?? 'No client'}{p.address ? ` · ${p.address}` : ''}</p>
      {p.outside_firm && <p className="muted" style={{ margin: 0, fontSize: 13 }}><span className="pill">Outside the firm</span> Its hours and money aren’t counted in the firm’s totals.</p>}
      <div className="pb-layout">
        <nav className="pb-subnav" aria-label="Project">
          {NAV_MAIN.map(([k, l]) => <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>)}
          <p className="pb-sep">Client portal</p>
          {NAV_CLIENT.map(([k, l]) => <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>)}
        </nav>
        <div className="stack" style={{ minWidth: 0 }}>
      {tab === 'overview' && <>
      <section className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }} aria-label="Summary">
        {([['Total fee', money(totFee), (cf === null ? 'Sum of phase fees (no agreement linked)' : `From ${agreements.length === 1 ? 'the agreement' : `${agreements.length} agreements`}`) + (asSum ? ` + ${money(asSum)} additional services` : '')],
          ['Contract split into phases', money(phaseSum), cf === null ? '' : Math.abs(phaseSum - cf) < 0.005 ? '100% of the fee' : `${cf ? Math.round(phaseSum / cf * 1000) / 10 : 0}% of the fee · ${money(Math.abs(cf - phaseSum))} ${phaseSum < cf ? 'unassigned' : 'over'}`],
          ['Invoiced', money(totBilled), ''], ['Left to bill', money(totFee - totBilled), ''],
          ...(totAhead > 0 ? [['Billed ahead of work', money(totAhead), 'Collected for work not done yet. Shrinks as phases progress.']] : []),
          ['Hours logged', totHrs.toFixed(1), '']] as [string, string, string][]).map(([l, v, sub]) => (
          <div key={l} style={{ padding: '16px 20px', borderRight: '1px solid #ece9e3' }}><div className="muted" style={{ fontSize: 14 }}>{l}</div><div className="num" style={{ fontSize: 26, fontWeight: 700 }}>{v}</div>
            {sub && <div style={{ fontSize: 12.5, marginTop: 2, color: l === 'Contract split into phases' && !sub.startsWith('100') ? 'var(--amber)' : 'var(--muted)' }}>{sub}</div>}</div>))}
      </section>
      <div className="pd-two">
      <section className="card pad stack" aria-labelledby="ag-h" style={{ gap: 8 }}>
        <h2 id="ag-h" style={{ fontSize: 17 }}>Agreements</h2>
        {agreements.length === 0 ? <p className="muted" style={{ margin: 0 }}>No agreement is linked to this project, so the total fee is the sum of the phase fees. Link one from the agreement itself (Proposals → open it → <em>Client &amp; project</em>).</p>
          : <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{agreements.map((g) => (
            <li key={g.id} className="row between" style={{ padding: '6px 0', borderTop: '1px solid #ece9e3' }}>
              <span><Link to={`/proposals/${g.id}`} style={{ fontWeight: 700 }}>{g.title}</Link> <span className="pill" style={{ marginLeft: 6 }}>{g.status[0].toUpperCase() + g.status.slice(1)}</span></span>
              <strong className="num">{money(Number(g.total_fee ?? 0))}</strong></li>))}
            {agreements.length > 1 && <li className="row between" style={{ padding: '6px 0', borderTop: '1px solid #ece9e3' }}><span className="muted">Total of linked agreements (voided ones don’t count)</span><strong className="num">{money(cf ?? 0)}</strong></li>}</ul>}
      </section>
      <section className="card pad stack" aria-labelledby="pi-h" style={{ gap: 8 }}>
        <div className="row between"><h2 id="pi-h" style={{ fontSize: 17 }}>Invoices <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {invoices.length}</span></h2>
          <Link className="btn small secondary" to={`/invoices/new?project=${p.id}`}>+ New invoice</Link></div>
        {invoices.length === 0 ? <p className="muted" style={{ margin: 0 }}>No invoices on this project yet.</p>
          : <div style={{ overflowX: 'auto' }}><table className="table pd-inv" style={{ minWidth: 0 }}>
            <thead><tr><th>Invoice</th><th>Status</th><th>Issued</th><th>Due</th><th className="r">Total</th><th className="r">Balance</th></tr></thead>
            <tbody>{invoices.map((i) => { const bal = Number(i.total) - Number(i.amount_paid ?? 0); const late = i.status === 'open' && i.due_date && i.due_date < new Date().toISOString().slice(0, 10)
              return <tr key={i.id}>
                <td><Link to={`/invoices/${i.id}`} style={{ fontWeight: 700 }}>{i.number}</Link></td>
                <td><span className="pill" style={late ? { borderColor: '#d92d20', color: '#b42318' } : undefined}>{late ? 'Past due' : i.status[0].toUpperCase() + i.status.slice(1)}</span></td>
                <td className="num">{fmtDate(i.issue_date)}</td><td className="num">{fmtDate(i.due_date)}</td>
                <td className="r num">{money(i.total)}</td><td className="r num" style={{ fontWeight: bal > 0.005 && i.status !== 'void' ? 700 : 400 }}>{i.status === 'void' ? '—' : money(Math.max(0, bal))}</td></tr> })}</tbody>
          </table></div>}
      </section>
      </div>
      <section className="card pad stack">
        <h2>Phases</h2>{reorderErr && <p className="err" role="alert" style={{ margin: 0 }}>{reorderErr}</p>}
        <div style={{ overflowX: 'auto' }}><table className="table" style={{ minWidth: 1150 }}>
          <thead><tr><th>Phase</th><th>Status</th><th>Start</th><th>End</th><th className="r">Fee</th><th>Team</th><th className="r">Billed</th><th className="r">Hours</th><th>Fee used (labor at rates)</th><th></th></tr></thead>
          <tbody>{phases.map((ph) => <Fragment key={ph.id}>
            <PhaseRow key={ph.id + ph.fee + (ph.fee_pct ?? '')} drag={dragFor(ph)} ph={ph} total={cf} team={teamOf(ph)} teamOpen={teamOpen === ph.id} onTeam={() => setTeamOpen(teamOpen === ph.id ? null : ph.id)} billed={billedBy[ph.id] ?? 0} ahead={aheadOf(ph)} used={used(ph.id)} onSaved={reload} />
            {teamOpen === ph.id && <tr className="ph-team-row"><td colSpan={10}>
              <div className="ph-team-edit">
                <div className="row between"><strong>{ph.code} team</strong><button type="button" className="linkbtn" onClick={() => setTeamOpen(null)}>Done</button></div>
                {teamErr && <p className="err" role="alert" style={{ margin: 0 }}>{teamErr}</p>}
                <TeamTable phase={ph} projectId={p.id} people={people} allocs={allocs.filter((a) => a.phase_id === ph.id)} logged={time.filter((t) => t.phase_id === ph.id).map((t) => ({ phase_id: t.phase_id, profile_id: t.profile_id, minutes: t.minutes }))}
                  rateOf={rateOf} roleOf={roleOf} hasMember={(pid) => members.some((m) => m.profile_id === pid)} run={runTeam} />
              </div>
            </td></tr>}
          </Fragment>)}</tbody>
          {phases.length > 0 && <tfoot><tr><td colSpan={4} style={{ fontWeight: 700 }}>Phases total</td>
            <td className="r num" style={{ fontWeight: 700, color: cf !== null && Math.abs(phaseSum - cf) >= 0.005 ? 'var(--amber)' : undefined }}>{money(phaseSum)}{cf !== null && <div className="muted" style={{ fontWeight: 400, fontSize: 12 }}>of {money(cf)}</div>}</td><td colSpan={5} /></tr>
            {asSum > 0 && <tr><td colSpan={4} className="muted">Additional services (on top of the contract)</td><td className="r num">{money(asSum)}</td><td colSpan={5} /></tr>}</tfoot>}
        </table></div>
        {fromAgreement.length > 0 && <div className="row" style={{ gap: 8 }}>
          <button className="btn small" onClick={async () => { await supabase.from('phases').insert(fromAgreement.map((code) => ({ project_id: p.id, code, fee: 0 }))); reload() }}>
            + Add {fromAgreement.join(', ')} from the agreement</button>
          <span className="muted" style={{ fontSize: 13 }}>Phases included in the linked agreement{agreements.length > 1 ? 's' : ''} but not set up here yet.</span></div>}
        {<AddPhase projectId={p.id} codes={missing.map(([c]) => c)} total={cf} onSaved={reload} />}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}><em>A phase fee is a fixed amount ($) or a percentage of the total fee (%); percentage phases update automatically when the agreement’s fee changes. Fee used = hours × each person’s billable rate. The bar turns orange at 75% and red at 90%. Phase start and end dates drive the client’s schedule. Assign the team and hours on the Budget page.</em></p>
      </section>
      </>}
      {tab === 'budget' && <BudgetTab key={p.id + phases.map((x) => x.id + x.fee + x.status).join()} projectId={p.id} />}
      {tab === 'updates' && <UpdatesTab projectId={p.id} />}
      {tab === 'drawings' && <DrawingsTab projectId={p.id} phases={phases} invoices={invoices} />}
      {tab === 'contacts' && <ContactsTab project={p} />}
      {tab === 'contract' && <ContractTab projectId={p.id} phases={phases} onSaved={reload} />}
      {tab === 'requests' && <RequestsTab projectId={p.id} phases={phases} onChanged={reload} />}
      {tab === 'settings' && <SettingsTab project={p} onSaved={reload} />}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Settings ---------------- */
function SettingsTab({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const clients = useLoad(async () => must(await supabase.from('clients').select('id, name').order('name')) as { id: string; name: string }[])
  const [f, setF] = useState({ number: project.number, name: project.name, client_id: project.client_id ?? '', category: (project.categories ?? []).join(','), sector: project.sector ?? '', status: project.status, address: project.address ?? '', next_milestone: project.next_milestone ?? '' })
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setMsg('') }
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const { error } = await supabase.from('projects').update({ number: f.number.trim(), name: f.name.trim(), client_id: f.client_id || null, categories: typeCodes(f.category), sector: f.sector || null,
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
        <div><label className="l" htmlFor="s-cat">Type <span className="muted" style={{ fontWeight: 400 }}>(pick all that apply)</span></label><TypePicker id="s-cat" value={f.category} onChange={(v) => { setF({ ...f, category: v }); setMsg('') }} /></div>
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
export function UpdatesTab({ projectId }: { projectId: string }) {
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
export function DrawingsTab({ projectId, phases, invoices }: { projectId: string; phases: Phase[]; invoices: Inv[] }) {
  const { profile } = useAuth()
  const list = useLoad(async () => must(await supabase.from('drawings').select('*').eq('project_id', projectId).order('issued_on', { ascending: false })) as Drawing[], [projectId])
  const [f, setF] = useState({ title: '', phase_id: '', issued_on: new Date().toISOString().slice(0, 10), lock: '' })
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
        sheet_count: await pageCount(file), issued_on: f.issued_on, storage_path: path, locked_until_invoice: f.lock || null, uploaded_by: profile?.id }))
      setF({ ...f, title: '' }); setFile(null); const fi = document.getElementById('d-f') as HTMLInputElement | null; if (fi) fi.value = ''; list.reload()
    } catch (x) { setErr(errText(x)) }
    setBusy(false)
  }
  const open = async (d: Drawing) => {
    const { data, error } = await supabase.storage.from('drawings').createSignedUrl(d.storage_path, 600)
    if (error) return setErr(error.message)
    window.open(data.signedUrl, '_blank', 'noopener')
  }
  const setLock = async (d: Drawing, v: string) => { await supabase.from('drawings').update({ locked_until_invoice: v || null }).eq('id', d.id); list.reload() }
  // sheets = pages in the PDF; older uploads without a count are counted once, in the background
  useEffect(() => {
    const missing = (list.data ?? []).filter((d) => d.sheet_count == null)
    if (!missing.length) return
    let live = true
    ;(async () => { for (const d of missing) {
      const { data } = await supabase.storage.from('drawings').download(d.storage_path); if (!live || !data) continue
      const n = await pageCount(data); if (n != null) await supabase.from('drawings').update({ sheet_count: n }).eq('id', d.id)
    } if (live) list.reload() })()
    return () => { live = false }
  }, [list.data?.map((d) => d.id + (d.sheet_count ?? '')).join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (d: Drawing) => { if (!window.confirm(`Delete “${d.title}”? The client can no longer open it. This can’t be undone.`)) return; await supabase.storage.from('drawings').remove([d.storage_path]); await supabase.from('drawings').delete().eq('id', d.id); list.reload() }
  const code = (pid: string | null) => phases.find((x) => x.id === pid)?.code
  return (
    <div className="stack">
      <form onSubmit={upload} className="card pad stack" aria-label="Upload drawings">
        <h2>Issue drawings</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,2fr) minmax(160px,1fr) 160px', gap: 12 }}>
          <div><label className="l" htmlFor="d-t">Title</label><input id="d-t" className="input" value={f.title} placeholder="e.g. 100% CD set" onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div><label className="l" htmlFor="d-ph">Phase</label><select id="d-ph" className="input" value={f.phase_id} onChange={(e) => setF({ ...f, phase_id: e.target.value })}><option value="">—</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.code} · {phaseLabel(p)}</option>)}</select></div>
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
                <td><RowMenu label={`Actions for ${d.title}`} items={[{ label: 'Delete', danger: true, onSelect: () => remove(d) }]} /></td></tr> })}
            {list.data?.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}><em>No drawings issued yet.</em></td></tr>}
          </tbody>
        </table>
      </section>
      <ModelUpload projectId={projectId} />
      <RenderingsUpload projectId={projectId} />
    </div>
  )
}

/* ---------------- Contract scope ---------------- */
export function ContractTab({ projectId, phases: allPhases, onSaved }: { projectId: string; phases: Phase[]; onSaved: () => void }) {
  const phases = allPhases.filter((p) => p.code !== 'AS') // the contract covers the standard phases
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
            <RowMenu label={`Actions for ${m.title ?? 'meeting'}`} items={[{ label: 'Delete', danger: true, onSelect: async () => { if (!window.confirm(`Delete the meeting “${m.title ?? 'Meeting'}”? This can’t be undone.`)) return; await supabase.from('meetings').delete().eq('id', m.id); d.reload() } }]} /></span></li>)}</ul>
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
            <RowMenu label={`Actions for ${it.title}`} items={[{ label: 'Delete', danger: true, onSelect: async () => { if (!window.confirm(`Delete “${it.title}”? This can’t be undone.`)) return; await supabase.from('contract_items').delete().eq('id', it.id); d.reload() } }]} /></span></li>)}</ul>
      </section>
    </div>
  )
}

/* ---------------- Requests ---------------- */
export function RequestsTab({ projectId, phases: allPhases = [], onChanged }: { projectId: string; phases?: Phase[]; onChanged?: () => void }) {
  const parents = allPhases.filter((p) => p.code !== 'AS')
  const { profile } = useAuth()
  const list = useLoad(async () => must(await supabase.from('service_requests').select('*').eq('project_id', projectId).order('created_at', { ascending: false })) as ServiceRequest[], [projectId])
  const save = async (r: ServiceRequest, patch: Partial<ServiceRequest>) => { const { error } = await supabase.from('service_requests').update(patch).eq('id', r.id); if (error) setErr(error.message); list.reload(); onChanged?.() }
  const [n, setN] = useState({ description: '', quote: '', status: 'quoted', phase_id: '' }); const [err, setErr] = useState('')
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!n.description.trim()) return setErr('Describe the service.')
    const { error } = await supabase.from('service_requests').insert({ project_id: projectId, requested_by: profile?.id, description: n.description.trim(), quote: n.quote ? Number(n.quote) : null, status: n.status, phase_id: n.phase_id || null })
    if (error) return setErr(error.message)
    setN({ description: '', quote: '', status: 'quoted', phase_id: '' }); list.reload(); onChanged?.()
  }
  const remove = async (r: ServiceRequest) => {
    if (!window.confirm(`Delete “${r.description.slice(0, 60)}”? The client will no longer see it. This can’t be undone.`)) return
    const { error } = await supabase.from('service_requests').delete().eq('id', r.id)
    if (error) return setErr(error.message)
    list.reload(); onChanged?.()
  }
  const total = (list.data ?? []).filter((r) => r.status === 'approved' || r.status === 'done').reduce((a, r) => a + Number(r.quote ?? 0), 0)
  return (
    <div className="stack">
      <form onSubmit={add} className="card pad stack" aria-label="Add an additional service">
        <h2>Add an additional service</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>For work outside the agreement. It appears on the client’s project page with its fee and status. Once <strong>Approved</strong>, it becomes its own line in the Phases table (under the phase you pick), so the team can log time to it and you can bill it.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) 180px 120px 180px auto', gap: 10, alignItems: 'end' }}>
          <div><label className="l" htmlFor="as-d">Service</label><input id="as-d" className="input" value={n.description} placeholder="e.g. Revised site plan for pond relocation" onChange={(e) => setN({ ...n, description: e.target.value })} /></div>
          <div><label className="l" htmlFor="as-p">Under phase</label><select id="as-p" className="input" value={n.phase_id} onChange={(e) => setN({ ...n, phase_id: e.target.value })}>
            <option value="">— None —</option>{parents.map((p) => <option key={p.id} value={p.id}>{p.code} · {PHASE_NAME[p.code]}</option>)}</select></div>
          <div><label className="l" htmlFor="as-q">Fee</label><input id="as-q" className="input num" inputMode="decimal" placeholder="$" value={n.quote} onChange={(e) => setN({ ...n, quote: e.target.value })} /></div>
          <div><label className="l" htmlFor="as-s">Status</label><select id="as-s" className="input" value={n.status} onChange={(e) => setN({ ...n, status: e.target.value })}>
            <option value="quoted">Quoted (awaiting approval)</option><option value="approved">Approved</option><option value="done">Done</option></select></div>
          <div><button className="btn">Add service</button></div>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
      </form>
      <section className="card pad stack">
        <div className="row between"><h2 style={{ margin: 0 }}>Additional services</h2>{total > 0 && <span className="muted">Approved: <strong className="num">{money(total)}</strong></span>}</div>
        {list.data?.length === 0 && <p className="muted" style={{ margin: 0 }}><em>None yet — client requests also appear here.</em></p>}
        {list.data?.map((r) => <div key={r.id} className="row between" style={{ padding: '10px 0', borderTop: '1px solid #efece6', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}><p style={{ margin: 0 }}>{r.description}</p><p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{fmtDate(r.created_at)}{(r.status === 'approved' || r.status === 'done') && ' · on the Phases table — time can be logged to it'}</p></div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <label className="sr" htmlFor={'rp' + r.id}>Under phase</label><select id={'rp' + r.id} className="input" style={{ width: 'auto', maxWidth: 190 }} value={r.phase_id ?? ''} onChange={(e) => save(r, { phase_id: e.target.value || null })}>
              <option value="">No phase</option>{parents.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select>
            <label className="sr" htmlFor={'rq' + r.id}>Fee</label><input id={'rq' + r.id} className="input num" style={{ width: 120 }} placeholder="Quote $" defaultValue={r.quote ?? ''} onBlur={(e) => save(r, { quote: e.target.value ? Number(e.target.value) : null })} />
            <label className="sr" htmlFor={'rs' + r.id}>Status</label><select id={'rs' + r.id} className="input" style={{ width: 'auto' }} value={r.status} onChange={(e) => save(r, { status: e.target.value })}>
              <option value="requested">Requested</option><option value="quoted">Quoted</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="done">Done</option></select>
            <RowMenu label="Service actions" items={[{ label: 'Delete…', danger: true, onSelect: () => remove(r) }]} />
          </div></div>)}
      </section>
    </div>
  )
}

/* ---------------- Client access ---------------- */
type PLink = { id: string; trade: string; show_to_client: boolean; contact_id: string; contacts: LibContact }

/** Everyone on the project: the client (from Clients) and the trades/consultants linked from the contact library.
 *  Emails and Google Calendar meetings with any of these people are logged to Updates automatically. */
export function ContactsTab({ project }: { project: Project }) {
  const d = useLoad(async () => {
    const client = project.client_id ? (must(await supabase.from('clients').select('name, billing_email, phone, address').eq('id', project.client_id).maybeSingle()) as
      { name: string; billing_email: string | null; phone: string | null; address: string | null } | null) : null
    const links = must(await supabase.from('project_contacts').select('id, trade, show_to_client, contact_id, contacts(*)').eq('project_id', project.id).order('created_at')) as unknown as PLink[]
    const lib = must(await supabase.from('contacts').select('*').order('company').order('name')) as LibContact[]
    return { client, links, lib }
  }, [project.id, project.client_id])
  const [mode, setMode] = useState<null | 'pick' | 'new'>(null); const [q, setQ] = useState(''); const [editing, setEditing] = useState<LibContact | null>(null); const [err, setErr] = useState('')
  const linked = new Set((d.data?.links ?? []).map((l) => l.contact_id))
  const link = async (c: LibContact) => { setErr('')
    const { error } = await supabase.from('project_contacts').insert({ project_id: project.id, contact_id: c.id, trade: c.trade })
    if (error) return setErr(error.message)
    backfillEmail(c.email); setMode(null); setQ(''); d.reload() }
  const unlink = async (l: PLink) => {
    if (!window.confirm(`Remove ${contactName(l.contacts)} from this project? They stay in the contact library, and updates already logged stay.`)) return
    await supabase.from('project_contacts').delete().eq('id', l.id); d.reload() }
  const patch = async (l: PLink, v: Partial<PLink>) => { await supabase.from('project_contacts').update(v).eq('id', l.id); d.reload() }
  const cl = d.data?.client
  const needle = q.trim().toLowerCase()
  const matches = (d.data?.lib ?? []).filter((c) => !linked.has(c.id) && (!needle || [c.name, c.company, c.email, c.trade, c.phone].some((x) => (x ?? '').toLowerCase().includes(needle)))).slice(0, 30)
  return (
    <div className="stack">
      <section className="card pad stack">
        <div className="row between"><h2 style={{ margin: 0 }}>Client</h2><Link className="btn small secondary" to="/clients">Edit in Clients</Link></div>
        {!project.client_id ? <p className="muted" style={{ margin: 0 }}>No client set — choose one on the Details tab.</p> : cl && <>
          <div className="pc-grid">
            <div><div className="l">Name</div><strong>{cl.name}</strong></div>
            <div><div className="l">Billing email</div>{cl.billing_email ? <a href={`mailto:${cl.billing_email}`}>{cl.billing_email}</a> : '—'}</div>
            <div><div className="l">Phone</div>{cl.phone ? <a href={`tel:${cl.phone}`}>{cl.phone}</a> : '—'}</div>
            <div><div className="l">Address</div>{cl.address || '—'}</div>
          </div>
          <ClientAccessTab project={project} embedded /></>}
      </section>
      <section className="card pad stack">
        <div className="row between"><h2 style={{ margin: 0 }}>Trades &amp; consultants</h2>
          {!mode && <button type="button" className="btn small" onClick={() => { setMode('pick'); setEditing(null) }}>+ Add contact</button>}</div>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>People come from the <Link to="/contacts">contact library</Link>. Emails and Google Calendar meetings with them show up in Updates automatically.</p>
        <div style={{ overflowX: 'auto' }}><table className="table"><thead><tr><th>Role</th><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Client sees</th><th /></tr></thead><tbody>
          {d.data?.links.map((l) => <tr key={l.id}>
            <td><label className="sr" htmlFor={`pr-${l.id}`}>Role on this project</label><select id={`pr-${l.id}`} className="input inline-select" value={l.trade} onChange={(e) => patch(l, { trade: e.target.value })}>
              {[...new Set([...TRADES, l.trade])].map((t) => <option key={t}>{t}</option>)}</select></td>
            <td>{l.contacts.name ?? '—'}</td><td>{l.contacts.company ?? '—'}</td>
            <td>{l.contacts.email ? <a href={`mailto:${l.contacts.email}`}>{l.contacts.email}</a> : '—'}</td><td>{l.contacts.phone ? <a href={`tel:${l.contacts.phone}`}>{l.contacts.phone}</a> : '—'}</td>
            <td><input type="checkbox" aria-label={`Client sees ${contactName(l.contacts)}`} checked={l.show_to_client} onChange={() => patch(l, { show_to_client: !l.show_to_client })} style={{ width: 18, height: 18 }} /></td>
            <td><RowMenu label={`Actions for ${contactName(l.contacts)}`} items={[{ label: 'Edit contact details', onSelect: () => { setEditing(l.contacts); setMode(null) } }, { label: 'Remove from project', danger: true, onSelect: () => unlink(l) }]} /></td></tr>)}
          {d.data?.links.length === 0 && <tr><td colSpan={7} className="muted"><em>No trades yet — add the general contractor, engineers and other consultants.</em></td></tr>}
        </tbody></table></div>
        {editing && <><p className="muted" style={{ margin: 0, fontSize: 13 }}>Editing {contactName(editing)} in the library — the change shows on every project they’re on.</p>
          <ContactForm key={editing.id} edit={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); d.reload() }} /></>}
        {mode === 'pick' && <div className="stack pc-form" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <label className="sr" htmlFor="pc-q">Search the contact library</label>
            <input id="pc-q" className="input" style={{ flex: 1, minWidth: 220 }} autoFocus placeholder="Search the library: name, company, email, trade…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="btn secondary" onClick={() => setMode('new')}>+ New contact</button>
            <button type="button" className="btn secondary" onClick={() => { setMode(null); setQ('') }}>Cancel</button>
          </div>
          <ul className="pc-pick">{matches.map((c) => <li key={c.id}><button type="button" onClick={() => link(c)}>
            <strong>{contactName(c)}</strong>{c.name && c.company && <span className="muted"> · {c.company}</span>}<span className="pill" style={{ marginLeft: 8 }}>{c.trade}</span>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }}>{[c.email, c.phone].filter(Boolean).join(' · ')}</span></button></li>)}
            {matches.length === 0 && <li className="muted" style={{ padding: 8 }}><em>{(d.data?.lib.length ?? 0) === 0 ? 'The library is empty — add the first contact.' : 'No match — add them as a new contact.'}</em></li>}</ul>
        </div>}
        {mode === 'new' && <ContactForm saveLabel="Add to library & project" onCancel={() => setMode('pick')} onSaved={(c) => link(c)} />}
        {err && <p className="err" role="alert">{err}</p>}
      </section>
    </div>
  )
}

export function ClientAccessTab({ project, embedded }: { project: Project; embedded?: boolean }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const d = useLoad(async () => {
    if (!project.client_id) return { contacts: [], invites: [], users: [] }
    const contacts = must(await supabase.from('client_contacts').select('*').eq('client_id', project.client_id).order('name')) as { id: string; name: string | null; email: string; phone: string | null; receives_invoices: boolean; receives_updates: boolean }[]
    const invites = isAdmin ? (must(await supabase.from('invites').select('email').eq('client_id', project.client_id)) as { email: string }[]) : []
    const users = must(await supabase.from('profiles').select('email').eq('client_id', project.client_id)) as { email: string }[]
    return { contacts, invites, users }
  }, [project.client_id, isAdmin])
  const [nc, setNc] = useState({ name: '', email: '', phone: '' }); const [err, setErr] = useState(''); const [msg, setMsg] = useState('')
  if (!project.client_id) return <p className="card pad muted">Set a client on the Settings tab first.</p>
  const invited = new Set([...(d.data?.invites ?? []), ...(d.data?.users ?? [])].map((x) => x.email.toLowerCase()))
  const signedIn = new Set((d.data?.users ?? []).map((x) => x.email.toLowerCase()))
  const add = async (e: React.FormEvent) => { e.preventDefault(); setErr('')
    const { error } = await supabase.from('client_contacts').insert({ client_id: project.client_id, name: nc.name.trim() || null, email: nc.email.trim().toLowerCase(), phone: nc.phone.trim() || null })
    if (error) setErr(error.message); else { backfillEmail(nc.email); setNc({ name: '', email: '', phone: '' }); d.reload() } }
  const invite = async (email: string, name: string | null) => { setErr(''); setMsg('')
    const { error } = await supabase.from('invites').upsert({ email: email.toLowerCase(), role: 'client', client_id: project.client_id, full_name: name, invited_by: profile?.id })
    if (error) setErr(error.message); else { setMsg(`${email} can now sign in at the portal with their email.`); d.reload() } }
  const toggle = async (id: string, k: 'receives_invoices' | 'receives_updates', v: boolean) => { await supabase.from('client_contacts').update({ [k]: v }).eq('id', id); d.reload() }
  return (
    <section className={embedded ? 'stack' : 'card pad stack'}>
      {!embedded && <h2>Client access — {project.clients?.name}</h2>}
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Client contacts belong to {project.clients?.name}, so they see every project for this client. Emails with them are logged to Updates.</p>
      <div style={{ overflowX: 'auto' }}><table className="table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Invoices</th><th>Updates</th><th>Portal</th></tr></thead><tbody>
        {d.data?.contacts.map((c) => <tr key={c.id}><td>{c.name ?? '—'}</td><td>{c.email}</td><td><PhoneCell id={c.id} value={c.phone} label={`Phone for ${c.email}`} onSaved={d.reload} /></td>
          <td><input type="checkbox" aria-label={`${c.email} receives invoices`} checked={c.receives_invoices} onChange={(e) => toggle(c.id, 'receives_invoices', e.target.checked)} style={{ width: 18, height: 18 }} /></td>
          <td><input type="checkbox" aria-label={`${c.email} receives updates`} checked={c.receives_updates} onChange={(e) => toggle(c.id, 'receives_updates', e.target.checked)} style={{ width: 18, height: 18 }} /></td>
          <td>{signedIn.has(c.email.toLowerCase()) ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>Signed in</span> : invited.has(c.email.toLowerCase()) ? <span className="muted">Invited</span>
            : isAdmin ? <button className="btn small secondary" onClick={() => invite(c.email, c.name)}>Invite to portal</button> : <span className="muted">Admin can invite</span>}</td></tr>)}
        {d.data?.contacts.length === 0 && <tr><td colSpan={6} className="muted"><em>No contacts yet.</em></td></tr>}
      </tbody></table></div>
      <form onSubmit={add} className="row" style={{ alignItems: 'flex-end' }}>
        <div><label className="l" htmlFor="cc-n">Name</label><input id="cc-n" className="input" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} /></div>
        <div style={{ minWidth: 260 }}><label className="l" htmlFor="cc-e">Email</label><input id="cc-e" type="email" required className="input" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></div>
        <div><label className="l" htmlFor="cc-p">Phone</label><input id="cc-p" type="tel" className="input" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} /></div>
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

/** Fee as a fixed amount or a % of the project's total fee (only when an agreement sets that total). */
function FeeInput({ id, mode, amt, pct, total, onMode, onAmt, onPct }: { id: string; mode: 'amt' | 'pct'; amt: string; pct: string; total: number | null
  onMode: (m: 'amt' | 'pct') => void; onAmt: (v: string) => void; onPct: (v: string) => void }) {
  return <div>
    <div className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
      <label className="sr" htmlFor={'fm' + id}>Fee type</label>
      <select id={'fm' + id} className="input" style={{ width: 62, padding: '0 6px' }} value={mode} onChange={(e) => onMode(e.target.value as 'amt' | 'pct')}>
        <option value="amt">$</option><option value="pct" disabled={total === null}>%</option></select>
      <label className="sr" htmlFor={'fe' + id}>{mode === 'pct' ? 'Percent of total fee' : 'Fee'}</label>
      <input id={'fe' + id} className="input num" style={{ width: 110, textAlign: 'right' }} inputMode="decimal" value={mode === 'pct' ? pct : amt}
        onChange={(e) => (mode === 'pct' ? onPct : onAmt)(e.target.value)} placeholder={mode === 'pct' ? '%' : '$'} />
    </div>
    {mode === 'pct' && total !== null && <div className="muted num" style={{ fontSize: 12, marginTop: 2, textAlign: 'right' }}>= {money(round2(total * (Number(pct) || 0) / 100))}</div>}
    {mode === 'amt' && total ? <div className="muted num" style={{ fontSize: 12, marginTop: 2, textAlign: 'right' }}>{Math.round((Number(amt) || 0) / total * 1000) / 10}% of fee</div> : null}
  </div>
}

type TeamMember = { id: string; name: string; initials: string; avatar: string | null; hours: number; pct: number }
type PhaseDrag = { handle: React.ReactNode; row: React.HTMLAttributes<HTMLTableRowElement> & { draggable?: boolean } }
function PhaseRow({ ph, total, team, teamOpen, onTeam, billed, ahead, used, onSaved, drag }: { ph: Phase; total: number | null; team: TeamMember[]; teamOpen: boolean; onTeam: () => void; billed: number; ahead: number; used: { hrs: number; cost: number }; onSaved: () => void; drag?: PhaseDrag }) {
  const startMode = ph.fee_pct != null && total !== null ? 'pct' : 'amt'
  const [f, setF] = useState({ mode: startMode as 'amt' | 'pct', fee: String(ph.fee), pct: ph.fee_pct != null ? String(Number(ph.fee_pct)) : total ? String(Math.round(Number(ph.fee) / total * 10000) / 100) : '',
    status: ph.status, start_date: ph.start_date ?? '', end_date: ph.end_date ?? '' })
  const [msg, setMsg] = useState('')
  const dirty = f.mode !== startMode || (f.mode === 'amt' ? f.fee !== String(ph.fee) : f.pct !== String(Number(ph.fee_pct ?? NaN))) || f.status !== ph.status || f.start_date !== (ph.start_date ?? '') || f.end_date !== (ph.end_date ?? '')
  const pct = Number(ph.fee) ? used.cost / Number(ph.fee) * 100 : 0
  const save = async () => {
    const p = Number(f.pct)
    if (f.mode === 'pct' && !(p >= 0 && p <= 100)) return setMsg('Percent must be between 0 and 100.')
    const fee = f.mode === 'pct' ? round2((total ?? 0) * p / 100) : Number(f.fee) || 0
    const { error } = await supabase.from('phases').update({ fee, fee_pct: f.mode === 'pct' ? p : null, status: f.status, start_date: f.start_date || null, end_date: f.end_date || null }).eq('id', ph.id)
    setMsg(error ? error.message : ''); if (!error) onSaved()
  }
  const setStatus = async (status: string) => {
    const { error } = await supabase.from('phases').update({ status }).eq('id', ph.id)
    setMsg(error ? error.message : ''); if (!error) { setF({ ...f, status }); onSaved() }
  }
  const remove = async () => {
    const hrs = used.hrs ? ` Its ${used.hrs.toFixed(1)} logged hours stay on the project but become “no phase”.` : ''
    const bill = billed ? ' Invoice lines billed to it keep their amounts but lose the phase link.' : ''
    if (!window.confirm(`Delete ${ph.code} · ${phaseLabel(ph)}? Its fee, dates and team allocations are removed.${hrs}${bill} This can’t be undone.`)) return
    const { error } = await supabase.from('phases').delete().eq('id', ph.id)
    if (error) return setMsg(error.message)
    onSaved()
  }
  return (
    <tr {...drag?.row}>
      <td><span className="ph-cell">{drag?.handle ?? <span className="ph-grip-sp" />}<span>{ph.code === 'AS' ? <span style={{ paddingLeft: 14, display: 'inline-block' }}><span className="muted">↳ </span><strong>AS</strong> <span className="muted">{phaseLabel(ph)}</span><div className="muted" style={{ fontSize: 12 }}>Additional service</div></span> : ph.code === 'CU' ? <><strong>{ph.name}</strong> <span className="muted">· custom</span></> : <><strong>{ph.code}</strong> <span className="muted">{PHASE_NAME[ph.code]}</span></>}
        {ph.billing === 'hourly' && <span className="pill" style={{ marginLeft: 6, fontSize: 11 }} title="Billed for hours logged, at each person’s rate">Hourly</span>}{msg && <div className="err">{msg}</div>}</span></span></td>
      <td><label className="sr" htmlFor={'st' + ph.id}>Status</label><select id={'st' + ph.id} className="input" style={{ minWidth: 140 }} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
        <option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="paused">Paused</option><option value="complete">Complete</option></select></td>
      <td><label className="sr" htmlFor={'sd' + ph.id}>Start</label><input id={'sd' + ph.id} type="date" className="input" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></td>
      <td><label className="sr" htmlFor={'ed' + ph.id}>End</label><input id={'ed' + ph.id} type="date" className="input" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></td>
      <td className="r"><FeeInput id={ph.id} mode={f.mode} amt={f.fee} pct={f.pct} total={total} onMode={(m) => setF({ ...f, mode: m })} onAmt={(v) => setF({ ...f, fee: v })} onPct={(v) => setF({ ...f, pct: v })} /></td>
      <td style={{ minWidth: 150 }}>
        {team.length > 0 && <ul className="ph-team">{team.map((m) => <li key={m.id} title={`${m.name}: ${Math.round(m.hours * 10) / 10} hrs`}>
          <Avatar className="pb-avatar" url={m.avatar} initials={m.initials} /><span className="sr">{m.name}</span><span className="num">{Math.round(m.pct)}%</span></li>)}
          {team.length > 1 && <li className="muted num" style={{ fontSize: 12 }}>= {Math.round(team.reduce((a, m) => a + m.pct, 0))}%</li>}</ul>}
        <button type="button" className="linkbtn" style={{ fontSize: 13 }} aria-expanded={teamOpen} onClick={onTeam}>{teamOpen ? 'Close' : team.length ? 'Edit team' : '+ Assign team'}</button></td>
      <td className="r num">{money(billed)}{ahead > 0 && <div className="pd-ahead" title="Billed ahead of the work done on this phase">{money(ahead)} ahead</div>}</td>
      <td className="r num">{used.hrs.toFixed(1)}</td>
      <td style={{ minWidth: 160 }}><div style={{ height: 8, borderRadius: 999, background: '#ece9e3', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: Math.min(100, pct) + '%', background: pct >= 90 ? '#d92d20' : pct >= 75 ? '#dc6803' : 'var(--navy)' }} /></div>
        <div className="muted num" style={{ fontSize: 12, marginTop: 4 }}>{money(used.cost)} · {pct.toFixed(0)}%</div></td>
      <td><div className="row" style={{ gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>{dirty && <button className="btn small" onClick={save}>Save</button>}
        <RowMenu label={`${ph.code} actions`} items={[
          { label: teamOpen ? 'Close team' : team.length ? 'Edit team' : 'Assign team', onSelect: onTeam },
          ...(['not_started', 'in_progress', 'paused', 'complete'] as const).filter((st) => st !== ph.status).map((st) => ({ label: `Mark ${({ not_started: 'not started', in_progress: 'in progress', paused: 'paused', complete: 'complete' })[st]}`, onSelect: () => setStatus(st) })),
          { label: ph.billing === 'hourly' ? 'Bill as a fixed fee' : 'Bill hourly', onSelect: async () => { const { error } = await supabase.from('phases').update({ billing: ph.billing === 'hourly' ? 'fixed' : 'hourly' }).eq('id', ph.id); setMsg(error ? error.message : ''); if (!error) onSaved() } },
          ...(ph.code === 'CU' ? [{ label: 'Rename…', onSelect: async () => { const n = window.prompt('Phase name', ph.name ?? ''); if (!n?.trim()) return; const { error } = await supabase.from('phases').update({ name: n.trim() }).eq('id', ph.id); setMsg(error ? error.message : ''); if (!error) onSaved() } }] : []),
          'divider',
          { label: 'Delete phase…', danger: true, onSelect: remove },
        ]} /></div></td>
    </tr>)
}

function AddPhase({ projectId, codes, total, onSaved }: { projectId: string; codes: string[]; total: number | null; onSaved: () => void }) {
  // standard phases not on the project yet, plus "Custom phase…" (any name, as many as needed)
  const [code, setCode] = useState(codes[0] ?? 'CU'); const [fee, setFee] = useState(''); const [pct, setPct] = useState('')
  const [name, setName] = useState(''); const [billing, setBilling] = useState<'fixed' | 'hourly'>('fixed'); const [err, setErr] = useState('')
  const [mode, setMode] = useState<'amt' | 'pct'>(total !== null ? 'pct' : 'amt')
  useEffect(() => { if (code !== 'CU' && !codes.includes(code)) setCode(codes[0] ?? 'CU') }, [codes.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    setErr('')
    if (code === 'CU' && !name.trim()) return setErr('Name the custom phase.')
    const p = Number(pct)
    const { error } = await supabase.from('phases').insert({ project_id: projectId, code, name: code === 'CU' ? name.trim() : null, billing,
      fee: mode === 'pct' ? round2((total ?? 0) * (p || 0) / 100) : Number(fee) || 0, fee_pct: mode === 'pct' ? p || 0 : null })
    if (error) return setErr(error.message)
    setFee(''); setPct(''); setName(''); setBilling('fixed'); onSaved()
  }
  return <div className="stack" style={{ gap: 6 }}><div className="row" style={{ alignItems: 'flex-start' }}>
    <label className="sr" htmlFor="ap-c">Phase</label><select id="ap-c" className="input" style={{ width: 260 }} value={code} onChange={(e) => setCode(e.target.value)}>
      {codes.map((c) => <option key={c} value={c}>{c} · {PHASE_NAME[c]}</option>)}<option value="CU">Custom phase…</option></select>
    {code === 'CU' && <><label className="sr" htmlFor="ap-n">Custom phase name</label><input id="ap-n" className="input" style={{ width: 220 }} placeholder="e.g. Site visits, Interior design" value={name} onChange={(e) => setName(e.target.value)} /></>}
    <label className="sr" htmlFor="ap-b">Billing</label><select id="ap-b" className="input" style={{ width: 150 }} value={billing} onChange={(e) => setBilling(e.target.value as 'fixed' | 'hourly')}>
      <option value="fixed">Fixed fee</option><option value="hourly">Hourly</option></select>
    <FeeInput id="ap" mode={mode} amt={fee} pct={pct} total={total} onMode={setMode} onAmt={setFee} onPct={setPct} />
    <button className="btn small secondary" onClick={add}>+ Add phase</button>
  </div>{billing === 'hourly' && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Hourly: invoices bill the hours logged to it at each person’s rate. The fee is the budget (leave it 0 if there isn’t one).</p>}
  {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}</div>
}

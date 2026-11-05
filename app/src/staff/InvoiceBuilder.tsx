import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase, money, SECTOR_COLOR, PHASES, PHASE_NAME } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { todayIso, addDays, fmtDate, num, round2, cardFee, achFee, nextInvoiceNumber, displayStatus, emailInvoice } from '../lib/invoices'
import './invoices.css'

type Phase = { id: string; code: string; fee: number; status: string }
type Expense = { id: string; description: string; amount: number; spent_on: string; invoice_id: string | null }
type Item = { kind: string; description: string; amount: string }
type Project = { id: string; number: string; name: string; sector: string | null; client_id: string | null; clients: { name: string; billing_email: string | null; address: string | null } | null }
type Inv = {
  id: string; number: string; project_id: string; client_id: string | null; status: string; period_start: string | null; period_end: string | null; issue_date: string | null
  terms_days: number; due_date: string | null; total: number; amount_paid: number; note: string | null; allow_card: boolean; allow_ach: boolean; pass_card_fee: boolean; pass_ach_fee: boolean
  reminders: boolean; hold_drawings: boolean; email_subject: string | null; email_message: string | null; agreement_mode: string; show_prior_balance: boolean; sent_at: string | null; billing_basis?: string | null; allow_wire?: boolean
}
type Line = { kind: string; phase_id: string | null; description: string; pct_to_date: number | null; amount: number; sort: number }

const STATUS_STYLE: Record<string, [string, string, string]> = { complete: ['Complete', '#344054', '#e4e7ec'], in_progress: ['In progress', '#fff', '#039855'], paused: ['Paused', '#fff', '#d92d20'], not_started: ['Not started', '#344054', '#fff'] }
const ITEM_LABEL: Record<string, string> = { late: 'Late charge', retainer: 'Retainer', tax: 'Sales tax', credit: 'Credit', other: '' }
const order = (code: string) => PHASES.findIndex(([c]) => c === code)

export default function InvoiceBuilder() {
  const { id } = useParams()
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  const { profile } = useAuth()
  const [projectId, setProjectId] = useState<string>(sp.get('project') ?? '')

  // existing invoice (edit/view)
  const existing = useLoad(async () => {
    if (!id) return null
    const inv = must(await supabase.from('invoices').select('*').eq('id', id).single()) as unknown as Inv
    const lines = must(await supabase.from('invoice_lines').select('kind, phase_id, description, pct_to_date, amount, sort').eq('invoice_id', id).order('sort')) as Line[]
    const rc = must(await supabase.from('invoice_recipients').select('email, kind').eq('invoice_id', id)) as { email: string; kind: string }[]
    return { inv, lines, rc }
  }, [id])
  useEffect(() => { if (existing.data?.inv) setProjectId(existing.data.inv.project_id) }, [existing.data])

  const projects = useLoad(async () => must(await supabase.from('projects').select('id, number, name, status').neq('number', 'OH').order('number', { ascending: false })) as { id: string; number: string; name: string; status: string }[])

  const ctx = useLoad(async () => {
    if (!projectId) return null
    const p = must(await supabase.from('projects').select('id, number, name, sector, client_id, clients(name, billing_email, address)').eq('id', projectId).single()) as unknown as Project
    const phases = (must(await supabase.from('phases').select('id, code, fee, status').eq('project_id', projectId)) as Phase[]).sort((a, b) => order(a.code) - order(b.code))
    const billedLines = phases.length ? must(await supabase.from('invoice_lines').select('phase_id, amount, invoice_id, invoices!inner(status)').eq('kind', 'phase').in('phase_id', phases.map((x) => x.id))) as unknown as { phase_id: string; amount: number; invoice_id: string; invoices: { status: string } }[] : []
    const billedBefore: Record<string, number> = {}
    billedLines.filter((l) => l.invoice_id !== id && ['open', 'paid'].includes(l.invoices.status)).forEach((l) => { billedBefore[l.phase_id] = (billedBefore[l.phase_id] ?? 0) + Number(l.amount) })
    const expenses = must(await supabase.from('expenses').select('id, description, amount, spent_on, invoice_id').eq('project_id', projectId).eq('reimbursable', true).or('planned.is.null,planned.eq.false').order('spent_on')) as Expense[]
    const contacts = p.client_id ? must(await supabase.from('client_contacts').select('email, receives_invoices').eq('client_id', p.client_id)) as { email: string; receives_invoices: boolean }[] : []
    const pastDue = p.client_id ? (must(await supabase.from('invoices').select('id, number, total, amount_paid, due_date').eq('client_id', p.client_id).eq('status', 'open').lt('due_date', todayIso()).lte('issue_date', addDays(todayIso(), -15))) as { id: string; number: string; total: number; amount_paid: number; due_date: string }[]).filter((x) => x.id !== id) : []
    const settings = must(await supabase.from('firm_settings').select('late_rate_monthly, wire_routing, wire_account').maybeSingle()) as { late_rate_monthly: number; wire_routing: string | null; wire_account: string | null } | null
    const agreements = must(await supabase.from('agreements').select('id, title, status').eq('project_id', projectId).in('status', ['sent', 'signed'])) as { id: string; title: string; status: string }[]
    return { p, phases, billedBefore, expenses: expenses.filter((e) => !e.invoice_id || e.invoice_id === id), contacts, pastDue, lateRate: Number(settings?.late_rate_monthly ?? 1.5), wireReady: !!(settings?.wire_routing && settings?.wire_account), agreements }
  }, [projectId, id])

  // ---- editable state
  const [tab, setTab] = useState<'build' | 'send'>('build')
  const [view, setView] = useState<'invoice' | 'email'>('invoice')
  const [from, setFrom] = useState(''); const [to, setTo] = useState(todayIso())
  const [due, setDue] = useState<Record<string, string>>({})
  const [exOn, setExOn] = useState<Record<string, boolean>>({}); const [markup, setMarkup] = useState(true)
  const [items, setItems] = useState<Item[]>([])
  const [toList, setToList] = useState<string[]>([]); const [ccList, setCcList] = useState<string[]>([]); const [newTo, setNewTo] = useState(''); const [newCc, setNewCc] = useState('')
  const [subject, setSubject] = useState(''); const [message, setMessage] = useState(''); const [note, setNote] = useState('')
  const [issue, setIssue] = useState(todayIso()); const [terms, setTerms] = useState(0)
  const [opts, setOpts] = useState({ allow_card: true, allow_ach: true, allow_wire: true, pass_card_fee: false, pass_ach_fee: false, reminders: true, hold_drawings: true, show_prior_balance: true, agreement_mode: 'link', billing_basis: 'progress' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const [hydrated, setHydrated] = useState('')

  // hydrate from an existing invoice, or defaults for a new one
  useEffect(() => {
    const c = ctx.data; if (!c) return
    const key = (id ?? 'new') + c.p.id
    if (hydrated === key) return
    const e = existing.data
    if (id && !e) return
    if (e) {
      const i = e.inv
      setFrom(i.period_start ?? ''); setTo(i.period_end ?? todayIso()); setIssue(i.issue_date ?? todayIso()); setTerms(i.terms_days ?? 0); setNote(i.note ?? '')
      setSubject(i.email_subject ?? `Invoice ${i.number} — ${c.p.name}`); setMessage(i.email_message ?? defaultMessage(c.p, profile?.full_name))
      setOpts({ allow_card: i.allow_card, allow_ach: i.allow_ach, allow_wire: i.allow_wire ?? true, pass_card_fee: i.pass_card_fee, pass_ach_fee: i.pass_ach_fee, reminders: i.reminders, hold_drawings: i.hold_drawings, show_prior_balance: i.show_prior_balance, agreement_mode: i.agreement_mode, billing_basis: i.billing_basis ?? 'progress' })
      const d: Record<string, string> = {}; e.lines.filter((l) => l.kind === 'phase' && l.phase_id).forEach((l) => { d[l.phase_id!] = String(l.amount) }); setDue(d)
      setItems(e.lines.filter((l) => !['phase', 'expense', 'markup'].includes(l.kind)).map((l) => ({ kind: l.kind, description: l.description, amount: String(l.amount) })))
      setMarkup(e.lines.some((l) => l.kind === 'markup') || !e.lines.some((l) => l.kind === 'expense'))
      const on: Record<string, boolean> = {}; c.expenses.forEach((x) => { on[x.id] = x.invoice_id === id }); setExOn(on)
      setToList(e.rc.filter((r) => r.kind === 'to').map((r) => r.email)); setCcList(e.rc.filter((r) => r.kind === 'cc').map((r) => r.email))
    } else {
      const inv = c.contacts.filter((x) => x.receives_invoices).map((x) => x.email)
      setToList(inv.length ? inv : c.p.clients?.billing_email ? [c.p.clients.billing_email] : [])
      setCcList(profile?.email ? [profile.email] : [])
      setSubject(`Invoice — ${c.p.number} ${c.p.name}`); setMessage(defaultMessage(c.p, profile?.full_name))
      const on: Record<string, boolean> = {}; c.expenses.forEach((x) => { on[x.id] = true }); setExOn(on)
      setDue({}); setItems([]); setFrom('')
    }
    setHydrated(key)
  }, [ctx.data, existing.data, id, hydrated, profile])

  const locked = !!existing.data && existing.data.inv.status !== 'draft'
  const advance = opts.billing_basis === 'advance' // down payment: phases billed ahead of the work, not for work done
  const c = ctx.data

  // ---- math
  const phaseRows = useMemo(() => (c?.phases ?? []).map((ph) => {
    const prev = c!.billedBefore[ph.id] ?? 0
    const d = num(due[ph.id]); const cum = prev + d; const fee = Number(ph.fee)
    return { ph, prev, d, cum, fee, pct: fee ? cum / fee * 100 : 0, over: cum > fee + 0.005, remain: fee - cum }
  }), [c, due])
  const fixed = round2(phaseRows.reduce((a, r) => a + r.d, 0))
  const exSel = (c?.expenses ?? []).filter((x) => exOn[x.id])
  const exBase = round2(exSel.reduce((a, x) => a + Number(x.amount), 0)); const exMark = markup ? round2(exBase * 0.1) : 0
  const extra = round2(items.reduce((a, x) => a + num(x.amount), 0))
  const total = round2(fixed + exBase + exMark + extra)
  const prior = round2((c?.pastDue ?? []).reduce((a, x) => a + Number(x.total) - Number(x.amount_paid), 0))
  const warn = [
    ...phaseRows.filter((r) => r.over).map((r) => `${PHASE_NAME[r.ph.code]} would be billed past 100% of its fee.`),
    ...phaseRows.filter((r) => r.d < 0).map((r) => `${PHASE_NAME[r.ph.code]} has a negative amount — use a Credit line instead.`),
  ]
  const dueDate = issue ? addDays(issue, terms) : ''
  const setPct = (ph: Phase, prev: number, v: string) => { const p = num(v); setDue({ ...due, [ph.id]: String(round2(p / 100 * Number(ph.fee) - prev)) }) }
  const addItem = (kind: string) => {
    const amount = kind === 'late' ? String(round2(prior * (c?.lateRate ?? 1.5) / 100)) : kind === 'credit' ? '-0' : '0'
    const description = kind === 'late' ? `Late charge — ${c?.pastDue.map((x) => x.number).join(', ')} at ${c?.lateRate ?? 1.5}% per month (Agreement §6.5)` : ITEM_LABEL[kind]
    setItems([...items, { kind, description, amount }])
  }

  // ---- persistence
  const buildLines = (): Omit<Line, 'sort'>[] => [
    ...phaseRows.filter((r) => r.d !== 0).map((r) => ({ kind: 'phase', phase_id: r.ph.id, description: `${r.ph.code} · ${PHASE_NAME[r.ph.code]}${advance ? ' — billed in advance' : ''}`, pct_to_date: round2(r.pct), amount: round2(r.d) })),
    ...exSel.map((x) => ({ kind: 'expense', phase_id: null, description: x.description, pct_to_date: null, amount: Number(x.amount) })),
    ...(exMark ? [{ kind: 'markup', phase_id: null, description: 'Service fee on reimbursables, 10% (Agreement §8.2)', pct_to_date: null, amount: exMark }] : []),
    ...items.filter((x) => x.description.trim() || num(x.amount)).map((x) => ({ kind: x.kind, phase_id: null, description: x.description.trim() || (ITEM_LABEL[x.kind] || 'Other'), pct_to_date: null, amount: round2(num(x.amount)) })),
  ]
  const save = async (): Promise<string | null> => {
    if (!c) return null
    if (warn.length) { setErr(warn[0]); return null }
    setBusy(true); setErr('')
    try {
      const fields = {
        project_id: c.p.id, client_id: c.p.client_id, period_start: from || null, period_end: to || null, issue_date: issue || null, terms_days: terms, due_date: dueDate || null,
        subtotal: total, total, note: note || null, email_subject: subject, email_message: message, ...opts,
      }
      let invId = id ?? null
      if (invId) must(await supabase.from('invoices').update(fields).eq('id', invId))
      else {
        const number = await nextInvoiceNumber(c.p.id, c.p.number)
        invId = (must(await supabase.from('invoices').insert({ ...fields, number, status: 'draft', created_by: profile!.id }).select('id').single()) as { id: string }).id
        await supabase.from('invoice_events').insert({ invoice_id: invId, kind: 'created', actor: profile!.id })
      }
      must(await supabase.from('invoice_lines').delete().eq('invoice_id', invId))
      const lines = buildLines().map((l, i) => ({ ...l, invoice_id: invId, sort: i }))
      if (lines.length) must(await supabase.from('invoice_lines').insert(lines))
      must(await supabase.from('invoice_recipients').delete().eq('invoice_id', invId))
      const rc = [...toList.map((e) => ({ invoice_id: invId, email: e, kind: 'to' })), ...ccList.map((e) => ({ invoice_id: invId, email: e, kind: 'cc' }))]
      if (rc.length) must(await supabase.from('invoice_recipients').insert(rc))
      // attach chosen reimbursables to this invoice, release the rest
      const onIds = exSel.map((x) => x.id); const offIds = c.expenses.filter((x) => !exOn[x.id] && x.invoice_id === invId).map((x) => x.id)
      if (onIds.length) must(await supabase.from('expenses').update({ invoice_id: invId }).in('id', onIds))
      if (offIds.length) must(await supabase.from('expenses').update({ invoice_id: null }).in('id', offIds))
      setBusy(false)
      return invId
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); setBusy(false); return null }
  }
  const saveDraft = async () => { const invId = await save(); if (invId) { setOk('Draft saved.'); if (!id) nav(`/invoices/${invId}`, { replace: true }); else existing.reload() } }
  const send = async () => {
    if (!toList.length) return setErr('Add at least one recipient.')
    if (total <= 0) return setErr('The invoice total is $0.')
    const invId = await save(); if (!invId) return
    setBusy(true); setErr(''); setOk('')
    const r = await emailInvoice(invId, 'invoice')
    setBusy(false)
    if (r.ok) setOk(r.message); else setErr(r.message)
    if (!id) nav(`/invoices/${invId}`, { replace: true }); else existing.reload()
  }
  const remind = async () => {
    if (!id) return
    setBusy(true); setErr(''); setOk('')
    const r = await emailInvoice(id, 'reminder')
    setBusy(false)
    if (r.ok) { setOk(r.message); existing.reload() } else setErr(r.message)
  }

  // ---- render
  if (existing.error) return <p className="err">{existing.error}</p>
  if (!projectId) return (
    <div className="stack">
      <Link to="/invoices" style={{ fontWeight: 700, textDecoration: 'none' }}>‹ Invoices</Link>
      <h1>New invoice</h1>
      <div className="card pad stack" style={{ maxWidth: 520 }}>
        <label className="l" htmlFor="ib-proj">Project</label>
        <select id="ib-proj" className="input" value="" onChange={(e) => { setProjectId(e.target.value); setSp({ project: e.target.value }, { replace: true }) }}>
          <option value="">Choose a project…</option>{projects.data?.filter((p) => p.status !== 'complete').map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}
          <optgroup label="Complete">{projects.data?.filter((p) => p.status === 'complete').map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</optgroup>
        </select>
      </div>
    </div>)
  if (!c || (id && !existing.data)) return <p>Loading…</p>

  const inv = existing.data?.inv
  const number = inv?.number ?? `${c.p.number}-###`
  const st = inv ? displayStatus({ status: inv.status as never, due_date: inv.due_date, total: inv.total, amount_paid: inv.amount_paid }) : { label: 'Draft', color: '#5f6368' }
  const sec = { padding: '18px 20px' }
  const tog = (k: keyof typeof opts, label: string, hint?: string) => <label className="tog"><input type="checkbox" disabled={locked} checked={opts[k] as boolean} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /><span>{label}{hint && <small>{hint}</small>}</span></label>
  const addTo = () => { const v = newTo.trim(); if (/.+@.+\..+/.test(v) && !toList.includes(v)) { setToList([...toList, v]); setNewTo('') } }
  const addCc = () => { const v = newCc.trim(); if (/.+@.+\..+/.test(v) && !ccList.includes(v)) { setCcList([...ccList, v]); setNewCc('') } }
  const chips = (list: string[], setList: (v: string[]) => void, val: string, setVal: (v: string) => void, label: string, idp: string, add: () => void) => (
    <div><p className="l" style={{ margin: '0 0 5px' }}>{label}</p>
      <div className="row" style={{ gap: 6 }}>{list.map((e) => <span key={e} className="chip">{e}{!locked && <button type="button" aria-label={`Remove ${e}`} onClick={() => setList(list.filter((x) => x !== e))}>×</button>}</span>)}{list.length === 0 && <span className="muted" style={{ fontSize: 13 }}>None</span>}</div>
      {!locked && <div className="row" style={{ marginTop: 6, flexWrap: 'nowrap' }}><label className="sr" htmlFor={idp}>Add {label}</label><input id={idp} className="input" placeholder="Add email" value={val} onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} /><button type="button" className="btn small secondary" onClick={add}>Add</button></div>}
    </div>)
  const wireOn = opts.allow_wire && !!c.wireReady
  const payWays = [opts.allow_ach ? 'bank transfer (ACH)' : '', wireOn ? 'wire' : '', opts.allow_card ? 'card' : ''].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' or $1') || 'check'

  return (
    <div className="stack">
      <Link to="/invoices" style={{ fontWeight: 700, textDecoration: 'none' }}>‹ Invoices</Link>
      <div className="row between">
        <h1 className="row" style={{ gap: 10 }}>Invoice {number} <span className="muted" style={{ fontWeight: 400 }}>for</span>
          <span className="tag" style={{ background: SECTOR_COLOR[c.p.sector ?? ''] ?? '#6b7280', height: 26, fontSize: 14 }}>{c.p.number}</span>{c.p.name}
          <span className="status" style={{ color: st.color }}>{st.label}</span></h1>
        <p style={{ margin: 0 }}>Invoice total <strong className="num" style={{ fontSize: 20 }}>{money(total)}</strong></p>
      </div>
      {locked && <p className="ok" style={{ margin: 0 }}>This invoice has been {inv?.status === 'paid' ? 'paid' : 'sent'}, so it’s locked. Record payments from the Invoices list.</p>}
      {ok && <p className="ok" role="status" style={{ margin: 0 }}>{ok}</p>}
      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div role="tablist" className="row" style={{ gap: 22, borderBottom: '1px solid #ddd8ce' }}>
        {(['build', 'send'] as const).map((t, i) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
          style={{ minHeight: 42, padding: '0 2px', border: 0, borderBottom: `3px solid ${tab === t ? 'var(--navy)' : 'transparent'}`, background: 'none', font: '700 16px Arial', color: tab === t ? 'var(--text)' : 'var(--muted)', cursor: 'pointer' }}>{i + 1}. {t === 'build' ? 'Build' : 'Review & send'}</button>)}
      </div>

      {tab === 'build' && <>
        <section className="card stack" style={sec}>
          <div className="row between" style={{ alignItems: 'flex-end' }}>
            <div className="stack" style={{ gap: 8 }}>
              <h2>Architecture services — fixed fee</h2>
              <div className="ib-basis" role="radiogroup" aria-label="What this invoice bills for">
                {([['progress', 'Work done'], ['advance', 'Down payment (in advance)']] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={opts.billing_basis === k} disabled={locked}
                  className={opts.billing_basis === k ? 'on' : ''} onClick={() => setOpts({ ...opts, billing_basis: k })}>{l}</button>)}
              </div>
            </div>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div><label className="l" htmlFor="ib-from">{advance ? 'Covers work from' : 'Services from'}</label><input id="ib-from" type="date" className="input" disabled={locked} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><label className="l" htmlFor="ib-to">through</label><input id="ib-to" type="date" className="input" disabled={locked} value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          </div>
          {phaseRows.length === 0 ? <p className="muted" style={{ margin: 0 }}>This project has no phases yet. <Link to={`/projects/${c.p.id}`}>Add phases and fees on the project page</Link>, or bill with Other items below.</p> : (
            <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 900 }}>
              <div className="ib-cols" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                <span>Phase</span><span style={{ textAlign: 'right' }}>Fee</span><span style={{ textAlign: 'right' }}>Billed before</span><span>Status</span><span style={{ textAlign: 'right' }}>{advance ? '% billed to date' : '% complete'}</span><span style={{ textAlign: 'right' }}>This invoice ($)</span><span style={{ textAlign: 'right' }}>Remaining</span></div>
              {phaseRows.map((r) => { const s = STATUS_STYLE[r.ph.status] ?? STATUS_STYLE.not_started; return (
                <div key={r.ph.id} className="ib-cols" style={{ padding: '10px 0', borderBottom: '1px solid #efece6' }}>
                  <strong>{PHASE_NAME[r.ph.code]}</strong>
                  <span className="num" style={{ textAlign: 'right' }}>{money(r.fee)}</span>
                  <span className="num" style={{ textAlign: 'right' }}>{money(r.prev)} <span className="muted">({r.fee ? Math.round(r.prev / r.fee * 100) : 0}%)</span></span>
                  <span><span className="status" style={{ color: s[1], background: s[2] }}>{s[0]}</span></span>
                  <PctInput label={`${PHASE_NAME[r.ph.code]} ${advance ? 'percent billed to date' : 'percent complete to date'}`} value={round2(r.pct)} disabled={locked} bad={r.over} onCommit={(v) => setPct(r.ph, r.prev, v)} />
                  <label style={{ position: 'relative', display: 'block' }}><span className="sr">{PHASE_NAME[r.ph.code]} amount this invoice</span>
                    <span aria-hidden="true" className="muted" style={{ position: 'absolute', left: 10, top: 12 }}>$</span>
                    <input className="input num" inputMode="decimal" disabled={locked} style={{ textAlign: 'right', paddingLeft: 22, borderColor: r.over ? '#d92d20' : undefined }} value={due[r.ph.id] ?? ''} placeholder="0" onChange={(e) => setDue({ ...due, [r.ph.id]: e.target.value })} /></label>
                  <span className="num" style={{ textAlign: 'right', color: r.remain < -0.005 ? '#b42318' : undefined }}>{money(r.remain)}</span>
                </div>) })}
              <div className="ib-cols" style={{ padding: '10px 0', fontWeight: 700 }}><span>Fixed fee total</span><span /><span /><span /><span /><span className="num" style={{ textAlign: 'right' }}>{money(fixed)}</span><span /></div>
            </div></div>)}
          {advance
            ? <p className="ib-adv" role="note"><strong>Down payment.</strong> Bill the phases this payment covers ahead of the work (for example SD 100%, DD 100%, CD 50%). The client’s invoice says “Billed in advance,” not “Complete,” and the amounts count toward each phase, so later invoices only bill what’s left. The project overview shows how much is billed ahead of the work.</p>
            : <p className="muted" style={{ margin: 0, fontSize: 13 }}><em>Type the percent complete to date, or the dollar amount — the other fills in. A phase can’t be billed past 100% of its fee.</em></p>}
          {warn.length > 0 && <div role="alert" className="err">{warn.map((w) => <p key={w} style={{ margin: 0 }}>{w}</p>)}</div>}
        </section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
          <section className="card stack" style={sec}>
            <div className="row between"><h2>Reimbursable expenses</h2><strong className="num">{money(exBase + exMark)}</strong></div>
            {c.expenses.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 14 }}>No unbilled reimbursable expenses on this project.</p>}
            {c.expenses.map((x) => <label key={x.id} className="row" style={{ gap: 10, fontSize: 14, flexWrap: 'nowrap' }}><input type="checkbox" disabled={locked} checked={!!exOn[x.id]} onChange={(e) => setExOn({ ...exOn, [x.id]: e.target.checked })} style={{ width: 18, height: 18 }} /><span style={{ flex: 1 }}>{x.description} <span className="muted">· {fmtDate(x.spent_on)}</span></span><span className="num">{money(x.amount)}</span></label>)}
            {c.expenses.length > 0 && <label className="tog"><input type="checkbox" disabled={locked} checked={markup} onChange={(e) => setMarkup(e.target.checked)} /><span>Add 10% service fee<small>Agreement §8.2: reimbursables carry a 10% service fee.</small></span></label>}
          </section>
          <section className="card stack" style={sec}>
            <div className="row between"><h2>Other items</h2><strong className="num">{money(extra)}</strong></div>
            {items.map((x, i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 130px auto', gap: 8, alignItems: 'center' }}>
              <label className="sr" htmlFor={'it-d' + i}>Description</label><input id={'it-d' + i} className="input" disabled={locked} placeholder="Description" value={x.description} onChange={(e) => setItems(items.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
              <label className="sr" htmlFor={'it-a' + i}>Amount</label><input id={'it-a' + i} className="input num" disabled={locked} inputMode="decimal" style={{ textAlign: 'right' }} value={x.amount} onChange={(e) => setItems(items.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
              {!locked && <button className="linkbtn" aria-label="Remove item" style={{ fontSize: 20, color: 'var(--muted)' }} onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button>}
            </div>)}
            {!locked && <div className="row" style={{ gap: 8 }}>{prior > 0 && <button className="btn small secondary" onClick={() => addItem('late')}>+ Late charge</button>}
              {['retainer', 'tax', 'credit', 'other'].map((k) => <button key={k} className="btn small secondary" onClick={() => addItem(k)}>+ {k === 'other' ? 'Other' : ITEM_LABEL[k]}</button>)}</div>}
            {prior > 0 && <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fdf1dc', fontSize: 14 }} className="stack">
              <span><strong>{c.p.clients?.name} still owes {money(prior)}</strong> on {c.pastDue.map((x) => x.number).join(', ')} (past due).</span>
              {tog('show_prior_balance', 'Show the unpaid balance on this invoice')}
              <small className="muted">“+ Late charge” fills in {c.lateRate}% per month on that balance (Agreement §6.5).</small></div>}
          </section>
        </div>
        <div className="row between">
          {!locked ? <button className="btn secondary" disabled={busy} onClick={saveDraft}>Save draft</button> : <span />}
          <button className="btn" onClick={() => setTab('send')}>Next: Review &amp; send ›</button>
        </div>
      </>}

      {tab === 'send' && <div className="ib-send">
        <div className="stack">
          <section className="card stack" style={sec}>
            <h2>Recipients</h2>
            {chips(toList, setToList, newTo, setNewTo, 'To', 'ib-to-new', addTo)}
            {chips(ccList, setCcList, newCc, setNewCc, 'Cc', 'ib-cc-new', addCc)}
            <div><label className="l" htmlFor="ib-sub">Subject</label><input id="ib-sub" className="input" disabled={locked} value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div><label className="l" htmlFor="ib-msg">Message</label><textarea id="ib-msg" className="input" rows={5} disabled={locked} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
            <div><label className="l" htmlFor="ib-note">Note printed on the invoice (optional)</label><input id="ib-note" className="input" disabled={locked} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </section>
          <section className="card stack" style={sec}>
            <h2>Dates</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><label className="l" htmlFor="ib-iss">Issue date</label><input id="ib-iss" type="date" className="input" disabled={locked} value={issue} onChange={(e) => setIssue(e.target.value)} /></div>
              <div><label className="l" htmlFor="ib-terms">Terms</label><select id="ib-terms" className="input" disabled={locked} value={terms} onChange={(e) => setTerms(Number(e.target.value))}><option value={0}>Due on receipt</option><option value={15}>Net 15</option><option value={30}>Net 30</option></select></div>
            </div>
            <p style={{ margin: 0 }}>Due <strong>{fmtDate(dueDate)}</strong></p>
          </section>
          <section className="card stack" style={sec}>
            <h2>Payment</h2>
            {tog('allow_card', 'Credit card')}
            {opts.allow_card && <div style={{ marginLeft: 28 }}>{tog('pass_card_fee', 'Pass the card fee to the client', `Stripe fee on this invoice ≈ ${money(cardFee(total))}${opts.pass_card_fee ? ' — added to the client’s total' : ' — absorbed by you'}`)}</div>}
            {tog('allow_ach', 'Bank transfer (ACH)', 'Clears in about 4 business days; drawings release when it clears.')}
            {opts.allow_ach && <div style={{ marginLeft: 28 }}>{tog('pass_ach_fee', 'Pass the ACH fee to the client', `Stripe fee on this invoice ≈ ${money(achFee(total))}${opts.pass_ach_fee ? ' — added to the client’s total' : ' — absorbed by you'}`)}</div>}
            {(opts.allow_card && opts.pass_card_fee || opts.allow_ach && opts.pass_ach_fee) && <p role="note" className="err" style={{ margin: 0, fontSize: 12 }}>Card surcharges are limited by state law and card-network rules (caps and disclosure). Confirm before turning this on.</p>}
            {tog('allow_wire', 'Wire transfer', c.wireReady ? 'Shows your bank’s wire instructions on the invoice page (not in the email). No Stripe fee.' : 'Add your wire instructions in Settings → Firm to offer this.')}
            {!opts.allow_card && !opts.allow_ach && !wireOn && <p style={{ margin: 0, fontSize: 13, color: '#b54708' }}>No online payment — the client can only pay by check.</p>}
            <p className="muted" style={{ margin: 0, fontSize: 12 }}><em>Estimates use Stripe’s standard US rates (cards 2.9% + 30¢; ACH 0.8%, $5 cap). Check your account’s current rates. Online payment is connected on day 3.</em></p>
          </section>
          <section className="card stack" style={sec}>
            <h2>Delivery</h2>
            <div><label className="l" htmlFor="ib-agr">Signed agreement</label>
              <select id="ib-agr" className="input" disabled={locked} value={opts.agreement_mode} onChange={(e) => setOpts({ ...opts, agreement_mode: e.target.value })}>
                <option value="link">Link to it in the portal (recommended)</option><option value="attach">Attach the PDF to the email</option><option value="none">Don’t mention it</option></select>
              {c.agreements.length === 0 && opts.agreement_mode !== 'none' && <small className="muted">No sent or signed agreement on this project yet.</small>}</div>
            {opts.agreement_mode === 'attach' && <p style={{ margin: 0, fontSize: 12, color: '#b54708' }}>A 10-page attachment on every invoice makes the email more likely to land in spam.</p>}
            {tog('reminders', 'Automatic reminders', 'On the due date, then every 7 days until paid (up to 4). Stops when a payment starts.')}
            {tog('hold_drawings', 'Hold this period’s drawings until paid', 'Shown to the client on the invoice and in their portal.')}
          </section>
        </div>
        <div className="stack" style={{ minWidth: 0 }}>
          <div className="row between">
            <div role="group" aria-label="Preview" style={{ display: 'inline-flex', border: '1px solid #b9b4aa', borderRadius: 6, overflow: 'hidden' }}>
              {(['invoice', 'email'] as const).map((v) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)} style={{ minHeight: 36, padding: '0 14px', border: 0, font: '700 14px Arial', cursor: 'pointer', background: view === v ? 'var(--navy)' : '#fff', color: view === v ? '#fff' : 'var(--navy)' }}>{v === 'invoice' ? 'Invoice' : 'Email'}</button>)}
            </div>
            <div className="row">
              <button className="btn secondary" onClick={() => setTab('build')}>‹ Back</button>
              <button className="btn secondary" onClick={() => window.print()}>Print / PDF</button>
              {!locked && <><button className="btn secondary" disabled={busy} onClick={saveDraft}>Save draft</button><button className="btn" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send invoice'}</button></>}
              {locked && inv?.status === 'open' && <button className="btn" disabled={busy} onClick={remind}>{busy ? 'Sending…' : 'Send reminder'}</button>}
            </div>
          </div>
          {!locked && <p className="muted" style={{ margin: 0, fontSize: 13 }}>“Send invoice” emails each recipient their own link, so you can see who opened and viewed it. Online payment is coming soon; the invoice page says so.</p>}
          {view === 'invoice' ? (
            <article aria-label="Invoice preview" className="ib-doc">
              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr', gap: 24 }}>
                <div style={{ width: 120, height: 120, background: 'var(--navy)', color: '#ede6d6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'EB Garamond', Georgia, serif" }}><span style={{ fontSize: 22, letterSpacing: '.18em' }}>ABAYA</span><span style={{ fontSize: 8, letterSpacing: '.3em' }}>DESIGN STUDIO</span></div>
                <div><p className="muted" style={{ margin: '0 0 6px' }}>Bill from</p><p style={{ margin: 0, lineHeight: 1.45 }}><strong>Abaya Design Studio, LLC</strong><br />215 S Denton Tap Rd, Suite 215<br />Coppell, Texas 75019<br />billing@abayadesignstudio.com</p></div>
                <div><p className="muted" style={{ margin: '0 0 6px' }}>Bill to</p><p style={{ margin: 0, lineHeight: 1.45, whiteSpace: 'pre-line' }}><strong>{c.p.clients?.name ?? '—'}</strong>{c.p.clients?.address ? '\n' + c.p.clients.address : ''}</p></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 20 }}>
                <div><p className="muted" style={{ margin: '0 0 4px' }}>Project</p><p className="row" style={{ margin: 0, gap: 8 }}><span className="tag" style={{ background: SECTOR_COLOR[c.p.sector ?? ''] ?? '#6b7280' }}>{c.p.number}</span><strong>{c.p.name}</strong></p></div>
                <div><p className="muted" style={{ margin: '0 0 4px' }}>{advance ? 'Down payment' : 'Services through'}</p><p style={{ margin: 0 }}><strong>{advance ? `Billed in advance of work${from ? ` starting ${fmtDate(from)}` : ''}` : <>{from ? `${fmtDate(from)} – ` : ''}{fmtDate(to)}</>}</strong></p></div>
              </div>
              {note && <p style={{ margin: '16px 0 0' }}>{note}</p>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', marginTop: 20, border: '1px solid #d0d5dd', textAlign: 'center' }}>
                {['Invoice #', 'Terms', 'Issue date', 'Due date', 'This invoice'].map((h) => <div key={h} className="ib-th">{h}</div>)}
                <div style={{ padding: 8, fontWeight: 700 }}>{number}</div><div style={{ padding: 8 }}>{terms ? `Net ${terms}` : 'Due on receipt'}</div><div style={{ padding: 8 }}>{fmtDate(issue)}</div><div style={{ padding: 8 }}>{fmtDate(dueDate)}</div><div className="num" style={{ padding: 8, fontWeight: 700 }}>{money(total)}</div>
              </div>
              {phaseRows.length > 0 && <>
                <h2 style={{ margin: '24px 0 6px', fontSize: 16 }}>Architecture Services{advance ? ' — Down Payment' : ''}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) repeat(4, minmax(0,1fr))' }}>
                  {['Phase', 'Fee', 'Billed before', advance ? 'Billed in advance' : 'Complete', 'This invoice'].map((h, i) => <div key={h} className="ib-th" style={{ textAlign: i ? 'right' : 'left' }}>{h}</div>)}
                  {phaseRows.map((r) => [<div key={r.ph.id + 'a'} style={{ padding: '8px 10px', borderBottom: '1px solid #efefef' }}>{PHASE_NAME[r.ph.code]}</div>,
                    <div key={r.ph.id + 'b'} className="num" style={{ padding: '8px 10px', borderBottom: '1px solid #efefef', textAlign: 'right' }}>{money(r.fee)}</div>,
                    <div key={r.ph.id + 'c'} className="num" style={{ padding: '8px 10px', borderBottom: '1px solid #efefef', textAlign: 'right' }}>{money(r.prev)}</div>,
                    <div key={r.ph.id + 'd'} className="num" style={{ padding: '8px 10px', borderBottom: '1px solid #efefef', textAlign: 'right' }}>{Math.round(r.pct)}%</div>,
                    <div key={r.ph.id + 'e'} className="num" style={{ padding: '8px 10px', borderBottom: '1px solid #efefef', textAlign: 'right', fontWeight: 700 }}>{money(r.d)}</div>])}
                  <div style={{ padding: '8px 10px', gridColumn: '1 / 5', textAlign: 'right', fontWeight: 700 }}>{advance ? 'Down payment' : 'Architecture services'}</div><div className="num" style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{money(fixed)}</div>
                </div></>}
              {exSel.length > 0 && <><h2 style={{ margin: '18px 0 6px', fontSize: 16 }}>Reimbursable Expenses</h2>
                {exSel.map((x) => <div key={x.id} className="row between" style={{ padding: '6px 10px', borderBottom: '1px solid #efefef' }}><span>{x.description}</span><span className="num">{money(x.amount)}</span></div>)}
                {exMark > 0 && <div className="row between" style={{ padding: '6px 10px', borderBottom: '1px solid #efefef' }}><span>Service fee, 10% (Agreement §8.2)</span><span className="num">{money(exMark)}</span></div>}</>}
              {(items.length > 0 || (existing.data && existing.data.lines.some((l) => l.kind === 'other') && phaseRows.every((r) => r.d === 0))) && <><h2 style={{ margin: '18px 0 6px', fontSize: 16 }}>Other Items</h2>
                {items.map((x, i) => <div key={i} className="row between" style={{ padding: '6px 10px', borderBottom: '1px solid #efefef' }}><span>{x.description || ITEM_LABEL[x.kind] || 'Other'}</span><span className="num">{money(num(x.amount))}</span></div>)}</>}
              <div className="stack" style={{ margin: '18px 0 0 auto', width: 340, gap: 6 }}>
                <div className="row between" style={{ fontSize: 15 }}><strong>This invoice</strong><strong className="num">{money(total)}</strong></div>
                {opts.show_prior_balance && prior > 0 && <>
                  <div className="row between" style={{ color: '#b42318' }}><span>Unpaid: {c.pastDue.map((x) => x.number).join(', ')} (past due)</span><span className="num">{money(prior)}</span></div>
                  <div className="row between" style={{ paddingTop: 6, borderTop: '2px solid #111', fontSize: 16 }}><strong>Total now due</strong><strong className="num">{money(total + prior)}</strong></div></>}
              </div>
              <div className="row between" style={{ marginTop: 22, padding: '14px 16px', borderRadius: 8, background: '#f4f6f8' }}>
                <p style={{ margin: 0, fontSize: 13 }}>Pay online by {payWays}. Checks payable to <strong>Abaya Design Studio, LLC</strong>.</p><span className="btn" style={{ minHeight: 38 }}>Pay invoice</span></div>
              {advance && <p className="muted" style={{ margin: '12px 0 0', fontSize: 12 }}>This is a down payment billed before the work is done. It is applied to the phases above, and later invoices bill only the remaining fee for each phase.</p>}
              {opts.hold_drawings && <p className="muted" style={{ margin: '12px 0 0', fontSize: 12 }}>Drawings for this billing period are released in your portal once payment clears (Agreement §6.3).</p>}
              {opts.agreement_mode === 'link' && <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>Your signed Owner–Architect Agreement is available in your client portal.</p>}
            </article>
          ) : (
            <article aria-label="Email preview" className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'grid', gridTemplateColumns: '70px 1fr', rowGap: 4, fontSize: 13 }}>
                <span className="muted">From</span><span><strong>Abaya Design Studio</strong> &lt;billing@abayadesignstudio.com&gt;</span>
                <span className="muted">To</span><span>{toList.join(', ') || '—'}</span>
                <span className="muted">Cc</span><span>{ccList.join(', ') || '—'}</span>
                <span className="muted">Subject</span><strong>{subject}</strong>
              </div>
              <div style={{ padding: '28px 20px', background: '#f3f1ec' }}>
                <div style={{ maxWidth: 520, margin: '0 auto', background: '#fff', border: '1px solid var(--line)' }}>
                  <div style={{ background: 'var(--navy)', padding: 20, textAlign: 'center', color: '#ede6d6', fontFamily: "'EB Garamond', Georgia, serif", letterSpacing: '.2em', fontSize: 22 }}>ABAYA <span style={{ fontSize: 10 }}>DESIGN STUDIO</span></div>
                  <div style={{ padding: '24px 28px', lineHeight: 1.5 }}>
                    {message.split('\n').map((l, i) => <p key={i} style={{ margin: '0 0 8px' }}>{l}</p>)}
                    <div style={{ margin: '18px 0', padding: 16, border: '1px solid var(--line)', borderRadius: 8, textAlign: 'center' }}>
                      <p className="muted" style={{ margin: 0 }}>Invoice {number} · {c.p.name}</p>
                      <p className="num" style={{ margin: '6px 0 2px', fontSize: 30, fontWeight: 700 }}>{money(total + (opts.show_prior_balance ? prior : 0))}</p>
                      <p className="muted" style={{ margin: 0 }}>Due {fmtDate(dueDate)}</p>
                      <span className="btn" style={{ marginTop: 14 }}>View &amp; pay invoice</span>
                    </div>
                    <p className="muted" style={{ margin: 0, fontSize: 12 }}>Abaya Design Studio, LLC · 215 S Denton Tap Rd, Suite 215, Coppell, Texas 75019 · abayadesignstudio.com</p>
                  </div>
                </div>
              </div>
            </article>)}
        </div>
      </div>}
    </div>)

}

function defaultMessage(p: Project, sender?: string | null) {
  const first = (sender ?? '').split(' ')[0] || 'Abaya Design Studio'
  return `Hello,\nAttached is our invoice for ${p.name}. You can pay online by card or bank transfer from the link below.\nThank you,\n${first}`
}

function PctInput({ value, disabled, bad, label, onCommit }: { value: number; disabled: boolean; bad: boolean; label: string; onCommit: (v: string) => void }) {
  const [t, setT] = useState(String(value))
  useEffect(() => setT(String(value)), [value])
  return <label style={{ position: 'relative', display: 'block' }}><span className="sr">{label}</span>
    <input className="input num" inputMode="decimal" disabled={disabled} style={{ textAlign: 'right', paddingRight: 26, borderColor: bad ? '#d92d20' : undefined }} value={t}
      onChange={(e) => setT(e.target.value)} onBlur={() => onCommit(t)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    <span aria-hidden="true" className="muted" style={{ position: 'absolute', right: 10, top: 12 }}>%</span></label>
}

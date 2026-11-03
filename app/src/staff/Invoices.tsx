import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, money, SECTOR_COLOR } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { type InvoiceRow, type InvEvent, displayStatus, activityOf, fmtDate, todayIso, daysBetween, eventLabel, EVENT_STYLE, num } from '../lib/invoices'
import './invoices.css'

type Recipient = { invoice_id: string; email: string; kind: string }
const FILTERS: [string, string][] = [['all', 'All'], ['unpaid', 'Unpaid'], ['past', 'Past due'], ['paid', 'Paid'], ['uncollectible', 'Uncollectible'], ['draft', 'Drafts']]

export default function Invoices() {
  const nav = useNavigate()
  const { profile } = useAuth()
  const [f, setF] = useState('all')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const data = useLoad(async () => {
    const inv = must(await supabase.from('invoice_summary').select('id, number, project_id, client_id, status, issue_date, due_date, paid_at, total, amount_paid, payment_method, project_number, project_name, sector, client_name, best_activity, days_past_due')
      .order('issue_date', { ascending: false, nullsFirst: true })) as unknown as InvoiceRow[]
    const ev = must(await supabase.from('invoice_events').select('id, invoice_id, kind, recipient, detail, at').order('at')) as InvEvent[]
    const rc = must(await supabase.from('invoice_recipients').select('invoice_id, email, kind')) as Recipient[]
    return { inv, ev, rc }
  })
  const evBy = useMemo(() => {
    const m: Record<string, InvEvent[]> = {}
    ;(data.data?.ev ?? []).forEach((e) => { (m[e.invoice_id] ??= []).push(e) })
    return m
  }, [data.data])

  const inRange = (i: InvoiceRow) => (!from || (i.issue_date ?? '') >= from) && (!to || (i.issue_date ?? '9999') <= to)
  const all = (data.data?.inv ?? []).filter(inRange)
  const sum = (pred: (i: InvoiceRow) => boolean, val: (i: InvoiceRow) => number = (i) => Number(i.total)) => all.filter(pred).reduce((a, i) => a + val(i), 0)
  const st = (i: InvoiceRow) => displayStatus(i).key
  const stats: [string, number, string][] = [
    ['Total billed', sum((i) => i.status !== 'draft' && i.status !== 'void'), 'var(--text)'],
    ['Paid', sum(() => true, (i) => (i.status === 'void' ? 0 : Number(i.amount_paid))), '#067647'],
    ['Open', sum((i) => ['open', 'due'].includes(st(i)), (i) => Number(i.total) - Number(i.amount_paid)), 'var(--text)'],
    ['Past due', sum((i) => st(i) === 'past', (i) => Number(i.total) - Number(i.amount_paid)), '#b42318'],
    ['Uncollectible', sum((i) => i.status === 'uncollectible', (i) => Number(i.total) - Number(i.amount_paid)), '#5f6368'],
  ]
  const match = (i: InvoiceRow) => {
    const k = st(i)
    const ok = f === 'all' ? true
      : f === 'unpaid' ? ['open', 'due', 'past'].includes(k)
      : f === 'past' ? k === 'past'
      : f === 'paid' ? k === 'paid'
      : f === 'uncollectible' ? k === 'uncollectible'
      : k === 'draft'
    const s = q.trim().toLowerCase()
    return ok && (!s || `${i.number} ${i.project_number} ${i.project_name} ${i.client_name ?? ''}`.toLowerCase().includes(s))
  }
  const rows = all.filter(match)
  const count = (key: string) => all.filter((i) => { const k = st(i); return key === 'all' ? true : key === 'unpaid' ? ['open', 'due', 'past'].includes(k) : key === 'draft' ? k === 'draft' : k === key }).length
  const selected = (data.data?.inv ?? []).find((i) => i.id === sel) ?? null

  return (
    <div className="stack">
      <div className="row between"><h1>Invoices</h1><Link className="btn" to="/invoices/new">+ New invoice</Link></div>
      {data.error && <p className="err">{data.error}</p>}
      <dl className="card iv-stats">
        {stats.map(([l, v, c]) => <div key={l}><dt className="muted" style={{ fontSize: 14 }}>{l}</dt><dd className="num" style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 700, color: c }}>{money(v)}</dd></div>)}
      </dl>
      <div className="row between">
        <div className="row" role="group" aria-label="Status">
          {FILTERS.map(([id, l]) => <button key={id} className={'btn small' + (f === id ? '' : ' secondary')} aria-pressed={f === id} onClick={() => setF(id)}>{l} ({count(id)})</button>)}
        </div>
        <div className="row">
          <label className="sr" htmlFor="iv-from">Issued from</label><input id="iv-from" type="date" className="input" style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} title="Issued from" />
          <span className="muted">to</span>
          <label className="sr" htmlFor="iv-to">Issued to</label><input id="iv-to" type="date" className="input" style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} title="Issued to" />
          <label className="sr" htmlFor="iv-q">Search invoices</label><input id="iv-q" className="input" style={{ width: 260 }} placeholder="Search number, project or client" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="iv-wrap">
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1050 }}>
            <div className="iv-row iv-head" role="row"><span>Invoice</span><span>Project</span><span>Client</span><span style={{ textAlign: 'right' }}>Amount</span><span>Issued</span><span>Status</span><span>Client activity</span><span>Due / paid</span></div>
            {rows.map((i) => {
              const s = displayStatus(i); const a = activityOf(i, evBy[i.id] ?? [])
              const t = todayIso()
              const due = s.key === 'paid' ? `Paid ${fmtDate(i.paid_at)}` : s.key === 'past' && i.due_date ? `${daysBetween(i.due_date, t)} days past due` : s.key === 'uncollectible' ? '—' : fmtDate(i.due_date)
              return (
                <button key={i.id} className="iv-row" aria-pressed={sel === i.id} onClick={() => setSel(i.id)}>
                  <strong style={{ color: 'var(--navy)' }}>{i.number}</strong>
                  <span className="row" style={{ gap: 8, flexWrap: 'nowrap', minWidth: 0 }}><span className="tag" style={{ background: SECTOR_COLOR[i.sector ?? ''] ?? '#6b7280' }}>{i.project_number}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.project_name}</span></span>
                  <span>{i.client_name ?? '—'}</span>
                  <span className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{money(i.total)}</span>
                  <span className="num">{fmtDate(i.issue_date)}</span>
                  <span style={{ fontWeight: 700, color: s.color }}>{s.label}</span>
                  <span style={{ fontWeight: 700, color: a.color }}>{a.label}</span>
                  <span style={{ color: s.key === 'past' ? '#b42318' : 'var(--muted)' }}>{due}</span>
                </button>)
            })}
            {data.data && rows.length === 0 && <p className="muted" style={{ padding: 24, textAlign: 'center' }}><em>No invoices match.</em></p>}
          </div>
        </div>
        {selected && <Panel inv={selected} events={evBy[selected.id] ?? []} recipients={(data.data?.rc ?? []).filter((r) => r.invoice_id === selected.id)}
          me={profile!.id} onClose={() => setSel(null)} onOpen={() => nav(`/invoices/${selected.id}`)} onChanged={data.reload} />}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}><em>Invoices imported from Monograph show the last activity Monograph recorded. New invoices record delivery, opens and views here once sending is connected.</em></p>
    </div>
  )
}

function Panel({ inv, events, recipients, me, onClose, onOpen, onChanged }: { inv: InvoiceRow; events: InvEvent[]; recipients: Recipient[]; me: string; onClose: () => void; onOpen: () => void; onChanged: () => void }) {
  const s = displayStatus(inv)
  const [note, setNote] = useState('')
  const [paying, setPaying] = useState(false)
  const balance = Number(inv.total) - Number(inv.amount_paid)
  const [pay, setPay] = useState({ amount: String(balance.toFixed(2)), date: todayIso(), method: 'Paper Check' })
  const [err, setErr] = useState('')
  const addNote = async () => {
    if (!note.trim()) return
    const { error } = await supabase.from('invoice_events').insert({ invoice_id: inv.id, kind: 'note', detail: note.trim(), actor: me })
    if (error) return setErr(error.message)
    setNote(''); onChanged()
  }
  const record = async () => {
    const amt = num(pay.amount)
    if (amt <= 0) return setErr('Enter the amount received.')
    const paidTotal = Number(inv.amount_paid) + amt
    const full = paidTotal >= Number(inv.total) - 0.005
    const { error } = await supabase.from('invoices').update({ amount_paid: paidTotal, status: full ? 'paid' : inv.status, paid_at: full ? pay.date : null, payment_method: pay.method }).eq('id', inv.id)
    if (error) return setErr(error.message)
    await supabase.from('invoice_events').insert({ invoice_id: inv.id, kind: 'paid', detail: `${full ? 'Paid in full' : 'Partial payment'}: ${money(amt)} by ${pay.method} on ${fmtDate(pay.date)}`, actor: me })
    setPaying(false); setErr(''); onChanged()
  }
  const byRecipient = (email: string) => {
    const evs = events.filter((e) => e.recipient === email)
    if (evs.some((e) => e.kind === 'viewed')) return ['Viewed invoice', '#067647', '#e7f6ec']
    if (evs.some((e) => e.kind === 'opened')) return ['Opened, not viewed', '#b54708', '#fdf1dc']
    if (evs.some((e) => e.kind === 'bounced')) return ['Bounced', '#b42318', '#fdecea']
    return ['Not opened', '#b42318', '#fdecea']
  }
  return (
    <aside className="card pad stack iv-panel" aria-label="Invoice activity">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div><div className="row" style={{ gap: 8 }}><span className="tag" style={{ background: SECTOR_COLOR[inv.sector ?? ''] ?? '#6b7280' }}>{inv.project_number}</span><strong style={{ fontSize: 17 }}>{inv.number}</strong></div>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>{inv.project_name} · {inv.client_name}</p></div>
        <button className="linkbtn" aria-label="Close" style={{ fontSize: 20, color: 'var(--muted)' }} onClick={onClose}>×</button>
      </div>
      <div className="row between"><span className="num" style={{ fontSize: 24, fontWeight: 700 }}>{money(inv.total)}</span><span style={{ fontWeight: 700, color: s.color }}>{s.label}</span></div>
      {Number(inv.amount_paid) > 0 && balance > 0.005 && <p style={{ margin: 0, fontSize: 14 }}>Paid so far {money(inv.amount_paid)} · <strong>{money(balance)} left</strong></p>}
      <div><h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', marginBottom: 8 }}>Recipients</h2>
        {recipients.length === 0 ? <p className="muted" style={{ margin: 0, fontSize: 14 }}>{events.some((e) => e.detail?.startsWith('Imported')) ? 'Sent from Monograph — recipients weren’t in the export.' : 'None yet.'}</p>
          : <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>{recipients.map((r) => { const [l, c, bg] = byRecipient(r.email); return (
            <li key={r.email + r.kind} style={{ padding: '10px 12px', borderRadius: 8, background: bg }}><div className="row between" style={{ fontSize: 14 }}><strong style={{ wordBreak: 'break-all' }}>{r.email}{r.kind === 'cc' && <span className="muted"> (cc)</span>}</strong><span style={{ fontWeight: 700, color: c }}>{l}</span></div></li>) })}</ul>}
      </div>
      <div className="row">
        {['open', 'uncollectible'].includes(inv.status) && <button className="btn small secondary" onClick={() => setPaying(!paying)}>Record payment</button>}
        <button className="btn small secondary" onClick={onOpen}>{inv.status === 'draft' ? 'Edit draft' : 'Open invoice'}</button>
      </div>
      {paying && <div className="stack" style={{ padding: 12, borderRadius: 8, background: '#f6f5f2', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label className="l" htmlFor="rp-a">Amount</label><input id="rp-a" className="input num" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
          <div><label className="l" htmlFor="rp-d">Received</label><input id="rp-d" type="date" className="input" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></div>
        </div>
        <div><label className="l" htmlFor="rp-m">Method</label><select id="rp-m" className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{['Paper Check', 'ACH', 'Bank Transfer', 'Credit card', 'Cash', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></div>
        <button className="btn small" onClick={record}>Save payment</button>
      </div>}
      <div><h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', marginBottom: 8 }}>Activity</h2>
        <ol className="iv-tl">{events.slice().reverse().map((e) => { const [c, ic] = EVENT_STYLE[e.kind] ?? ['#98a2b3', '•']; return (
          <li key={e.id}><span aria-hidden="true" className="dot" style={{ borderColor: c, color: c }}>{ic}</span><p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{eventLabel(e)}</p>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>{new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{e.recipient ? ` · ${e.recipient}` : ''}</p></li>) })}
          {events.length === 0 && <li className="muted" style={{ fontSize: 14 }}>No activity yet.</li>}</ol>
      </div>
      <div className="row" style={{ flexWrap: 'nowrap' }}><label className="sr" htmlFor="iv-note">Internal note</label><input id="iv-note" className="input" placeholder="Internal note (staff only)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNote() }} /><button className="btn small secondary" onClick={addNote}>Add</button></div>
      {err && <p className="err" role="alert">{err}</p>}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}><em>“Viewed invoice” is recorded when they open the invoice link — reliable. “Opened email” comes from a tracking image: Apple Mail can trigger it on its own and some inboxes block it, so treat it as a hint.</em></p>
    </aside>)
}

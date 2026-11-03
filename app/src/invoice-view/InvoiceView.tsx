// Public, no-login invoice page. The link in the invoice email carries ?t=<view token>&r=<recipient token>.
// Data comes from the invoice-public function, which only returns the invoice for that token and logs the view.
import { useEffect, useState } from 'react'

type Line = { kind: string; description: string; pct_to_date: number | null; amount: number }
type PublicInvoice = {
  number: string; status: string; issue_date: string | null; due_date: string | null; terms_days: number
  period_start: string | null; period_end: string | null; total: number; amount_paid: number; note: string | null
  allow_card: boolean; allow_ach: boolean; project: { number: string; name: string; sector: string | null }; client: string | null; lines: Line[]
}

const SECTOR_COLOR: Record<string, string> = { commercial: '#2b5c8a', residential: '#a32d2d', medical: '#2e7d4f', consultation: '#6b7280', civic: '#5b4b8a', internal: '#02253d' }
const KIND_HEAD: Record<string, string> = { phase: 'Architecture Services', expense: 'Reimbursable Expenses', markup: 'Reimbursable Expenses' }
const money = (n: number) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmt = (iso: string | null) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function InvoiceView() {
  const [inv, setInv] = useState<PublicInvoice | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const t = q.get('t') ?? '', r = q.get('r') ?? ''
    if (!t) { setErr('This invoice link is incomplete. Please use the link in your email.'); return }
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invoice-public?token=${encodeURIComponent(t)}${r ? `&r=${encodeURIComponent(r)}` : ''}`
    fetch(url, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string } })
      .then(async (res) => {
        if (res.status === 404) throw new Error('We couldn’t find this invoice. It may have been withdrawn — please contact us.')
        if (!res.ok) throw new Error('The invoice couldn’t be loaded right now. Please try again in a moment.')
        setInv(await res.json())
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(() => { if (inv) document.title = `Invoice ${inv.number} — Abaya Design Studio` }, [inv])

  const header = (
    <header className="iv-top">
      <a href="../" className="iv-brand" aria-label="Abaya Design Studio — home"><span className="w">ABAYA</span><span className="s">DESIGN STUDIO</span></a>
    </header>)

  if (err) return <>{header}<main className="iv-main"><div className="iv-card iv-msg" role="alert"><h1>Invoice unavailable</h1><p>{err}</p><p>billing@abayadesignstudio.com</p></div></main></>
  if (!inv) return <>{header}<main className="iv-main"><div className="iv-card iv-msg" aria-busy="true"><p>Loading your invoice…</p></div></main></>

  const balance = Math.max(0, inv.total - inv.amount_paid)
  const paid = inv.status === 'paid' || balance < 0.005
  const today = new Date(); const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const late = !paid && inv.due_date && inv.due_date < todayIso
  const groups: [string, Line[]][] = []
  for (const l of inv.lines) {
    const h = KIND_HEAD[l.kind] ?? 'Other Items'
    const g = groups.find(([k]) => k === h)
    if (g) g[1].push(l); else groups.push([h, [l]])
  }
  const ways = [inv.allow_ach && 'bank transfer (ACH)', inv.allow_card && 'card'].filter(Boolean).join(' or ')

  return <>
    {header}
    <main className="iv-main">
      <section className="iv-pay iv-card" aria-label="Amount due">
        <p className="iv-muted">Invoice {inv.number} · {inv.project.name}</p>
        <p className="iv-amt">{paid ? 'Paid' : money(balance)}</p>
        <p className={late ? 'iv-late' : 'iv-muted'}>{paid ? 'Thank you — this invoice is paid in full.' : inv.due_date ? `${late ? 'Was due' : 'Due'} ${fmt(inv.due_date)}` : 'Due on receipt'}</p>
        {!paid && <>
          <button className="iv-btn" disabled aria-describedby="pay-soon">Pay online</button>
          <p id="pay-soon" className="iv-muted iv-small">Online payment{ways ? ` by ${ways}` : ''} is coming soon. For now, please pay by check payable to <strong>Abaya Design Studio, LLC</strong>, or reply to the invoice email for bank-transfer details.</p>
        </>}
      </section>

      <article className="iv-card iv-doc" aria-label={`Invoice ${inv.number}`}>
        <div className="iv-head">
          <div className="iv-mark" aria-hidden="true"><span>ABAYA</span><small>DESIGN STUDIO</small></div>
          <div><p className="iv-muted iv-lab">Bill from</p><p><strong>Abaya Design Studio, LLC</strong><br />215 S Denton Tap Rd, Suite 215<br />Coppell, Texas 75019<br />billing@abayadesignstudio.com</p></div>
          <div><p className="iv-muted iv-lab">Bill to</p><p><strong>{inv.client ?? '—'}</strong></p></div>
        </div>
        <div className="iv-two">
          <div><p className="iv-muted iv-lab">Project</p><p className="iv-proj"><span className="iv-tag" style={{ background: SECTOR_COLOR[inv.project.sector ?? ''] ?? '#6b7280' }}>{inv.project.number}</span><strong>{inv.project.name}</strong></p></div>
          <div><p className="iv-muted iv-lab">Services through</p><p><strong>{inv.period_start ? `${fmt(inv.period_start)} – ` : ''}{fmt(inv.period_end)}</strong></p></div>
        </div>
        {inv.note && <p>{inv.note}</p>}
        <dl className="iv-facts">
          <div><dt>Invoice #</dt><dd><strong>{inv.number}</strong></dd></div>
          <div><dt>Terms</dt><dd>{inv.terms_days ? `Net ${inv.terms_days}` : 'Due on receipt'}</dd></div>
          <div><dt>Issue date</dt><dd>{fmt(inv.issue_date)}</dd></div>
          <div><dt>Due date</dt><dd>{fmt(inv.due_date)}</dd></div>
          <div><dt>This invoice</dt><dd><strong>{money(inv.total)}</strong></dd></div>
        </dl>
        {groups.map(([h, ls]) => <section key={h}>
          <h2>{h}</h2>
          <table className="iv-lines">
            <thead><tr><th scope="col">Description</th>{h === 'Architecture Services' && <th scope="col" className="r">Complete</th>}<th scope="col" className="r">Amount</th></tr></thead>
            <tbody>{ls.map((l, i) => <tr key={i}><td>{l.description}</td>{h === 'Architecture Services' && <td className="r">{l.pct_to_date === null ? '' : `${Math.round(l.pct_to_date)}%`}</td>}<td className="r">{money(l.amount)}</td></tr>)}</tbody>
          </table>
        </section>)}
        <div className="iv-tot">
          <div><span>This invoice</span><strong>{money(inv.total)}</strong></div>
          {inv.amount_paid > 0 && <div><span>Paid</span><span>−{money(inv.amount_paid)}</span></div>}
          <div className="iv-due"><strong>Balance due</strong><strong>{money(balance)}</strong></div>
        </div>
        <p className="iv-muted iv-small">Your signed agreement and drawings are in your client portal.</p>
      </article>
      <div className="iv-actions"><button className="iv-btn secondary" onClick={() => window.print()}>Print or save as PDF</button><a className="iv-btn secondary" href="../portal/">Client portal</a></div>
    </main>
    <footer className="iv-foot">Abaya Design Studio, LLC · 215 S Denton Tap Rd, Suite 215, Coppell, Texas 75019 · abayadesignstudio.com</footer>
  </>
}

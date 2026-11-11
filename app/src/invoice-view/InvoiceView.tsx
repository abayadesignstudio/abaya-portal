// Public, no-login invoice page. The link in the invoice email carries ?t=<view token>&r=<recipient token>.
// Data comes from the invoice-public function, which only returns the invoice for that token and logs the view.
import { useEffect, useState } from 'react'
import QrCode from '../components/QrCode'
import logoLight from '../assets/abaya-logo-light.png'
import logoSquare from '../assets/abaya-logo-square.png'

type Line = { kind: string; description: string; pct_to_date: number | null; amount: number }
type PublicInvoice = {
  number: string; status: string; issue_date: string | null; due_date: string | null; terms_days: number
  sample?: boolean; period_start: string | null; period_end: string | null; total: number; amount_paid: number; note: string | null
  allow_card: boolean; allow_ach: boolean; pass_card_fee?: boolean; pass_ach_fee?: boolean; pay_online?: boolean; advance?: boolean; card_limited?: boolean;
  wire?: { bank_name: string | null; bank_address: string | null; account_name: string | null; routing: string; account: string; swift: string | null; notes: string | null; phone: string | null } | null; zelle?: { name: string | null; email: string | null; phone: string | null; qr: string | null } | null
  project: { number: string; name: string; sector: string | null }; client: string | null; lines: Line[]
}

const SECTOR_COLOR: Record<string, string> = { commercial: '#2b5c8a', residential: '#a32d2d', medical: '#2e7d4f', consultation: '#6b7280', civic: '#5b4b8a', internal: '#02253d' }
const KIND_HEAD: Record<string, string> = { phase: 'Architecture Services', hourly: 'Hourly Services', expense: 'Reimbursable Expenses', markup: 'Reimbursable Expenses' }
const round2 = (n: number) => Math.round(n * 100) / 100
// same estimates as the portal's invoice builder and the payment function
const cardFee = (t: number) => round2(t * 0.029 + 0.3)
const achFee = (t: number) => round2(Math.min(t * 0.008, 5))
const money = (n: number) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmt = (iso: string | null) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function InvoiceView() {
  const [inv, setInv] = useState<PublicInvoice | null>(null)
  const [err, setErr] = useState('')
  const [paying, setPaying] = useState<'' | 'card' | 'ach'>('')
  const [payErr, setPayErr] = useState('')
  const [panel, setPanel] = useState<'' | 'wire' | 'zelle'>('')
  const toggle = (p: 'wire' | 'zelle') => setPanel(panel === p ? '' : p)
  const returned = new URLSearchParams(location.search).get('paid') // back from Stripe: 'card' | 'ach'
  const pay = async (method: 'card' | 'ach') => {
    const q = new URLSearchParams(location.search)
    if (inv?.sample) { setPayErr('This is a sample invoice, so payment is turned off. On a real invoice this button opens Stripe’s secure checkout.'); return }
    setPaying(method); setPayErr('')
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invoice-pay`, {
        method: 'POST', headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: q.get('t'), r: q.get('r') || undefined, method }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.url) throw new Error(j.error || 'Online payment couldn’t start. Please try again.')
      location.href = j.url
    } catch (e) { setPaying(''); setPayErr(e instanceof Error ? e.message : String(e)) }
  }
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
      <a href="../" className="iv-brand" aria-label="Abaya Design Studio — home"><img src={logoLight} alt="Abaya Design Studio" /></a>
    </header>)

  if (err) return <>{header}<main className="iv-main"><div className="iv-card iv-msg" role="alert"><h1>Invoice unavailable</h1><p>{err}</p><p>billing@abayadesignstudio.com</p></div></main></>
  if (!inv) return <>{header}<main className="iv-main"><div className="iv-card iv-msg" aria-busy="true"><p>Loading your invoice…</p></div></main></>

  const balance = Math.max(0, inv.total - inv.amount_paid)
  const paid = inv.status === 'paid' || balance < 0.005
  const today = new Date(); const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const late = !paid && inv.due_date && inv.due_date < todayIso
  const groups: [string, Line[]][] = []
  for (const l of inv.lines) {
    const h = (l.kind === 'phase' || l.kind === 'hourly') && /^AS · /.test(l.description) ? 'Additional Services' : KIND_HEAD[l.kind] ?? 'Other Items'
    const g = groups.find(([k]) => k === h)
    if (g) g[1].push(l); else groups.push([h, [l]])
  }
  const online = !!inv.pay_online && (inv.allow_ach || inv.allow_card)
  const ways = [inv.allow_ach && 'bank (ACH)', inv.allow_card && 'card'].filter(Boolean).join(' or ')

  return <>
    {header}
    <main className="iv-main">
      {inv.sample && <p className="iv-sample" role="note"><strong>Sample invoice.</strong> This is what clients see. The client and amounts are made up, and card and bank payment are turned off.</p>}
      <section className="iv-pay iv-card" aria-label="Amount due">
        <p className="iv-muted">Invoice {inv.number} · {inv.project.name}</p>
        <p className="iv-amt">{paid ? 'Paid' : money(balance)}</p>
        <p className={late ? 'iv-late' : 'iv-muted'}>{paid ? 'Thank you — this invoice is paid in full.' : inv.due_date ? `${late ? 'Was due' : 'Due'} ${fmt(inv.due_date)}` : 'Due on receipt'}</p>
        {returned && !paid && <p className="iv-thanks" role="status">{returned === 'ach'
          ? 'Thank you! Your bank (ACH) payment is on its way. It usually takes about 4 business days to clear; we’ll mark the invoice paid when it does.'
          : 'Thank you! Your payment went through. It can take a minute to show here.'}</p>}
        {!paid && !returned && (online || inv.wire || inv.zelle ? <>
          <div className="iv-paybtns">
            {online && inv.allow_ach && <button className="iv-btn" onClick={() => pay('ach')} disabled={!!paying}>{paying === 'ach' ? 'Opening…' : 'Pay by bank (ACH)'}</button>}
            {inv.zelle && <button className={'iv-btn' + (online && inv.allow_ach ? ' secondary' : '')} aria-expanded={panel === 'zelle'} onClick={() => toggle('zelle')}>Pay with Zelle</button>}
            {inv.wire && <button className="iv-btn secondary" aria-expanded={panel === 'wire'} onClick={() => toggle('wire')}>Pay by wire</button>}
            {online && inv.allow_card && <button className={'iv-btn' + (inv.allow_ach || inv.wire || inv.zelle ? ' secondary' : '')} onClick={() => pay('card')} disabled={!!paying}>{paying === 'card' ? 'Opening…' : 'Pay by card'}</button>}
          </div>
          {panel === 'zelle' && inv.zelle && <Zelle z={inv.zelle} number={inv.number} amount={balance} />}
          {panel === 'wire' && inv.wire && <Wire w={inv.wire} number={inv.number} amount={balance} />}
          <p className="iv-muted iv-small">
            {online && inv.allow_ach && <>Bank (ACH){inv.pass_ach_fee ? ` adds a ${money(achFee(balance))} processing fee` : ' has no added fee'}. </>}
            {inv.zelle && <>Zelle has no fee. </>}
            {online && inv.allow_card && <>Card{inv.pass_card_fee ? ` adds a ${money(cardFee(balance))} processing fee` : ' has no added fee'}. </>}
            {online && inv.card_limited && <>Card payment isn’t available for an invoice of this size. </>}
            {online && <>Bank and card payments are processed securely by Stripe. </>}You can also pay by check payable to <strong>Abaya Design Studio, LLC</strong>.
          </p>
          {payErr && <p className="iv-late" role="alert">{payErr}</p>}
        </> : <>
          <button className="iv-btn" disabled aria-describedby="pay-soon">Pay online</button>
          <p id="pay-soon" className="iv-muted iv-small">Online payment{ways ? ` by ${ways}` : ''} is coming soon. For now, please pay by check payable to <strong>Abaya Design Studio, LLC</strong>, or reply to the invoice email for bank-transfer details.</p>
        </>)}
      </section>

      <article className="iv-card iv-doc" aria-label={`Invoice ${inv.number}`}>
        <div className="iv-head">
          <img className="iv-mark" src={logoSquare} alt="Abaya Design Studio" />
          <div><p className="iv-muted iv-lab">Bill from</p><p><strong>Abaya Design Studio, LLC</strong><br />215 S Denton Tap Rd, Suite 215<br />Coppell, Texas 75019<br />billing@abayadesignstudio.com</p></div>
          <div><p className="iv-muted iv-lab">Bill to</p><p><strong>{inv.client ?? '—'}</strong></p></div>
        </div>
        <div className="iv-two">
          <div><p className="iv-muted iv-lab">Project</p><p className="iv-proj"><span className="iv-tag" style={{ background: SECTOR_COLOR[inv.project.sector ?? ''] ?? '#6b7280' }}>{inv.project.number}</span><strong>{inv.project.name}</strong></p></div>
          <div><p className="iv-muted iv-lab">{inv.advance ? 'Down payment' : 'Services through'}</p><p><strong>{inv.advance ? `Billed in advance of work${inv.period_start ? ` starting ${fmt(inv.period_start)}` : ''}` : <>{inv.period_start ? `${fmt(inv.period_start)} – ` : ''}{fmt(inv.period_end)}</>}</strong></p></div>
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
          <h2>{h}{inv.advance && h === 'Architecture Services' ? ' — Down Payment' : ''}</h2>
          <table className="iv-lines">
            <thead><tr><th scope="col">Description</th>{(h === 'Architecture Services' || h === 'Additional Services') && <th scope="col" className="r">{inv.advance ? 'Billed in advance' : 'Complete'}</th>}<th scope="col" className="r">Amount</th></tr></thead>
            <tbody>{ls.map((l, i) => <tr key={i}><td>{l.description}</td>{(h === 'Architecture Services' || h === 'Additional Services') && <td className="r">{l.pct_to_date === null ? '' : `${Math.round(l.pct_to_date)}%`}</td>}<td className="r">{money(l.amount)}</td></tr>)}</tbody>
          </table>
        </section>)}
        <div className="iv-tot">
          <div><span>This invoice</span><strong>{money(inv.total)}</strong></div>
          {inv.amount_paid > 0 && <div><span>Paid</span><span>−{money(inv.amount_paid)}</span></div>}
          <div className="iv-due"><strong>Balance due</strong><strong>{money(balance)}</strong></div>
        </div>
        {inv.advance && <p className="iv-muted iv-small">This is a down payment billed before the work is done. It is applied to the phases above, and later invoices bill only the remaining fee for each phase.</p>}
        <p className="iv-muted iv-small">Your signed agreement and drawings are in your client portal.</p>
      </article>
      <div className="iv-actions"><button className="iv-btn secondary" onClick={() => window.print()}>Print or save as PDF</button><a className="iv-btn secondary" href="../portal/">Client portal</a></div>
    </main>
    <footer className="iv-foot">Abaya Design Studio, LLC · 215 S Denton Tap Rd, Suite 215, Coppell, Texas 75019 · abayadesignstudio.com</footer>
  </>
}

// Zelle: who to send to, with copy buttons, and the bank's QR (hidden on phones, where it can't be scanned).
type Z = NonNullable<PublicInvoice['zelle']>
function Zelle({ z, number, amount }: { z: Z; number: string; amount: number }) {
  const [copied, setCopied] = useState('')
  const copy = (k: string, v: string) => { navigator.clipboard?.writeText(v).then(() => { setCopied(k); setTimeout(() => setCopied(''), 1500) }).catch(() => {}) }
  const rows: [string, string | null, string?][] = [['Send to', z.name], ['Email', z.email], ['Phone', z.phone], ['Amount', money(amount), amount.toFixed(2)], ['Memo', `Invoice ${number}`]]
  return <div className="iv-wire iv-zelle" role="region" aria-label="Pay with Zelle">
    <h2>Pay with Zelle</h2>
    <div className="iv-zelle-body">
      {z.qr && <figure className="iv-zelle-qr"><QrCode value={z.qr} label="Zelle QR code" /><figcaption>Scan in your banking app</figcaption></figure>}
      <dl>{rows.filter(([, v]) => v).map(([k, v, raw]) => <div key={k}><dt>{k}</dt><dd><span className="num">{v}</span>
        {k !== 'Send to' && <button type="button" className="iv-copy" onClick={() => copy(k, raw ?? v!)} aria-label={`Copy ${k}`}>{copied === k ? 'Copied' : 'Copy'}</button>}</dd></div>)}</dl>
    </div>
    <p className="iv-small">Open your bank’s app, choose Zelle, and send to the email or phone above. Check that the name shown is <strong>{z.name ?? 'Abaya Design & Studio LLC'}</strong> before you send — Zelle payments can’t be reversed.</p>
    <p className="iv-muted iv-small">Zelle usually arrives within minutes. Banks set daily Zelle limits; for a larger amount, use bank transfer or wire. We’ll mark the invoice paid once it reaches our account.</p>
  </div>
}

// Wire instructions with copy buttons. Shown only on this page; the reference ties the wire to the invoice.
type W = NonNullable<PublicInvoice['wire']>
function Wire({ w, number, amount }: { w: W; number: string; amount: number }) {
  const [copied, setCopied] = useState('')
  const copy = (k: string, v: string) => { navigator.clipboard?.writeText(v).then(() => { setCopied(k); setTimeout(() => setCopied(''), 1500) }).catch(() => {}) }
  const rows: [string, string | null][] = [['Amount', money(amount)], ['Beneficiary', w.account_name], ['Bank', w.bank_name], ['Bank address', w.bank_address],
    ['Routing number (ABA)', w.routing], ['Account number', w.account], ['SWIFT (international)', w.swift], ['Reference / memo', `Invoice ${number}`]]
  return <div className="iv-wire" role="region" aria-label="Wire transfer instructions">
    <h2>Wire transfer instructions</h2>
    <dl>{rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd><span className="num">{v}</span>
      {k !== 'Bank address' && <button type="button" className="iv-copy" onClick={() => copy(k, k === 'Amount' ? amount.toFixed(2) : v!)} aria-label={`Copy ${k}`}>{copied === k ? 'Copied' : 'Copy'}</button>}</dd></div>)}</dl>
    {w.notes && <p className="iv-small">{w.notes}</p>}
    <p className="iv-wire-warn"><strong>Protect yourself from wire fraud.</strong> Our wire instructions never change by email. If you receive different instructions, don’t send money — {w.phone ? <>call us at <a href={`tel:${w.phone.replace(/[^\d+]/g, '')}`}>{w.phone}</a></> : 'call our office'} to confirm before wiring.</p>
    <p className="iv-muted iv-small">Wires usually arrive the same business day. We’ll mark the invoice paid once it reaches our account.</p>
  </div>
}

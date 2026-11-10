import { supabase, money, SECTOR_COLOR } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { fmtDate } from '../lib/projectContent'
import { usePreviewNav } from './preview'

type I = { id: string; number: string; status: string; issue_date: string | null; due_date: string | null; total: number; amount_paid: number; projects: { number: string; name: string; sector: string | null } | null }
const ST: Record<string, [string, string]> = { open: ['Open', 'var(--amber)'], paid: ['Paid', 'var(--green)'], void: ['Void', 'var(--muted)'], uncollectible: ['Closed', 'var(--muted)'] }

export default function ClientInvoices() {
  const pv = usePreviewNav()
  const cid = pv?.clientId ?? null
  const { data, error } = useLoad(async () => {
    let q = supabase.from('invoices').select('id, number, status, issue_date, due_date, total, amount_paid, projects(number, name, sector)').order('issue_date', { ascending: false })
    // the preview shows what this client sees: their invoices, never drafts
    if (pv) q = q.eq('client_id', cid ?? '00000000-0000-0000-0000-000000000000').neq('status', 'draft')
    return must(await q) as unknown as I[]
  }, [cid])
  const today = new Date().toISOString().slice(0, 10)
  const open = (data ?? []).filter((i) => i.status === 'open')
  const owed = open.reduce((a, i) => a + Number(i.total) - Number(i.amount_paid), 0)
  return (
    <div className="stack">
      <h1>Invoices</h1>
      {error && <p className="err">{error}</p>}
      <section className="card pad row between">
        <div><div className="muted">Balance due</div><div className="num" style={{ fontSize: 28, fontWeight: 700, color: owed ? 'var(--red)' : 'var(--text)' }}>{money(owed)}</div></div>
        <p className="muted" style={{ margin: 0, maxWidth: 420, fontSize: 14 }}><strong>Pay online — coming soon.</strong> Card and bank transfer (ACH) payments open here this month. Until then, use the payment link in your invoice email or pay by check to Abaya Design Studio, LLC.</p>
      </section>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 760 }}>
          <thead><tr><th>Invoice</th><th>Project</th><th>Issued</th><th>Due</th><th className="r">Amount</th><th className="r">Balance</th><th>Status</th></tr></thead>
          <tbody>
            {data?.map((i) => { const bal = Number(i.total) - Number(i.amount_paid); const late = i.status === 'open' && i.due_date && i.due_date < today
              const [label, color] = late ? ['Past due', 'var(--red)'] : ST[i.status] ?? [i.status, 'var(--muted)']
              return <tr key={i.id}><td><strong>{i.number}</strong></td>
                <td><span className="row" style={{ gap: 8 }}>{i.projects && <span className="tag" style={{ background: SECTOR_COLOR[i.projects.sector ?? 'internal'] }}>{i.projects.number}</span>}{i.projects?.name}</span></td>
                <td>{fmtDate(i.issue_date)}</td><td>{fmtDate(i.due_date)}</td><td className="r num">{money(i.total)}</td><td className="r num">{money(i.status === 'open' ? bal : 0)}</td>
                <td><strong style={{ color }}>{label}</strong></td></tr> })}
            {data?.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}><em>No invoices yet.</em></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

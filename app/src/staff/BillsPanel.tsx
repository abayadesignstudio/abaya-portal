import { Link } from 'react-router-dom'
import { supabase, money } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { COLOR, statusOf, type Bill } from './Bills'
import './admin.css'

// Home (admins): this month's bills as a donut by category, then unpaid bills by due date (overdue first, next 30 days).
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const short = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }

export default function BillsPanel() {
  const now = new Date()
  const m0 = iso(new Date(now.getFullYear(), now.getMonth(), 1)), m1 = iso(new Date(now.getFullYear(), now.getMonth() + 1, 1))
  const horizon = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30))
  const { data, error, reload } = useLoad(async () => ({
    month: must(await supabase.from('company_bills').select('*').gte('due_on', m0).lt('due_on', m1)) as Bill[],
    open: must(await supabase.from('company_bills').select('*').is('paid_on', null).lte('due_on', horizon).order('due_on')) as Bill[],
    budget: (must(await supabase.from('bill_budgets').select('amount').eq('month', m0)) as { amount: number }[]).reduce((a, b) => a + Number(b.amount), 0),
  }), [m0])
  const month = data?.month ?? []
  const total = month.reduce((a, b) => a + Number(b.amount), 0)
  const paid = month.filter((b) => b.paid_on).reduce((a, b) => a + Number(b.amount), 0)
  const byCat: Record<string, number> = {}
  month.forEach((b) => { byCat[b.category] = (byCat[b.category] ?? 0) + Number(b.amount) })
  let off = 0
  const segs = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => { const pct = total ? v / total * 100 : 0; const s = { c, v, pct, offset: off }; off += pct; return s })
  const markPaid = async (b: Bill) => { await supabase.from('company_bills').update({ paid_on: iso(new Date()) }).eq('id', b.id); reload() }
  const monthName = now.toLocaleDateString('en-US', { month: 'long' })

  return (
    <section className="card pad stack" aria-labelledby="hb-h">
      <div className="row between"><h2 id="hb-h">Bills</h2><Link to="/bills" style={{ fontSize: 14, fontWeight: 700 }}>All bills ›</Link></div>
      {error && <p className="err">{error}</p>}
      <div className="row" style={{ gap: 16, alignItems: 'center', flexWrap: 'nowrap' }}>
        <svg width="132" height="132" viewBox="0 0 220 220" role="img" style={{ flex: 'none' }}
          aria-label={`${monthName} bills ${money(total)}${data?.budget ? ` of a ${money(data.budget)} budget` : ''}, ${money(paid)} paid`}>
          <circle cx="110" cy="110" r="80" fill="none" stroke="#eeebe5" strokeWidth="30" />
          {segs.map((s) => <circle key={s.c} cx="110" cy="110" r="80" fill="none" stroke={COLOR[s.c] ?? '#98a2b3'} strokeWidth="30" pathLength={100} strokeDasharray={`${s.pct} 100`} strokeDashoffset={-s.offset} transform="rotate(-90 110 110)" />)}
          <text x="110" y="106" textAnchor="middle" fontFamily="Arial" fontSize="30" fontWeight="700" fill="#1c1f23">{money(total).replace('.00', '')}</text>
          <text x="110" y="134" textAnchor="middle" fontFamily="Arial" fontSize="17" fill="#5f6368">{data?.budget ? `of ${money(data.budget).replace('.00', '')}` : monthName}</text>
        </svg>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: '0 0 6px', fontSize: 14 }}><strong>{monthName}</strong> · <span style={{ color: 'var(--green)', fontWeight: 700 }}>{money(paid)} paid</span> · {money(total - paid)} left</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3, fontSize: 13 }}>
            {segs.slice(0, 5).map((s) => <li key={s.c} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, flex: 'none', background: COLOR[s.c] ?? '#98a2b3' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.c}</span><span className="num">{money(s.v).replace('.00', '')}</span></li>)}
            {segs.length === 0 && data && <li className="muted"><em>No bills this month.</em></li>}
          </ul>
        </div>
      </div>
      <div>
        <h3 style={{ margin: '4px 0 6px', fontSize: 14 }}>Coming due</h3>
        {data && data.open.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 14 }}><em>Nothing unpaid in the next 30 days.</em></p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {[...(data?.open ?? [])].sort((a, b) => a.due_on.localeCompare(b.due_on)).map((b) => { const [label, cls] = statusOf(b); return (
            <li key={b.id} className="hb-row">
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</strong>
                <span className="muted" style={{ fontSize: 12 }}>{short(b.due_on)} · <span className={'badge ' + cls} style={{ fontSize: 11 }}>{label}</span></span>
              </div>
              <span className="num" style={{ fontWeight: 700 }}>{money(b.amount)}</span>
              <button type="button" className="btn small secondary" onClick={() => markPaid(b)} aria-label={`Mark ${b.name} paid`}>Paid</button>
            </li>) })}
        </ul>
      </div>
    </section>
  )
}

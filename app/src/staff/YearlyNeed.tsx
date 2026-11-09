import { useEffect, useState } from 'react'
import { supabase, money } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import type { Bill } from './Bills'
import WeeklyTime from './WeeklyTime'

/** Bills page, right side: what the firm has to bring in for the year to cover its bills and salaries.
 *  Monthly (recurring) bills in the month on screen × 12, plus one-off bills dated in that year,
 *  plus optional employer payroll taxes and a profit margin; compared with invoices paid this year. */

const EMPLOYER_PAYROLL_TAX = 7.65 // % — employer Social Security (6.2%) + Medicare (1.45%)
const HOURS_PER_YEAR = 2080 // 40 h × 52 weeks
const KEY = 'abaya.bills.yearly'

type Opt = { tax: boolean; margin: string }
const readOpt = (): Opt => { try { return { tax: false, margin: '0', ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { tax: false, margin: '0' } } }
/** Bills by category for the year: recurring bills in a month × 12 + one-off bills in the year. */
function annualize(monthBills: Bill[], oneOff: Bill[]) {
  const byCat: Record<string, number> = {}
  monthBills.filter((b) => b.recurring_monthly).forEach((b) => { byCat[b.category] = (byCat[b.category] ?? 0) + Number(b.amount) * 12 })
  oneOff.forEach((b) => { byCat[b.category] = (byCat[b.category] ?? 0) + Number(b.amount) })
  return byCat
}
/** Revenue needed for the year from annualized bills, with the payroll-tax and margin options set on the Bills page. */
function needOf(byCat: Record<string, number>, opt: Opt) {
  const bills = Object.values(byCat).reduce((a, b) => a + b, 0)
  const payrollTax = opt.tax ? (byCat['Salaries'] ?? 0) * EMPLOYER_PAYROLL_TAX / 100 : 0
  const costs = bills + payrollTax
  const marginPct = Math.min(90, Math.max(0, Number(opt.margin) || 0))
  return { bills, payrollTax, costs, marginPct, need: marginPct ? costs / (1 - marginPct / 100) : costs }
}
/** This year's revenue need, for pages other than Bills (uses this month's bills). */
export function useYearlyNeed() {
  const d = new Date(); const y = d.getFullYear(); const m = `${y}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  const next = new Date(y, d.getMonth() + 1, 1); const n = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
  const data = useLoad(async () => {
    const month = must(await supabase.from('company_bills').select('category, amount, recurring_monthly').eq('recurring_monthly', true).gte('due_on', m).lt('due_on', n)) as Bill[]
    const oneOff = must(await supabase.from('company_bills').select('category, amount, recurring_monthly').eq('recurring_monthly', false).gte('due_on', `${y}-01-01`).lt('due_on', `${y + 1}-01-01`)) as Bill[]
    return needOf(annualize(month, oneOff), readOpt()).need
  }, [m])
  return data.data ?? 0
}

export default function YearlyNeed({ month, monthBills, order, colors }: { month: string; monthBills: Bill[]; order: string[]; colors: Record<string, string> }) {
  const year = Number(month.slice(0, 4))
  const data = useLoad(async () => {
    const oneOff = must(await supabase.from('company_bills').select('id, name, category, amount, due_on, recurring_monthly')
      .eq('recurring_monthly', false).gte('due_on', `${year}-01-01`).lt('due_on', `${year + 1}-01-01`)) as Bill[]
    const paid = must(await supabase.from('invoices').select('amount_paid').gte('paid_at', `${year}-01-01`).lt('paid_at', `${year + 1}-01-01`)) as { amount_paid: number }[]
    const people = must(await supabase.from('profiles').select('util_target, bill_rate').in('role', ['admin', 'staff'])) as { util_target: number | null; bill_rate: number | null }[]
    return { oneOff, collected: paid.reduce((a, x) => a + Number(x.amount_paid || 0), 0), people }
  }, [year])
  const [opt, setOpt] = useState<Opt>(readOpt)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(opt)) } catch { /* private mode */ } }, [opt])

  // annualize: recurring bills in this month × 12, one-off bills dated this year once
  const byCat = annualize(monthBills, data.data?.oneOff ?? [])
  const cats = Object.keys(byCat).sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) })
  const { payrollTax, costs, marginPct, need } = needOf(byCat, opt)
  const profit = need - costs

  // pace: how much of the year has gone by (only for the current year)
  const now = new Date()
  const elapsed = year < now.getFullYear() ? 1 : year > now.getFullYear() ? 0
    : (now.getTime() - new Date(year, 0, 1).getTime()) / (new Date(year + 1, 0, 1).getTime() - new Date(year, 0, 1).getTime())
  const collected = data.data?.collected ?? 0
  const pacedNeed = need * elapsed
  const ahead = collected - pacedNeed

  // what it means per billable hour, at everyone's utilization target
  const billHours = (data.data?.people ?? []).reduce((a, p) => a + HOURS_PER_YEAR * (Number(p.util_target) || 0) / 100, 0)
  const capacity = (data.data?.people ?? []).reduce((a, p) => a + HOURS_PER_YEAR * (Number(p.util_target) || 0) / 100 * (Number(p.bill_rate) || 0), 0)

  return (
    <div className="stack bills-side">
    <aside className="card pad stack yn" aria-labelledby="yn-h">
      <div>
        <h2 id="yn-h" style={{ margin: 0 }}>What we need in {year}</h2>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Revenue to cover the year’s bills and salaries: monthly bills × 12, plus one-off bills dated in {year}.</p>
      </div>
      <div className="yn-big">
        <strong className="num">{money(Math.round(need))}</strong>
        <span className="muted">per year</span>
      </div>
      <div className="yn-split num">
        <div><span>{money(Math.round(need / 12))}</span><small>per month</small></div>
        <div><span>{money(Math.round(need / 52))}</span><small>per week</small></div>
      </div>

      <table className="yn-t">
        <tbody>
          {cats.map((c) => <tr key={c}><th scope="row"><span className="yn-dot" style={{ background: colors[c] ?? '#98a2b3' }} aria-hidden="true" />{c}</th><td className="num">{money(byCat[c])}</td></tr>)}
          {payrollTax > 0 && <tr><th scope="row">Employer payroll taxes ({EMPLOYER_PAYROLL_TAX}%)</th><td className="num">{money(payrollTax)}</td></tr>}
          {profit > 0.5 && <tr><th scope="row">Profit ({marginPct}% of revenue)</th><td className="num">{money(profit)}</td></tr>}
        </tbody>
        <tfoot><tr><th scope="row">Total</th><td className="num">{money(need)}</td></tr></tfoot>
      </table>
      {cats.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 14 }}><em>No monthly bills in this month yet.</em></p>}

      <fieldset className="yn-opts">
        <legend className="sr">Options</legend>
        <label className="row" style={{ gap: 8, fontSize: 14 }}><input type="checkbox" checked={opt.tax} onChange={(e) => setOpt({ ...opt, tax: e.target.checked })} style={{ width: 18, height: 18 }} />
          Add employer payroll taxes on salaries ({EMPLOYER_PAYROLL_TAX}%)</label>
        <div className="row" style={{ gap: 8, fontSize: 14 }}><label htmlFor="yn-m">Profit margin</label>
          <input id="yn-m" className="input num" inputMode="decimal" value={opt.margin} onChange={(e) => setOpt({ ...opt, margin: e.target.value })} style={{ width: 70, minHeight: 34, padding: '4px 8px' }} /><span>% of revenue</span></div>
      </fieldset>

      {elapsed > 0 && <div className="yn-pace">
        <div className="row between" style={{ fontSize: 14 }}><strong>Collected in {year}</strong><span className="num">{money(collected)}</span></div>
        <div className="bar" aria-hidden="true"><span style={{ width: `${need ? Math.min(100, collected / need * 100) : 0}%`, background: ahead >= 0 ? '#067647' : '#b54708' }} /><i style={{ left: `${Math.min(100, elapsed * 100)}%` }} /></div>
        <p style={{ margin: '6px 0 0', fontSize: 13 }} className={ahead >= 0 ? 'yn-ok' : 'yn-warn'}>
          {need ? `${(collected / need * 100).toFixed(0)}% of the year’s need. ` : ''}
          {elapsed < 1 ? (ahead >= 0 ? `${money(ahead)} ahead of pace` : `${money(-ahead)} behind pace`) + ` (${(elapsed * 100).toFixed(0)}% of the year has gone by).` : ahead >= 0 ? `Covered, with ${money(ahead)} to spare.` : `${money(-ahead)} short.`}</p>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>Payments recorded on invoices, by date paid. The tick marks today.</p>
      </div>}

      {billHours > 0 && <div className="yn-hours">
        <div className="row between" style={{ fontSize: 14 }}><span>Needed per billable hour</span><strong className="num">{money(need / billHours)}</strong></div>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>{Math.round(billHours).toLocaleString()} billable hours a year at everyone’s utilization target. At your billing rates those hours are worth {money(Math.round(capacity))}{capacity ? ` — ${(capacity / need).toFixed(1)}× what you need.` : '.'}</p>
      </div>}
    </aside>
    <WeeklyTime weeklyNeed={need / 52} />
    </div>
  )
}

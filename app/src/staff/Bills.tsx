import { useEffect, useMemo, useState } from 'react'
import RowMenu, { type RowMenuItem } from '../components/RowMenu'
import { supabase, money } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import './admin.css'

export type Bill = { id: string; name: string; category: string; amount: number; due_on: string; paid_on: string | null; recurring_monthly: boolean; note: string | null }
type Budget = { month: string; category: string; amount: number }

export const CATS: [string, string][] = [['Salaries', '#02253d'], ['Rent', '#9a8f63'], ['Software & subscriptions', '#b42318'], ['Internet & phone', '#5f8fb0'], ['Insurance', '#d8cfae'], ['Utilities', '#5f583b'], ['Other', '#98a2b3']]
export const COLOR = Object.fromEntries(CATS)
const pad = (n: number) => String(n).padStart(2, '0')
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
const addMonths = (key: string, n: number) => { const [y, m] = key.split('-').map(Number); return monthKey(new Date(y, m - 1 + n, 1)) }
const monthLabel = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

export function statusOf(b: Bill): [string, string] {
  if (b.paid_on) return ['Paid', 'b-paid']
  const t = todayIso()
  if (b.due_on < t) return ['Overdue', 'b-over']
  const soon = new Date(); soon.setDate(soon.getDate() + 7)
  if (b.due_on <= `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`) return ['Due soon', 'b-soon']
  return ['Scheduled', 'b-sched']
}

export default function Bills() {
  const { profile } = useAuth()
  const admin = profile?.role === 'admin'
  const [month, setMonth] = useState(() => monthKey(new Date()))
  const [adding, setAdding] = useState(false)
  const [editBudget, setEditBudget] = useState(false)
  const [err, setErr] = useState('')
  const end = addMonths(month, 1)
  const { data, error, reload } = useLoad(async () => {
    const bills = must(await supabase.from('company_bills').select('*').gte('due_on', month).lt('due_on', end).order('due_on')) as Bill[]
    const budgets = must(await supabase.from('bill_budgets').select('*').eq('month', month)) as Budget[]
    const prevRecurring = must(await supabase.from('company_bills').select('*').eq('recurring_monthly', true).gte('due_on', addMonths(month, -1)).lt('due_on', month)) as Bill[]
    return { bills, budgets, prevRecurring }
  }, [month])
  const bills = data?.bills ?? []
  const budgetBy = Object.fromEntries((data?.budgets ?? []).map((b) => [b.category, Number(b.amount)]))
  const spentBy = useMemo(() => { const m: Record<string, number> = {}; bills.forEach((b) => { m[b.category] = (m[b.category] ?? 0) + Number(b.amount) }); return m }, [bills])
  const spent = bills.reduce((a, b) => a + Number(b.amount), 0)
  const budget = Object.values(budgetBy).reduce((a, b) => a + b, 0)
  // category order: yours (saved on this device), then the standard order for anything new
  const [order, setOrder] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('abaya.bills.catOrder') || '[]') } catch { return [] } })
  useEffect(() => { try { localStorage.setItem('abaya.bills.catOrder', JSON.stringify(order)) } catch { /* private mode */ } }, [order])
  const rank = (c: string) => { const i = order.indexOf(c); return i >= 0 ? i : 1000 + (CATS.findIndex(([x]) => x === c) + 1 || 99) }
  const cats = Array.from(new Set([...CATS.map(([c]) => c).filter((c) => spentBy[c] || budgetBy[c]), ...Object.keys(spentBy), ...Object.keys(budgetBy)])).sort((a, b) => rank(a) - rank(b))
  const groups = cats.filter((c) => bills.some((b) => b.category === c))
  /** Move a category up/down (or to another's place when dragged); the whole current order is saved. */
  const moveCat = (c: string, to: number) => {
    const list = [...groups]; const from = list.indexOf(c); if (from < 0 || to < 0 || to >= list.length || from === to) return
    list.splice(from, 1); list.splice(to, 0, c)
    setOrder([...list, ...order.filter((x) => !list.includes(x))])
  }
  const [dragCat, setDragCat] = useState<string | null>(null)
  const [editing, setEditing] = useState<Bill | null>(null)
  const missingRecurring = (data?.prevRecurring ?? []).filter((p) => !bills.some((b) => b.name === p.name))

  const copyRecurring = async () => {
    const rows = missingRecurring.map((p) => { const [, , d] = p.due_on.split('-'); const [y, m] = month.split('-')
      const last = new Date(Number(y), Number(m), 0).getDate()
      return { name: p.name, category: p.category, amount: p.amount, due_on: `${y}-${m}-${pad(Math.min(Number(d), last))}`, recurring_monthly: true, note: p.note, created_by: profile!.id } })
    const { error } = await supabase.from('company_bills').insert(rows)
    setErr(error?.message ?? ''); reload()
  }
  const markPaid = async (b: Bill, paid: boolean) => {
    const { error } = await supabase.from('company_bills').update({ paid_on: paid ? todayIso() : null }).eq('id', b.id)
    setErr(error?.message ?? ''); reload()
  }
  const remove = async (b: Bill) => {
    if (!window.confirm(`Delete “${b.name}” (${money(b.amount)}, due ${new Date(b.due_on + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})? This can’t be undone.`)) return
    const { error } = await supabase.from('company_bills').delete().eq('id', b.id); setErr(error?.message ?? ''); reload()
  }
  /** Copy a bill (unpaid) into this month or the next, then open the copy to edit. */
  const duplicate = async (b: Bill, months = 0) => {
    const [y, m, d] = b.due_on.split('-').map(Number)
    const last = new Date(y, m - 1 + months + 1, 0).getDate()
    const due = new Date(y, m - 1 + months, Math.min(d, last))
    const due_on = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`
    const { data: row, error } = await supabase.from('company_bills').insert({ name: months ? b.name : `${b.name} (copy)`, category: b.category, amount: b.amount, due_on, recurring_monthly: b.recurring_monthly, note: b.note, created_by: profile!.id }).select('*').single()
    if (error) return setErr(error.message)
    setErr('')
    if (months) { setMonth(monthKey(due)); return }
    reload(); setAdding(false); setEditing(row as Bill)
  }
  const toggleMonthly = async (b: Bill) => { const { error } = await supabase.from('company_bills').update({ recurring_monthly: !b.recurring_monthly }).eq('id', b.id); setErr(error?.message ?? ''); reload() }
  const menu = (b: Bill): RowMenuItem[] => [
    { label: 'Edit…', onSelect: () => { setAdding(false); setEditing(b) } },
    { label: 'Duplicate', onSelect: () => duplicate(b) },
    { label: 'Copy to next month', onSelect: () => duplicate(b, 1) },
    { label: b.recurring_monthly ? 'Stop repeating monthly' : 'Repeat every month', onSelect: () => toggleMonthly(b) },
    { label: b.paid_on ? 'Mark unpaid' : 'Mark paid', onSelect: () => markPaid(b, !b.paid_on) },
    'divider',
    { label: 'Delete', danger: true, onSelect: () => remove(b) },
  ]

  // donut
  let offset = 0
  const segs = cats.filter((c) => spentBy[c]).map((c) => { const pct = spent ? spentBy[c] / spent * 100 : 0; const s = { c, pct, offset }; offset += pct; return s })
  const diff = spent - budget

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div><h1>Company bills</h1><p className="muted" style={{ margin: '6px 0 0' }}>Salaries, rent, utilities and subscriptions, against this month’s budget.</p></div>
        <div className="row">
          <button className="btn small secondary" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
          <strong style={{ minWidth: 150, textAlign: 'center' }}>{monthLabel(month)}</strong>
          <button className="btn small secondary" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>›</button>
          {admin && <button className="btn" onClick={() => { setEditing(null); setAdding(!adding) }}>{adding ? 'Close' : 'Add bill'}</button>}
        </div>
      </div>
      {!admin && <p className="muted" style={{ margin: 0 }}>Only admins can add or change bills.</p>}
      {(error || err) && <p className="err" role="alert">{error || err}</p>}
      {adding && admin && <AddBill month={month} me={profile!.id} onDone={() => { setAdding(false); reload() }} />}
      {editing && admin && <AddBill key={editing.id} month={month} me={profile!.id} bill={editing} onDone={() => { setEditing(null); reload() }} onCancel={() => setEditing(null)} />}
      {missingRecurring.length > 0 && admin && <div className="ok row between"><span>{missingRecurring.length} recurring bill{missingRecurring.length === 1 ? '' : 's'} from last month {missingRecurring.length === 1 ? 'isn’t' : 'aren’t'} in {monthLabel(month)} yet.</span><button className="btn small" onClick={copyRecurring}>Add them</button></div>}

      <section className="card pad stack" aria-labelledby="bd-h">
        <div className="row between">
          <h2 id="bd-h">Budget — {monthLabel(month).split(' ')[0]}</h2>
          <div className="row">
            {budget > 0 && <span className={'badge ' + (diff > 0 ? 'b-over' : 'b-paid')}>{diff > 0 ? `Over budget by ${money(diff)}` : `${money(-diff)} under budget`}</span>}
            {admin && <button className="btn small secondary" onClick={() => setEditBudget(!editBudget)}>{editBudget ? 'Done' : 'Edit budget'}</button>}
          </div>
        </div>
        {editBudget ? <BudgetEditor month={month} budgetBy={budgetBy} onSaved={reload} /> : (
          <div className="row" style={{ gap: 36, alignItems: 'center' }}>
            <figure style={{ margin: 0, flex: '0 1 220px', display: 'flex', justifyContent: 'center' }}>
              <svg width="220" height="220" viewBox="0 0 220 220" role="img" aria-label={`${money(spent)} of bills this month${budget ? ` against a ${money(budget)} budget` : ''}`}>
                <circle cx="110" cy="110" r="80" fill="none" stroke="#eeebe5" strokeWidth="28" />
                {segs.map((s) => <circle key={s.c} cx="110" cy="110" r="80" fill="none" stroke={COLOR[s.c] ?? '#98a2b3'} strokeWidth="28" pathLength={100} strokeDasharray={`${s.pct} 100`} strokeDashoffset={-s.offset} transform="rotate(-90 110 110)" />)}
                <text x="110" y="108" textAnchor="middle" fontFamily="Arial" fontSize="24" fontWeight="700" fill="#1c1f23">{money(spent).replace('.00', '')}</text>
                <text x="110" y="130" textAnchor="middle" fontFamily="Arial" fontSize="13" fill="#5f6368">{budget ? `of ${money(budget).replace('.00', '')} budget` : 'no budget set'}</text>
              </svg>
            </figure>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {cats.length === 0 && <li className="muted"><em>No bills or budget for this month yet.</em></li>}
              {cats.map((c) => { const s = spentBy[c] ?? 0, b = budgetBy[c] ?? 0, over = s - b
                return <li key={c} style={{ display: 'grid', gap: 6 }}>
                  <div className="row between" style={{ fontSize: 15 }}><span className="row" style={{ gap: 8 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: COLOR[c] ?? '#98a2b3' }} /><strong>{c}</strong></span><span className="num">{money(s)} of {money(b)}</span></div>
                  <div className="bar" aria-hidden="true"><span style={{ width: (b ? Math.min(100, s / b * 100) : s ? 100 : 0) + '%', background: over > 0.005 ? '#b42318' : 'var(--navy)' }} /></div>
                  <small style={{ fontSize: 13, fontWeight: 700, color: Math.abs(over) < 0.005 ? 'var(--muted)' : over > 0 ? '#b42318' : '#067647' }}>{Math.abs(over) < 0.005 ? 'On budget' : over > 0 ? `${money(over)} over` : `${money(-over)} under`}</small>
                </li> })}
            </ol>
          </div>)}
      </section>

      <section className="card pad" aria-labelledby="bl-h">
        <h2 id="bl-h" style={{ marginBottom: 8 }}>Bills this month</h2>
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>Grouped by category. Drag a category heading, or use its arrows, to change the order.</p>
        <div className="tablewrap"><table className="table bills-t" style={{ minWidth: 720 }}>
          <thead><tr><th>Bill</th><th>Due</th><th className="r">Amount</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead>
          {groups.map((c, gi) => { const rows = bills.filter((b) => b.category === c); return (
            <tbody key={c} className={'bills-g' + (dragCat === c ? ' dragging' : '')}
              onDragOver={(e) => { if (dragCat && dragCat !== c) e.preventDefault() }}
              onDrop={(e) => { e.preventDefault(); if (dragCat) moveCat(dragCat, gi); setDragCat(null) }}>
              <tr className="bills-gh" draggable onDragStart={(e) => { setDragCat(c); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c) }} onDragEnd={() => setDragCat(null)}>
                <th colSpan={2} scope="colgroup">
                  <span className="bills-grip" aria-hidden="true">⋮⋮</span>
                  <span aria-hidden="true" className="bills-dot" style={{ background: COLOR[c] ?? '#98a2b3' }} />{c}
                  <span className="muted bills-n">{rows.length} bill{rows.length === 1 ? '' : 's'}</span>
                </th>
                <td className="r num"><strong>{money(spentBy[c] ?? 0)}</strong></td>
                <td colSpan={2} className="r">
                  <span className="bills-mv">
                    <button type="button" className="btn small secondary" disabled={gi === 0} onClick={() => moveCat(c, gi - 1)} aria-label={`Move ${c} up`} title="Move up">↑</button>
                    <button type="button" className="btn small secondary" disabled={gi === groups.length - 1} onClick={() => moveCat(c, gi + 1)} aria-label={`Move ${c} down`} title="Move down">↓</button>
                  </span>
                </td>
              </tr>
              {rows.map((b) => { const [l, cls] = statusOf(b); return (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong>{b.recurring_monthly && <span className="pill" style={{ marginLeft: 8 }}>Monthly</span>}{b.note && <div className="muted" style={{ fontSize: 13 }}>{b.note}</div>}</td>
                  <td className="num">{new Date(b.due_on + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td className="r num"><strong>{money(b.amount)}</strong></td>
                  <td><span className={'badge ' + cls}>{l}</span></td>
                  <td>{admin && <div className="row" style={{ gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                    <button className="btn small secondary" onClick={() => markPaid(b, !b.paid_on)}>{b.paid_on ? 'Mark unpaid' : 'Mark paid'}</button>
                    <RowMenu label={`Actions for ${b.name}`} items={menu(b)} /></div>}</td>
                </tr>) })}
            </tbody>) })}
          {data && bills.length === 0 && <tbody><tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}><em>No bills in {monthLabel(month)}.</em></td></tr></tbody>}
        </table></div>
      </section>
    </div>
  )
}

function AddBill({ month, me, bill, onDone, onCancel }: { month: string; me: string; bill?: Bill; onDone: () => void; onCancel?: () => void }) {
  const [f, setF] = useState(() => bill
    ? { name: bill.name, category: bill.category, amount: String(Number(bill.amount)), due_on: bill.due_on, recurring: bill.recurring_monthly, note: bill.note ?? '' }
    : { name: '', category: 'Rent', amount: '', due_on: month, recurring: false, note: '' })
  const [err, setErr] = useState('')
  useEffect(() => { if (bill) document.getElementById('b-n')?.focus() }, [bill])
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = Number(String(f.amount).replace(/[$,]/g, ''))
    if (!f.name.trim() || !(amount > 0)) return setErr('Enter a name and an amount.')
    const row = { name: f.name.trim(), category: f.category, amount, due_on: f.due_on, recurring_monthly: f.recurring, note: f.note || null }
    const { error } = bill ? await supabase.from('company_bills').update(row).eq('id', bill.id) : await supabase.from('company_bills').insert({ ...row, created_by: me })
    if (error) return setErr(error.message)
    onDone()
  }
  return (
    <form onSubmit={save} className="card pad stack">
      <h2>{bill ? 'Edit bill' : 'Add bill'}</h2>
      <div className="formgrid">
        <div><label className="l" htmlFor="b-n">Bill</label><input id="b-n" className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Office rent — Suite 215" /></div>
        <div><label className="l" htmlFor="b-c">Category</label><select id="b-c" className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map(([c]) => <option key={c}>{c}</option>)}</select></div>
        <div><label className="l" htmlFor="b-a">Amount ($)</label><input id="b-a" className="input num" inputMode="decimal" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div><label className="l" htmlFor="b-d">Due</label><input id="b-d" type="date" className="input" required value={f.due_on} onChange={(e) => setF({ ...f, due_on: e.target.value })} /></div>
        <div><label className="l" htmlFor="b-note">Note</label><input id="b-note" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      </div>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.checked })} style={{ width: 18, height: 18 }} />Repeats every month</label>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row"><button className="btn">{bill ? 'Save changes' : 'Save bill'}</button>{onCancel && <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>}</div>
    </form>)
}

function BudgetEditor({ month, budgetBy, onSaved }: { month: string; budgetBy: Record<string, number>; onSaved: () => void }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(CATS.map(([c]) => [c, budgetBy[c] ? String(budgetBy[c]) : ''])))
  const [msg, setMsg] = useState('')
  const save = async () => {
    const rows = CATS.map(([c]) => ({ month, category: c, amount: Number(v[c]) || 0 }))
    const { error } = await supabase.from('bill_budgets').upsert(rows)
    setMsg(error ? error.message : 'Saved.'); if (!error) onSaved()
  }
  const copyPrev = async () => {
    const { data } = await supabase.from('bill_budgets').select('*').eq('month', addMonths(month, -1))
    if (data?.length) setV(Object.fromEntries(CATS.map(([c]) => [c, String((data as Budget[]).find((b) => b.category === c)?.amount ?? '')])))
    else setMsg('Last month has no budget to copy.')
  }
  return (
    <div className="stack">
      <div className="formgrid">{CATS.map(([c]) => <div key={c}><label className="l" htmlFor={'bg-' + c}>{c}</label><input id={'bg-' + c} className="input num" inputMode="decimal" placeholder="$0" value={v[c]} onChange={(e) => setV({ ...v, [c]: e.target.value })} /></div>)}</div>
      <div className="row"><button className="btn small" onClick={save}>Save budget</button><button className="btn small secondary" onClick={copyPrev}>Copy last month</button>{msg && <span className="muted">{msg}</span>}</div>
    </div>)
}

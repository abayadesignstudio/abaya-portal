import { useMemo, useState } from 'react'
import { supabase, money, SECTOR_COLOR } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import './admin.css'

type Expense = { id: string; project_id: string; description: string; amount: number; spent_on: string; reimbursable: boolean; invoice_id: string | null; receipt_path: string | null
  projects: { number: string; name: string; sector: string | null } | null; invoices: { number: string } | null }
type P = { id: string; number: string; name: string }
const blank = { project_id: '', description: '', amount: '', spent_on: new Date().toISOString().slice(0, 10), reimbursable: true }

export default function Expenses() {
  const { profile } = useAuth()
  const [filter, setFilter] = useState<'all' | 'uninvoiced' | 'invoiced' | 'internal'>('uninvoiced')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<(typeof blank & { id?: string }) | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { data, error, reload } = useLoad(async () => {
    const ex = must(await supabase.from('expenses').select('id, project_id, description, amount, spent_on, reimbursable, invoice_id, receipt_path, projects(number, name, sector), invoices(number)').order('spent_on', { ascending: false })) as unknown as Expense[]
    const projects = must(await supabase.from('projects').select('id, number, name').order('number', { ascending: false })) as P[]
    return { ex, projects }
  })
  const rows = useMemo(() => (data?.ex ?? []).filter((e) =>
    (filter === 'all' || (filter === 'uninvoiced' && e.reimbursable && !e.invoice_id) || (filter === 'invoiced' && !!e.invoice_id) || (filter === 'internal' && !e.reimbursable)) &&
    (!q || `${e.description} ${e.projects?.number} ${e.projects?.name}`.toLowerCase().includes(q.toLowerCase()))), [data, filter, q])
  const total = rows.reduce((a, e) => a + Number(e.amount), 0)

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault(); if (!edit) return
    const amount = Number(edit.amount)
    if (!edit.project_id || !edit.description.trim() || !(amount > 0)) return setErr('Choose a project and enter a description and amount.')
    setBusy(true); setErr('')
    try {
      let receipt_path: string | undefined
      if (file) {
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
        receipt_path = `${edit.project_id}/${crypto.randomUUID()}.${ext}`
        const up = await supabase.storage.from('receipts').upload(receipt_path, file, { contentType: file.type || undefined })
        if (up.error) throw new Error(up.error.message)
      }
      const row = { project_id: edit.project_id, description: edit.description.trim(), amount, spent_on: edit.spent_on, reimbursable: edit.reimbursable, ...(receipt_path ? { receipt_path } : {}) }
      const r = edit.id ? await supabase.from('expenses').update(row).eq('id', edit.id) : await supabase.from('expenses').insert({ ...row, created_by: profile!.id })
      if (r.error) throw new Error(r.error.message)
      setEdit(null); setFile(null); reload()
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)) }
    setBusy(false)
  }
  const openReceipt = async (path: string) => {
    const { data: s, error } = await supabase.storage.from('receipts').createSignedUrl(path, 300)
    if (error) return setErr(error.message)
    window.open(s.signedUrl, '_blank', 'noopener')
  }
  const remove = async (e: Expense) => {
    if (e.invoice_id) return setErr('This expense is on an invoice; remove it from the invoice first.')
    const r = await supabase.from('expenses').delete().eq('id', e.id); setErr(r.error?.message ?? ''); reload()
  }

  return (
    <div className="stack">
      <div className="row between"><h1>Expenses</h1><button className="btn" onClick={() => { setEdit(edit ? null : { ...blank }); setFile(null) }}>{edit ? 'Close' : '+ Add expense'}</button></div>
      {edit && (
        <form onSubmit={save} className="card pad stack">
          <h2>{edit.id ? 'Edit expense' : 'Add expense'}</h2>
          <div className="formgrid">
            <div style={{ gridColumn: 'span 2' }}><label className="l" htmlFor="e-p">Project</label><select id="e-p" className="input" required value={edit.project_id} onChange={(e) => setEdit({ ...edit, project_id: e.target.value })}>
              <option value="">Choose…</option>{data?.projects.map((p) => <option key={p.id} value={p.id}>{p.number === 'OH' ? 'Overhead (firm)' : `${p.number} · ${p.name}`}</option>)}</select></div>
            <div style={{ gridColumn: 'span 2' }}><label className="l" htmlFor="e-d">Description</label><input id="e-d" className="input" required value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="Printing — 24×36, 12 sheets" /></div>
            <div><label className="l" htmlFor="e-a">Amount ($)</label><input id="e-a" className="input num" inputMode="decimal" required value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} /></div>
            <div><label className="l" htmlFor="e-dt">Date</label><input id="e-dt" type="date" className="input" value={edit.spent_on} onChange={(e) => setEdit({ ...edit, spent_on: e.target.value })} /></div>
            <div><label className="l" htmlFor="e-r">Receipt</label><input id="e-r" type="file" accept="image/*,application/pdf" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          </div>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={edit.reimbursable} onChange={(e) => setEdit({ ...edit, reimbursable: e.target.checked })} style={{ width: 18, height: 18 }} />Reimbursable — bill it to the client (10% service fee is added on the invoice)</label>
          {err && <p className="err" role="alert">{err}</p>}
          <div><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save expense'}</button></div>
        </form>)}
      <div className="row between">
        <div className="row" role="group" aria-label="Show">
          {([['uninvoiced', 'Not yet invoiced'], ['invoiced', 'Invoiced'], ['internal', 'Firm (not billable)'], ['all', 'All']] as const).map(([id, l]) =>
            <button key={id} className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{l}</button>)}
        </div>
        <div style={{ width: 280, maxWidth: '100%' }}><label className="sr" htmlFor="eq">Search</label><input id="eq" className="input" placeholder="Search description or project" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {(error || (!edit && err)) && <p className="err" role="alert">{error || err}</p>}
      <div className="card tablewrap">
        <table className="table" style={{ minWidth: 900 }}>
          <thead><tr><th>Date</th><th>Project</th><th>Description</th><th className="r">Amount</th><th>Billing</th><th>Receipt</th><th></th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="num">{new Date(e.spent_on + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td>{e.projects && <span className="row" style={{ gap: 6 }}><span className="tag" style={{ background: SECTOR_COLOR[e.projects.sector ?? 'internal'] }}>{e.projects.number}</span>{e.projects.number === 'OH' ? 'Overhead' : e.projects.name}</span>}</td>
                <td>{e.description}</td>
                <td className="r num"><strong>{money(e.amount)}</strong></td>
                <td>{!e.reimbursable ? <span className="badge b-sched">Firm expense</span> : e.invoice_id ? <span className="badge b-paid">On {e.invoices?.number ?? 'invoice'}</span> : <span className="badge b-soon">Not yet invoiced</span>}</td>
                <td>{e.receipt_path ? <button className="linkbtn" onClick={() => openReceipt(e.receipt_path!)}>View</button> : <span className="muted">—</span>}</td>
                <td><div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <button className="btn small secondary" onClick={() => { setEdit({ id: e.id, project_id: e.project_id, description: e.description, amount: String(e.amount), spent_on: e.spent_on, reimbursable: e.reimbursable }); setFile(null); window.scrollTo({ top: 0 }) }}>Edit</button>
                  <button className="btn small danger" aria-label={`Delete ${e.description}`} onClick={() => remove(e)}>×</button></div></td>
              </tr>))}
            {data && rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}><em>No expenses here.</em></td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr><td colSpan={3} style={{ padding: 12, fontWeight: 700 }}>Total</td><td className="r num" style={{ padding: 12, fontWeight: 700 }}>{money(total)}</td><td colSpan={3} /></tr></tfoot>}
        </table>
      </div>
    </div>
  )
}

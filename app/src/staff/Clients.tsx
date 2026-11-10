import { useMemo, useState } from 'react'
import { supabase, money } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import './admin.css'
import RowMenu from '../components/RowMenu'

type Contact = { id: string; name: string | null; email: string; receives_invoices: boolean; receives_updates: boolean }
type Client = { id: string; name: string; billing_email: string | null; phone: string | null; address: string | null; client_contacts: Contact[]; projects: { id: string; status: string }[] }
type Inv = { client_id: string; status: string; total: number; amount_paid: number | null; due_date: string | null }
type FormContact = { id?: string; name: string; email: string; receives_invoices: boolean; receives_updates: boolean }
const blankContact = (): FormContact => ({ name: '', email: '', receives_invoices: true, receives_updates: true })
const blankClient = { name: '', billing_email: '', phone: '', address: '', contacts: [blankContact()] as FormContact[] }

export default function Clients() {
  const { profile } = useAuth()
  const admin = profile?.role === 'admin'
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [form, setForm] = useState<(typeof blankClient & { id?: string }) | null>(null)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const { data, error, reload } = useLoad(async () => {
    const clients = must(await supabase.from('clients').select('id, name, billing_email, phone, address, client_contacts(id, name, email, receives_invoices, receives_updates), projects(id, status)').order('name')) as unknown as Client[]
    const inv = must(await supabase.from('invoices').select('client_id, status, total, amount_paid, due_date').eq('status', 'open')) as Inv[]
    const invites = admin ? (must(await supabase.from('invites').select('email, role')) as { email: string; role: string }[]) : []
    const users = admin ? (must(await supabase.from('profiles').select('email')) as { email: string }[]) : []
    return { clients, inv, invited: new Set(invites.map((i) => i.email.toLowerCase())), joined: new Set(users.map((u) => u.email.toLowerCase())) }
  }, [admin])
  const today = new Date().toISOString().slice(0, 10)
  const bal = useMemo(() => {
    const m = new Map<string, { open: number; late: number }>()
    for (const i of data?.inv ?? []) {
      const owed = Number(i.total) - Number(i.amount_paid ?? 0); if (owed <= 0) continue
      const b = m.get(i.client_id) ?? { open: 0, late: 0 }
      b.open += owed; if (i.due_date && i.due_date < today) b.late += owed
      m.set(i.client_id, b)
    }
    return m
  }, [data, today])
  const rows = (data?.clients ?? []).filter((c) => !q || `${c.name} ${c.client_contacts.map((x) => `${x.name} ${x.email}`).join(' ')}`.toLowerCase().includes(q.toLowerCase()))

  const saveClient = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form) return
    if (!form.name.trim()) return setErr('Enter the client name.')
    const people = form.contacts.filter((x) => x.name.trim() || x.email.trim())
    const noEmail = people.find((x) => !x.email.trim())
    if (noEmail) return setErr(`Add an email for ${noEmail.name.trim() || 'each person'}, or remove that row.`)
    const emails = people.map((x) => x.email.trim().toLowerCase())
    if (new Set(emails).size !== emails.length) return setErr('The same email is listed twice.')
    const row = { name: form.name.trim(), billing_email: form.billing_email.trim() || null, phone: form.phone.trim() || null, address: form.address.trim() || null }
    let clientId = form.id
    if (form.id) { const r = await supabase.from('clients').update(row).eq('id', form.id); if (r.error) return setErr(r.error.message) }
    else { const r = await supabase.from('clients').insert(row).select('id').single(); if (r.error) return setErr(r.error.message); clientId = (r.data as { id: string }).id }
    // contacts: remove the ones taken off the form, update the rest, add the new ones
    const before = form.id ? (data?.clients.find((c) => c.id === form.id)?.client_contacts ?? []) : []
    const kept = new Set(people.filter((x) => x.id).map((x) => x.id))
    const gone = before.filter((x) => !kept.has(x.id)).map((x) => x.id)
    if (gone.length) { const r = await supabase.from('client_contacts').delete().in('id', gone); if (r.error) return setErr(r.error.message) }
    for (const x of people) {
      const v = { name: x.name.trim() || null, email: x.email.trim().toLowerCase(), receives_invoices: x.receives_invoices, receives_updates: x.receives_updates }
      const r = x.id ? await supabase.from('client_contacts').update(v).eq('id', x.id) : await supabase.from('client_contacts').insert({ ...v, client_id: clientId })
      if (r.error) return setErr(r.error.message)
    }
    setErr(''); setForm(null); reload()
  }
  const invite = async (c: Client, x: Contact) => {
    setMsg(''); setErr('')
    const r = await supabase.from('invites').upsert({ email: x.email.toLowerCase(), role: 'client', full_name: x.name, client_id: c.id, invited_by: profile!.id })
    if (r.error) return setErr(r.error.message)
    setMsg(`${x.email} can now sign in to the client portal with that email address. Send them the portal link.`); reload()
  }

  return (
    <div className="stack">
      <div className="row between"><h1>Clients</h1>{<button className="btn" onClick={() => { setForm(form ? null : { ...blankClient, contacts: [blankContact()] }); setErr('') }}>{form ? 'Close' : '+ Add client'}</button>}</div>
      {form && (
        <form onSubmit={saveClient} className="card pad stack">
          <h2>{form.id ? 'Edit client' : 'Add client'}</h2>
          <div className="formgrid">
            <div style={{ gridColumn: 'span 2' }}><label className="l" htmlFor="c-n">Name</label><input id="c-n" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div style={{ gridColumn: 'span 2' }}><label className="l" htmlFor="c-e">Billing email</label><input id="c-e" type="email" className="input" value={form.billing_email} onChange={(e) => setForm({ ...form, billing_email: e.target.value })} /></div>
            <div><label className="l" htmlFor="c-p">Phone</label><input id="c-p" type="tel" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div style={{ gridColumn: 'span 3' }}><label className="l" htmlFor="c-a">Address</label><input id="c-a" className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          </div>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
            <legend className="l">People at this client</legend>
            {form.contacts.map((x, i) => {
              const set = (k: keyof FormContact, v: string | boolean) => setForm({ ...form, contacts: form.contacts.map((y, j) => (j === i ? { ...y, [k]: v } : y)) })
              return (
                <div key={x.id ?? 'n' + i} className="row" style={{ alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 200px' }}><label className="l" htmlFor={`fc-n${i}`}>Name</label><input id={`fc-n${i}`} className="input" value={x.name} onChange={(e) => set('name', e.target.value)} /></div>
                  <div style={{ flex: '1 1 240px' }}><label className="l" htmlFor={`fc-e${i}`}>Email</label><input id={`fc-e${i}`} type="email" className="input" value={x.email} onChange={(e) => set('email', e.target.value)} /></div>
                  <label className="row" style={{ gap: 6, fontSize: 14, minHeight: 44 }}><input type="checkbox" checked={x.receives_invoices} onChange={(e) => set('receives_invoices', e.target.checked)} style={{ width: 18, height: 18 }} /> Gets invoices</label>
                  <label className="row" style={{ gap: 6, fontSize: 14, minHeight: 44 }}><input type="checkbox" checked={x.receives_updates} onChange={(e) => set('receives_updates', e.target.checked)} style={{ width: 18, height: 18 }} /> Gets updates</label>
                  <span style={{ marginBottom: 5 }}><RowMenu label={`Actions for ${x.name || x.email || 'this person'}`} items={[{ label: 'Remove', danger: true, onSelect: () => setForm({ ...form, contacts: form.contacts.length > 1 ? form.contacts.filter((_, j) => j !== i) : [blankContact()] }) }]} /></span>
                </div>)
            })}
            <div><button type="button" className="btn small secondary" onClick={() => setForm({ ...form, contacts: [...form.contacts, blankContact()] })}>+ Add another person</button></div>
          </fieldset>
          {err && <p className="err" role="alert">{err}</p>}
          <div><button className="btn">Save client</button></div>
        </form>)}
      <div className="row between">
        <p className="muted" style={{ margin: 0 }}>{rows.length} clients · {money([...bal.values()].reduce((a, b) => a + b.open, 0))} open · <span style={{ color: 'var(--red, #b42318)' }}>{money([...bal.values()].reduce((a, b) => a + b.late, 0))} past due</span></p>
        <div style={{ width: 280, maxWidth: '100%' }}><label className="sr" htmlFor="cq">Search</label><input id="cq" className="input" placeholder="Search clients or contacts" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {msg && <p className="ok" role="status">{msg}</p>}
      {(error || (!form && err)) && <p className="err" role="alert">{error || err}</p>}
      <div className="card tablewrap">
        <table className="table" style={{ minWidth: 820 }}>
          <thead><tr><th>Client</th><th>Contacts</th><th className="r">Projects</th><th className="r">Open balance</th><th className="r">Past due</th><th></th></tr></thead>
          <tbody>
            {rows.map((c) => { const b = bal.get(c.id); const active = c.projects.filter((p) => p.status === 'active').length; const isOpen = open === c.id
              return [
                <tr key={c.id}>
                  <td><strong>{c.name}</strong>{c.billing_email && <div className="muted" style={{ fontSize: 13 }}>{c.billing_email}</div>}</td>
                  <td>{c.client_contacts.length ? c.client_contacts.map((x) => x.name || x.email).join(', ') : <span className="muted">None yet</span>}</td>
                  <td className="r num">{c.projects.length}{active > 0 && <span className="muted"> ({active} active)</span>}</td>
                  <td className="r num">{b?.open ? money(b.open) : <span className="muted">—</span>}</td>
                  <td className="r num">{b?.late ? <strong style={{ color: 'var(--red, #b42318)' }}>{money(b.late)}</strong> : <span className="muted">—</span>}</td>
                  <td><div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <button className="btn small secondary" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)}>{isOpen ? 'Hide' : 'Contacts'}</button>
                    {admin && <button className="btn small secondary" onClick={() => { setForm({ id: c.id, name: c.name, billing_email: c.billing_email ?? '', phone: c.phone ?? '', address: c.address ?? '',
                      contacts: c.client_contacts.length ? c.client_contacts.map((x) => ({ id: x.id, name: x.name ?? '', email: x.email, receives_invoices: x.receives_invoices, receives_updates: x.receives_updates })) : [blankContact()] }); setErr(''); window.scrollTo({ top: 0 }) }}>Edit</button>}
                  </div></td>
                </tr>,
                isOpen && <tr key={c.id + '-x'}><td colSpan={6} style={{ background: 'var(--bg-soft, #f7f6f1)' }}>
                  <Contacts client={c} admin={admin} invited={data!.invited} joined={data!.joined} onInvite={invite} onChange={reload} />
                </td></tr>,
              ] })}
            {data && rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}><em>No clients found.</em></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Contacts({ client, admin, invited, joined, onInvite, onChange }: { client: Client; admin: boolean; invited: Set<string>; joined: Set<string>; onInvite: (c: Client, x: Contact) => void; onChange: () => void }) {
  const [n, setN] = useState(''); const [e, setE] = useState(''); const [err, setErr] = useState('')
  const add = async (ev: React.FormEvent) => {
    ev.preventDefault(); if (!e.trim()) return setErr('Enter an email.')
    const r = await supabase.from('client_contacts').insert({ client_id: client.id, name: n.trim() || null, email: e.trim().toLowerCase() })
    if (r.error) return setErr(r.error.message)
    setN(''); setE(''); setErr(''); onChange()
  }
  const toggle = async (x: Contact, k: 'receives_invoices' | 'receives_updates') => { const r = await supabase.from('client_contacts').update({ [k]: !x[k] }).eq('id', x.id); setErr(r.error?.message ?? ''); onChange() }
  const del = async (x: Contact) => { const r = await supabase.from('client_contacts').delete().eq('id', x.id); setErr(r.error?.message ?? ''); onChange() }
  return (
    <div className="stack" style={{ padding: '8px 0' }}>
      {client.client_contacts.length > 0 && <table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Gets invoices</th><th>Gets updates</th><th>Portal</th>{admin && <th></th>}</tr></thead>
        <tbody>{client.client_contacts.map((x) => { const em = x.email.toLowerCase(); return (
          <tr key={x.id}>
            <td>{x.name || <span className="muted">—</span>}</td><td>{x.email}</td>
            <td><input type="checkbox" aria-label={`${x.email} gets invoices`} checked={x.receives_invoices} disabled={!admin} onChange={() => toggle(x, 'receives_invoices')} style={{ width: 18, height: 18 }} /></td>
            <td><input type="checkbox" aria-label={`${x.email} gets updates`} checked={x.receives_updates} disabled={!admin} onChange={() => toggle(x, 'receives_updates')} style={{ width: 18, height: 18 }} /></td>
            <td>{joined.has(em) ? <span className="badge b-paid">Signed in</span> : invited.has(em) ? <span className="badge b-sched">Invited</span> : admin ? <button className="btn small" onClick={() => onInvite(client, x)}>Invite to portal</button> : <span className="muted">Not invited</span>}</td>
            {admin && <td><RowMenu label={`Actions for ${x.email}`} items={[{ label: 'Remove', danger: true, onSelect: () => del(x) }]} /></td>}
          </tr>) })}</tbody>
      </table>}
      {admin && <form onSubmit={add} className="row" style={{ alignItems: 'flex-end' }}>
        <div><label className="l" htmlFor={`cn-${client.id}`}>Contact name</label><input id={`cn-${client.id}`} className="input" value={n} onChange={(ev) => setN(ev.target.value)} /></div>
        <div><label className="l" htmlFor={`ce-${client.id}`}>Email</label><input id={`ce-${client.id}`} type="email" className="input" required value={e} onChange={(ev) => setE(ev.target.value)} /></div>
        <button className="btn secondary">Add contact</button>
      </form>}
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  )
}

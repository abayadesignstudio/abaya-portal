import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import RowMenu, { type RowMenuItem } from '../components/RowMenu'
import { ClientsCard } from './Clients'
import ContactForm from '../components/ContactForm'
import { TRADES, contactName, type LibContact } from '../lib/contacts'

type P = { id: string; number: string; name: string; status?: string }
type Row = LibContact & {
  project_contacts: { trade: string; projects: P | null }[]
  client_contacts: { id: string; clients: { id: string; name: string; projects: P[] } | null }[]
}

/** Everyone the firm works with, one row per person. A person can belong to any number of clients and projects. */
export function ContactsCard() {
  const d = useLoad(async () => {
    const people = must(await supabase.from('contacts').select('*, project_contacts(trade, projects(id, number, name)), client_contacts(id, clients(id, name, projects(id, number, name, status)))').order('name')) as unknown as Row[]
    const clients = must(await supabase.from('clients').select('id, name').order('name')) as { id: string; name: string }[]
    return { people, clients }
  })
  const [q, setQ] = useState(''); const [trade, setTrade] = useState('')
  const [open, setOpen] = useState<null | 'new' | LibContact>(null); const [err, setErr] = useState('')
  const [addTo, setAddTo] = useState<Row | null>(null)
  const needle = q.trim().toLowerCase()
  const clientsOf = (c: Row) => c.client_contacts.map((x) => x.clients).filter((x): x is NonNullable<typeof x> => !!x)
  const rows = (d.data?.people ?? []).filter((c) => (!trade || (trade === 'Client' ? c.client_contacts.length > 0 || c.trade === 'Client' : c.trade === trade))
    && (!needle || [c.name, c.company, c.email, c.phone, c.trade, c.notes, ...clientsOf(c).map((x) => x.name)].some((x) => (x ?? '').toLowerCase().includes(needle))))
  const del = async (c: Row) => {
    const n = c.project_contacts.length + c.client_contacts.length
    if (!window.confirm(`Delete ${contactName(c)}?${n ? ' They’re also removed from every client and project they’re on.' : ''} Updates already logged stay. This can’t be undone.`)) return
    const { error } = await supabase.from('contacts').delete().eq('id', c.id); setErr(error?.message ?? ''); d.reload()
  }
  const unlinkClient = async (c: Row, linkId: string, client: string) => {
    if (!window.confirm(`Remove ${contactName(c)} from ${client}? They stop seeing ${client}’s projects and invoices in the portal, but stay in Contacts.`)) return
    const { error } = await supabase.from('client_contacts').delete().eq('id', linkId); setErr(error?.message ?? ''); d.reload()
  }
  return (
    <section className="card pad stack" aria-labelledby="ct-h">
      <div className="row between"><h2 id="ct-h" style={{ margin: 0 }}>Contacts</h2>{!open && <button className="btn small" onClick={() => setOpen('new')}>+ Add contact</button>}</div>
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Everyone you work with, stored once. A person can be on any number of clients, and on projects as a trade or consultant.</p>
      {open && <section className="stack pc-form"><h3 style={{ margin: 0 }}>{open === 'new' ? 'New contact' : `Edit ${contactName(open)}`}</h3>
        {open !== 'new' && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Changes show on every client and project this person is on.</p>}
        <ContactForm key={open === 'new' ? 'new' : open.id} edit={open === 'new' ? null : open} onCancel={() => setOpen(null)} onSaved={() => { setOpen(null); d.reload() }} /></section>}
      {addTo && <AddToClient person={addTo} clients={(d.data?.clients ?? []).filter((x) => !clientsOf(addTo).some((y) => y.id === x.id))} onClose={() => setAddTo(null)} onDone={() => { setAddTo(null); d.reload() }} />}
      <div className="row" style={{ gap: 8 }}>
        <label className="sr" htmlFor="cl-q">Search contacts</label>
        <input id="cl-q" className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Search name, company, client, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="sr" htmlFor="cl-t">Type</label>
        <select id="cl-t" className="input" style={{ width: 'auto' }} value={trade} onChange={(e) => setTrade(e.target.value)}><option value="">Everyone</option>{TRADES.map((t) => <option key={t} value={t}>{t === 'Client' ? 'Clients' : t}</option>)}</select>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="tablewrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Email / phone</th><th>Clients &amp; projects</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => {
              const cls = clientsOf(c)
              const projs = new Map<string, P>()
              for (const x of c.project_contacts) if (x.projects) projs.set(x.projects.id, x.projects)
              for (const cl of cls) for (const p of cl.projects ?? []) if (p.status !== 'complete') projs.set(p.id, p)
              const items: RowMenuItem[] = [{ label: 'Edit', onSelect: () => { setOpen(c); window.scrollTo({ top: 0 }) } },
                { label: 'Add to a client…', disabled: !c.email, hint: c.email ? undefined : 'Add an email first', onSelect: () => setAddTo(c) },
                ...c.client_contacts.filter((x) => x.clients).map((x) => ({ label: `Remove from ${x.clients!.name}`, onSelect: () => unlinkClient(c, x.id, x.clients!.name) })),
                'divider', { label: 'Delete', danger: true, onSelect: () => del(c) }]
              return <tr key={c.id}>
                <td><strong>{c.name || c.company || c.email}</strong><div className="muted" style={{ fontSize: 12.5 }}>{[c.name ? c.company : null, c.trade].filter(Boolean).join(' · ')}</div>
                  {c.notes && <div className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>{c.notes}</div>}</td>
                <td style={{ fontSize: 13.5 }}>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span className="muted">—</span>}{c.phone && <div><a href={`tel:${c.phone}`}>{c.phone}</a></div>}</td>
                <td style={{ fontSize: 13 }}>{cls.map((x) => <div key={x.id} style={{ fontWeight: 700 }}>{x.name}</div>)}
                  {projs.size > 0 && <div style={{ marginTop: 3 }}>{[...projs.values()].map((x) => <Link key={x.id} to={`/projects/${x.id}`} state={{ tab: 'contacts' }} className="pill" style={{ marginRight: 4, display: 'inline-block', marginBottom: 3 }} title={x.name}>{x.number}</Link>)}</div>}
                  {!cls.length && !projs.size && <span className="muted">—</span>}</td>
                <td><RowMenu label={`Actions for ${contactName(c)}`} items={items} /></td>
              </tr>
            })}
            {d.data && rows.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 24 }}><em>{d.data.people.length ? 'No contacts match.' : 'No contacts yet.'}</em></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Clients/Contacts: clients on the left, everyone you work with on the right. */
export default function ClientsContacts() {
  return <div className="stack">
    <h1>Clients/Contacts</h1>
    <div className="cc-split"><ClientsCard /><ContactsCard /></div>
  </div>
}

function AddToClient({ person, clients, onClose, onDone }: { person: Row; clients: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [cid, setCid] = useState(''); const [inv, setInv] = useState(true); const [upd, setUpd] = useState(true); const [err, setErr] = useState('')
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); if (!cid) return setErr('Choose a client.')
    const { error } = await supabase.from('client_contacts').insert({ client_id: cid, contact_id: person.id, email: person.email, name: person.name, phone: person.phone, receives_invoices: inv, receives_updates: upd })
    if (error) return setErr(/duplicate|unique/.test(error.message) ? 'They’re already on that client.' : error.message)
    onDone()
  }
  return (
    <div className="cs-modal" role="dialog" aria-modal="true" aria-labelledby="atc-h" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={go} className="card pad stack cs-modal-box">
        <h2 id="atc-h">Add {contactName(person)} to a client</h2>
        <div><label className="l" htmlFor="atc-c">Client</label><select id="atc-c" className="input" value={cid} onChange={(e) => setCid(e.target.value)} autoFocus>
          <option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={inv} onChange={(e) => setInv(e.target.checked)} style={{ width: 18, height: 18 }} /> Gets invoices</label>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={upd} onChange={(e) => setUpd(e.target.checked)} style={{ width: 18, height: 18 }} /> Gets project updates</label>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>They’ll be able to see this client’s projects once invited to the portal (Clients tab or the project’s Contacts tab).</p>
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div className="row" style={{ gap: 8 }}><button className="btn">Add</button><button type="button" className="btn secondary" onClick={onClose}>Cancel</button></div>
      </form>
    </div>
  )
}

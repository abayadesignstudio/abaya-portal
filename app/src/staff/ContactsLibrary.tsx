import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import RowMenu from '../components/RowMenu'
import ContactForm from '../components/ContactForm'
import { TRADES, contactName, type LibContact } from '../lib/contacts'

type Row = LibContact & { project_contacts: { trade: string; projects: { id: string; number: string; name: string } | null }[] }

/** The contact library: GCs, engineers, consultants and vendors, stored once and added to projects from here. */
export default function ContactsLibrary() {
  const d = useLoad(async () => must(await supabase.from('contacts').select('*, project_contacts(trade, projects(id, number, name))').order('company').order('name')) as unknown as Row[])
  const [q, setQ] = useState(''); const [trade, setTrade] = useState('')
  const [open, setOpen] = useState<null | 'new' | LibContact>(null); const [err, setErr] = useState('')
  const needle = q.trim().toLowerCase()
  const rows = (d.data ?? []).filter((c) => (!trade || c.trade === trade) && (!needle || [c.name, c.company, c.email, c.phone, c.trade, c.notes].some((x) => (x ?? '').toLowerCase().includes(needle))))
  const del = async (c: Row) => {
    const n = c.project_contacts.length
    if (!window.confirm(`Delete ${contactName(c)} from the library?${n ? ` They’re also removed from ${n} project${n === 1 ? '' : 's'}.` : ''} Updates already logged stay. This can’t be undone.`)) return
    const { error } = await supabase.from('contacts').delete().eq('id', c.id); setErr(error?.message ?? ''); d.reload()
  }
  return (
    <div className="stack">
      <div className="row between"><h1>Contacts</h1>{!open && <button className="btn" onClick={() => setOpen('new')}>+ Add contact</button>}</div>
      <p className="muted" style={{ margin: 0 }}>Everyone you work with besides clients — contractors, engineers, consultants, vendors. Add them to a project from its Contacts tab. Client contacts live under <Link to="/clients">Clients</Link>.</p>
      {open && <section className="card pad stack"><h2 style={{ margin: 0 }}>{open === 'new' ? 'New contact' : `Edit ${contactName(open)}`}</h2>
        <ContactForm key={open === 'new' ? 'new' : open.id} edit={open === 'new' ? null : open} onCancel={() => setOpen(null)} onSaved={() => { setOpen(null); d.reload() }} /></section>}
      <div className="row" style={{ gap: 8 }}>
        <label className="sr" htmlFor="cl-q">Search contacts</label>
        <input id="cl-q" className="input" style={{ flex: 1, minWidth: 220 }} placeholder="Search name, company, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="sr" htmlFor="cl-t">Trade</label>
        <select id="cl-t" className="input" style={{ width: 'auto' }} value={trade} onChange={(e) => setTrade(e.target.value)}><option value="">All trades</option>{TRADES.map((t) => <option key={t}>{t}</option>)}</select>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <section className="card" style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 860 }}>
          <thead><tr><th>Name</th><th>Company</th><th>Trade</th><th>Email</th><th>Phone</th><th>Projects</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => <tr key={c.id}>
              <td><strong>{c.name ?? '—'}</strong>{c.notes && <div className="muted" style={{ fontSize: 12.5 }}>{c.notes}</div>}</td><td>{c.company ?? '—'}</td><td>{c.trade}</td>
              <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</td><td>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : '—'}</td>
              <td>{c.project_contacts.filter((x) => x.projects).map((x) => <Link key={x.projects!.id} to={`/projects/${x.projects!.id}`} state={{ tab: 'contacts' }} className="pill" style={{ marginRight: 4 }} title={`${x.projects!.name} · ${x.trade}`}>{x.projects!.number}</Link>)}
                {c.project_contacts.length === 0 && <span className="muted">—</span>}</td>
              <td><RowMenu label={`Actions for ${contactName(c)}`} items={[{ label: 'Edit', onSelect: () => { setOpen(c); window.scrollTo({ top: 0 }) } }, { label: 'Delete', danger: true, onSelect: () => del(c) }]} /></td>
            </tr>)}
            {d.data && rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}><em>{d.data.length ? 'No contacts match.' : 'No contacts yet.'}</em></td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}

import { useState } from 'react'
import { TRADES, blankContact, saveContact, type LibContact } from '../lib/contacts'

/** Add or edit a contact in the library. */
export default function ContactForm({ edit, onSaved, onCancel, saveLabel }: { edit?: LibContact | null; onSaved: (c: LibContact) => void; onCancel: () => void; saveLabel?: string }) {
  const [f, setF] = useState<Omit<LibContact, 'id'>>(edit ? { ...edit, name: edit.name ?? '', company: edit.company ?? '', email: edit.email ?? '', phone: edit.phone ?? '', notes: edit.notes ?? '' } : blankContact())
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { onSaved(await saveContact({ ...f, id: edit?.id })) } catch (x) { setErr((x as Error).message) }
    setBusy(false)
  }
  const id = edit?.id ?? 'new'
  return (
    <form onSubmit={submit} className="stack pc-form">
      <div className="pc-grid">
        <div><label className="l" htmlFor={`cf-n-${id}`}>Name</label><input id={`cf-n-${id}`} className="input" value={f.name ?? ''} onChange={set('name')} autoFocus /></div>
        <div><label className="l" htmlFor={`cf-c-${id}`}>Company</label><input id={`cf-c-${id}`} className="input" value={f.company ?? ''} onChange={set('company')} /></div>
        <div><label className="l" htmlFor={`cf-t-${id}`}>Trade</label><select id={`cf-t-${id}`} className="input" value={f.trade} onChange={set('trade')}>
          {[...new Set([...TRADES, f.trade])].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label className="l" htmlFor={`cf-e-${id}`}>Email</label><input id={`cf-e-${id}`} type="email" className="input" value={f.email ?? ''} onChange={set('email')} /></div>
        <div><label className="l" htmlFor={`cf-p-${id}`}>Phone</label><input id={`cf-p-${id}`} type="tel" className="input" value={f.phone ?? ''} onChange={set('phone')} /></div>
        <div><label className="l" htmlFor={`cf-o-${id}`}>Notes</label><input id={`cf-o-${id}`} className="input" value={f.notes ?? ''} onChange={set('notes')} /></div>
      </div>
      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className="row"><button className="btn" disabled={busy}>{busy ? 'Saving…' : saveLabel ?? (edit ? 'Save' : 'Add to library')}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button></div>
    </form>
  )
}

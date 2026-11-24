import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import RowMenu from '../components/RowMenu'

type Note = { id: string; body: string; created_by: string | null; created_at: string; updated_at: string | null; profiles: { full_name: string | null } | null }

/** Internal notes on an agreement. Stored in their own staff-only table, never in the agreement,
 *  so they don't reach the client portal, the PDF or the signed record. */
export default function AgreementNotes({ agreementId }: { agreementId: string }) {
  const { profile } = useAuth()
  const admin = profile?.role === 'admin'
  const notes = useLoad(async () => must(await supabase.from('agreement_notes').select('id, body, created_by, created_at, updated_at, profiles(full_name)')
    .eq('agreement_id', agreementId).order('created_at', { ascending: true })) as unknown as Note[], [agreementId])
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const add = async () => {
    if (!text.trim() || !profile) return
    setBusy(true); setErr('')
    const { error } = await supabase.from('agreement_notes').insert({ agreement_id: agreementId, body: text.trim(), created_by: profile.id })
    setBusy(false)
    if (error) return setErr(error.message)
    setText(''); notes.reload()
  }
  const saveEdit = async () => {
    if (!editing || !editing.body.trim()) return
    const { error } = await supabase.from('agreement_notes').update({ body: editing.body.trim(), updated_at: new Date().toISOString() }).eq('id', editing.id)
    if (error) return setErr(error.message)
    setEditing(null); notes.reload()
  }
  const remove = async (n: Note) => {
    if (!window.confirm('Delete this note? This can’t be undone.')) return
    const { error } = await supabase.from('agreement_notes').delete().eq('id', n.id)
    if (error) return setErr(error.message)
    notes.reload()
  }
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const list = notes.data ?? []
  return <div className="ag-tool">
    <span className="l">Internal notes{list.length ? ` (${list.length})` : ''}</span>
    <span className="muted" style={{ fontSize: 12 }}>🔒 Team only. Never shown to the client, in the portal or the PDF.</span>
    {notes.error && <p className="err" style={{ margin: 0 }}>{notes.error}</p>}
    {list.length > 0 && <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map((n) => { const mine = n.created_by === profile?.id
        return <li key={n.id} style={{ background: '#fffbea', border: '1px solid #f1e3a4', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>
          <div className="row between" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}><strong style={{ color: 'var(--ink, #222)' }}>{n.profiles?.full_name ?? 'Team'}</strong> · {when(n.created_at)}{n.updated_at ? ' · edited' : ''}</span>
            {(mine || admin) && <RowMenu label="Note actions" items={[...(mine ? [{ label: 'Edit', onSelect: () => setEditing({ id: n.id, body: n.body }) }, 'divider' as const] : []), { label: 'Delete', danger: true, onSelect: () => remove(n) }]} />}
          </div>
          {editing?.id === n.id
            ? <div className="stack" style={{ gap: 6, marginTop: 4 }}>
                <label className="sr" htmlFor={'an-e-' + n.id}>Edit note</label>
                <textarea id={'an-e-' + n.id} className="input" rows={3} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                <div className="row" style={{ gap: 6 }}><button type="button" className="btn small" onClick={saveEdit}>Save</button><button type="button" className="linkbtn" onClick={() => setEditing(null)}>Cancel</button></div></div>
            : <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{n.body}</p>}
        </li> })}</ul>}
    <label className="sr" htmlFor="an-new">New internal note</label>
    <textarea id="an-new" className="input" rows={2} placeholder="e.g. Client asked to hold SD until CE is approved by the city" value={text} onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add() }} />
    <div><button type="button" className="btn small secondary" disabled={busy || !text.trim()} onClick={add}>{busy ? 'Adding…' : 'Add note'}</button></div>
    {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
  </div>
}

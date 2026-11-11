import { useLoad } from '../lib/useQuery'
import { supabase } from '../lib/supabase'

/** Add someone already in Contacts to a client. */
export default function PickPerson({ clientId, exclude, onAdded }: { clientId: string; exclude: string[]; onAdded: () => void }) {
  const lib = useLoad(async () => ((await supabase.from('contacts').select('id, name, company, email, phone').not('email', 'is', null).order('name')).data ?? []) as { id: string; name: string | null; company: string | null; email: string; phone: string | null }[])
  const ex = new Set(exclude.map((e) => e.toLowerCase()))
  const list = (lib.data ?? []).filter((c) => !ex.has(c.email.toLowerCase()))
  if (!list.length) return null
  return <div><label className="l" htmlFor={`pp-${clientId}`}>Or add from Contacts</label>
    <select id={`pp-${clientId}`} className="input" value="" onChange={async (e) => { const c = list.find((x) => x.id === e.target.value); if (!c) return
      const { error } = await supabase.from('client_contacts').insert({ client_id: clientId, contact_id: c.id, email: c.email, name: c.name, phone: c.phone })
      if (!error) onAdded() }}>
      <option value="">Choose a person…</option>{list.map((c) => <option key={c.id} value={c.id}>{c.name || c.email}{c.company ? ` · ${c.company}` : ''}</option>)}</select></div>
}

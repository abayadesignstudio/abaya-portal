import { supabase } from '../lib/supabase'

/** A client contact's phone number, edited in place (saved when you leave the field). */
export default function PhoneCell({ id, value, label, onSaved }: { id: string; value: string | null; label: string; onSaved?: () => void }) {
  return <input type="tel" className="input" style={{ minWidth: 130, minHeight: 34 }} aria-label={label} placeholder="Add phone" defaultValue={value ?? ''}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    onBlur={async (e) => { const v = e.target.value.trim() || null; if (v === (value ?? null)) return; await supabase.from('client_contacts').update({ phone: v }).eq('id', id); onSaved?.() }} />
}

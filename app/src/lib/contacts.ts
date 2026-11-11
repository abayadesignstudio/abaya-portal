import { supabase } from './supabase'

/** Contact library: people the firm works with, stored once and linked to projects. */
export type LibContact = { id: string; name: string | null; company: string | null; trade: string; email: string | null; phone: string | null; notes: string | null }
export const TRADES = ['General Contractor', 'Structural Engineer', 'MEP Engineer', 'Civil Engineer', 'Landscape Architect', 'Interior Designer', 'Surveyor',
  'Geotechnical Engineer', 'Consultant', 'Owner’s Rep', 'Vendor', 'Other']
export const contactName = (c: Pick<LibContact, 'name' | 'company'>) => c.name || c.company || '—'
export const blankContact = (): Omit<LibContact, 'id'> => ({ name: '', company: '', trade: 'General Contractor', email: '', phone: '', notes: '' })

/** Save a library contact (new when no id). Returns the saved row. */
export async function saveContact(c: Omit<LibContact, 'id'> & { id?: string }): Promise<LibContact> {
  const row = { name: c.name?.trim() || null, company: c.company?.trim() || null, trade: c.trade || 'Other', email: c.email?.trim().toLowerCase() || null,
    phone: c.phone?.trim() || null, notes: c.notes?.trim() || null }
  if (!row.name && !row.company) throw new Error('Add a name or a company.')
  const q = c.id ? supabase.from('contacts').update(row).eq('id', c.id) : supabase.from('contacts').insert(row)
  const { data, error } = await q.select('*').single()
  if (error) throw new Error(/contacts_email_unique/.test(error.message) ? 'A contact with that email is already in the library.' : error.message)
  return data as LibContact
}

/** After someone with an email joins a project: pull the last 90 days of email with them into Updates (background). */
export const backfillEmail = (email: string | null | undefined) => {
  const e = (email ?? '').trim().toLowerCase()
  if (e) supabase.functions.invoke('email-sync', { body: { only: [e], days: 90 } }).catch(() => {})
}

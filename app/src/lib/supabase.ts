import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
  { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } },
)

export type Role = 'admin' | 'staff' | 'client' | 'none'
export type Profile = {
  id: string; email: string; full_name: string | null; initials: string | null; title: string | null
  role: Role; client_id: string | null; util_target: number | null; bill_rate: number | null
  avatar_url?: string | null
}

export const money = (n: number | string | null | undefined) =>
  (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export const SECTOR_COLOR: Record<string, string> = {
  commercial: '#2b5c8a', residential: '#a32d2d', medical: '#2e7d4f', consultation: '#6b7280', civic: '#5b4b8a', internal: '#02253d',
}
export const PHASES = [
  ['CE', 'Conceptual / Exploratory'], ['SD', 'Schematic Design'], ['DD', 'Design Development'], ['CD', 'Construction Documents'],
  ['BN', 'Bidding & Negotiation'], ['PM', 'Permitting'], ['CA', 'Construction Administration'],
] as const
export const PHASE_NAME = Object.fromEntries(PHASES) as Record<string, string>
/** Display name for a phase row: additional-service lines (code AS) carry their own name. */
export const phaseLabel = (p: { code: string; name?: string | null }) => p.name || (p.code === 'AS' ? 'Additional service' : p.code === 'CU' ? 'Custom phase' : PHASE_NAME[p.code] ?? p.code)
export const CATEGORY_NAME: Record<string, string> = { S: 'Shell', FO: 'Interior Finish-Out', CON: 'Consultation' }

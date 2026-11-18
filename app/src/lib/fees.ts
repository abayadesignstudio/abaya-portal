// Project fee = the fees of the agreements linked to the project (all except voided ones, added together).
// Each phase's fee is either a fixed amount, or a percentage of that total (phases.fee_pct). phases.fee always holds
// the dollar amount, so invoices and budgets read one number; syncPctPhases keeps it in step with the total.
import { supabase } from './supabase'

export type LinkedAgreement = { id: string; title: string; status: string; total_fee: number | null; ph: Record<string, { on?: boolean }> | null; pay: { phase?: string; pct?: string }[] | null }
export const round2 = (n: number) => Math.round(n * 100) / 100

export async function linkedAgreements(projectId: string) {
  const { data, error } = await supabase.from('agreements').select('id, title, status, total_fee, ph:doc->ph, pay:doc->pay').eq('project_id', projectId).neq('status', 'void').order('created_at')
  if (error) throw error
  return (data ?? []) as unknown as LinkedAgreement[]
}
export const contractFee = (ags: LinkedAgreement[]) => ags.length ? round2(ags.reduce((a, g) => a + Number(g.total_fee ?? 0), 0)) : null

/** Re-price percentage phases of a project from its agreements' total. Returns how many phases changed. */
export async function syncPctPhases(projectId: string, total?: number | null) {
  const t = total === undefined ? contractFee(await linkedAgreements(projectId)) : total
  if (t === null) return 0
  const { data } = await supabase.from('phases').select('id, fee, fee_pct').eq('project_id', projectId).not('fee_pct', 'is', null)
  let n = 0
  for (const ph of (data ?? []) as { id: string; fee: number; fee_pct: number }[]) {
    const fee = round2(t * Number(ph.fee_pct) / 100)
    if (Math.abs(fee - Number(ph.fee)) >= 0.005) { await supabase.from('phases').update({ fee }).eq('id', ph.id); n++ }
  }
  return n
}

/** Billing multiplier: billable rate = pay × MULTIPLIER, so pay = billed ÷ MULTIPLIER and the rest is overhead & profit. */
export const MULTIPLIER = 2

const PHASE_BY_NAME: Record<string, string> = { 'conceptual / exploratory': 'CE', 'schematic design': 'SD', 'design development': 'DD', 'construction documents': 'CD',
  'bidding & negotiation': 'BN', 'bidding and negotiation': 'BN', permitting: 'PM', 'construction administration': 'CA' }
/** True when the agreement's payment schedule is one payment per phase — then it sets the phase fees (database trigger 0060). */
export const perPhaseSchedule = (g: LinkedAgreement) => !!g.pay?.length && g.pay.every((x) => PHASE_BY_NAME[String(x.phase ?? '').trim().toLowerCase()])

// Project fee = the fees of the agreements linked to the project (all except voided ones, added together).
// Each phase's fee is either a fixed amount, or a percentage of that total (phases.fee_pct). phases.fee always holds
// the dollar amount, so invoices and budgets read one number; syncPctPhases keeps it in step with the total.
import { supabase } from './supabase'

export type LinkedAgreement = { id: string; title: string; status: string; total_fee: number | null; ph: Record<string, { on?: boolean }> | null }
export const round2 = (n: number) => Math.round(n * 100) / 100

export async function linkedAgreements(projectId: string) {
  const { data, error } = await supabase.from('agreements').select('id, title, status, total_fee, ph:doc->ph').eq('project_id', projectId).neq('status', 'void').order('created_at')
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

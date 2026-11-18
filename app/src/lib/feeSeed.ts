// A saved fee calculation (fee triangulator) → what a proposal starts from: the average fee, the area and the phase split.
import { supabase, PHASES } from './supabase'

export type FeeSeed = { name: string; fee: number; sf: number; split: [string, number][]; projectId?: string; auto?: boolean; estimateId?: string }
export type Estimate = { id: string; name: string; project_id: string | null; updated_at: string; hourly_fee: number | null; sf_fee: number | null; pct_fee: number | null
  inputs: { sf?: string; split?: Record<string, string>; projectId?: string } }

const DEFAULT_SPLIT: Record<string, number> = { CE: 0, SD: 15, DD: 20, CD: 40, BN: 5, PM: 0, CA: 20 }
const num = (s: unknown) => { const n = parseFloat(String(s ?? '').replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : 0 }
export const estimateAvg = (x: Pick<Estimate, 'hourly_fee' | 'sf_fee' | 'pct_fee'>) => {
  const v = [x.hourly_fee, x.sf_fee, x.pct_fee].map(Number).filter((n) => n > 0)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
}
export function seedFromEstimate(x: Estimate): FeeSeed | null {
  const fee = Math.round(estimateAvg(x))
  if (!fee) return null
  let split = PHASES.map(([c]) => [c, num(x.inputs?.split?.[c] ?? DEFAULT_SPLIT[c])] as [string, number])
  if (Math.abs(split.reduce((a, [, v]) => a + v, 0) - 100) > 0.01) split = PHASES.map(([c]) => [c, DEFAULT_SPLIT[c]] as [string, number])
  return { name: x.name, fee, sf: num(x.inputs?.sf), split: split.filter(([, v]) => v > 0), projectId: x.project_id ?? undefined, estimateId: x.id }
}
/** The project's most recently edited saved fee, if any. */
export async function projectEstimates(projectId: string) {
  const { data, error } = await supabase.from('fee_estimates').select('id, name, project_id, updated_at, hourly_fee, sf_fee, pct_fee, inputs')
    .eq('project_id', projectId).order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Estimate[]
}

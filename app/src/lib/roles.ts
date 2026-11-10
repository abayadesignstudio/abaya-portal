import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { ROLES } from './time'

/** The firm's roles and rates, from Settings → Billable rates (cached for the session; refreshed when rates change). */
export type RateRow = { role: string; level: string; rate: number }
let cache: RateRow[] | null = null
let loading: Promise<RateRow[]> | null = null
const subs = new Set<(r: RateRow[]) => void>()
export function reloadRates() {
  loading = (async () => {
    const { data } = await supabase.from('billing_rates').select('role, level, rate, sort').order('sort', { nullsFirst: false }).order('role')
    cache = ((data ?? []) as (RateRow & { sort: number })[]).map((r) => ({ role: r.role, level: r.level, rate: Number(r.rate) }))
    subs.forEach((f) => f(cache!))
    return cache
  })()
  return loading
}
export function useRates(): RateRow[] {
  const [r, setR] = useState<RateRow[]>(cache ?? [])
  useEffect(() => { subs.add(setR); if (!cache && !loading) reloadRates(); else if (cache) setR(cache); return () => { subs.delete(setR) } }, [])
  return r
}
/** Role names in the order set in Settings (falls back to the three standard roles before rates load). */
export function useRoles(): string[] {
  const r = useRates()
  const names = [...new Set(r.map((x) => x.role))]
  return names.length ? names : [...ROLES]
}
/** The hourly rate a time entry should carry for a role: none (= the person's own rate) when it's their own role,
 *  otherwise that role's rate, so e.g. consulting time is billed at the consulting rate. */
export function rateForRole(role: string, myTitle: string | null | undefined, rates: RateRow[]): string {
  if (!role || role === myTitle) return ''
  const r = rates.find((x) => x.role === role)
  return r ? String(r.rate) : ''
}

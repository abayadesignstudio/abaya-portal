// Shared hour math for Home and Employees
export const AVAILABLE_HRS = 1920 // 2,080 less 10 holidays and 10 PTO days
export const yearFraction = (d = new Date()) => {
  const start = new Date(d.getFullYear(), 0, 1)
  return Math.min(1, (d.getTime() - start.getTime()) / 86400000 / 365)
}
export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
export function workload(utilTarget: number | null, minutesTotal: number, minutesBillable: number) {
  const util = Number(utilTarget ?? 0)
  const target = AVAILABLE_HRS * util / 100
  const frac = yearFraction()
  const pace = target * frac
  const bill = minutesBillable / 60
  const logged = minutesTotal / 60
  const actual = AVAILABLE_HRS * frac ? Math.round(bill / (AVAILABLE_HRS * frac) * 100) : 0
  return { util, target, pace, bill, logged, nonbill: logged - bill, actual, diff: bill - pace, left: Math.max(0, target - bill),
    fillPct: target ? Math.min(100, bill / target * 100) : 0, pacePct: target ? Math.min(100, pace / target * 100) : 0 }
}
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const parseDate = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }
export const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, PHASES } from './supabase'
import { useLoad, must } from './useQuery'
import type { FeeSeed } from './feeSeed'

/** The fee calculator's state, maths and autosave, shared by the desktop triangulator and the phone screen.
 *  Inputs are also kept on this device so they're still there when you come back. */

export type Person = { id: string; full_name: string | null; bill_rate: number | null }
export type HourRow = { key: string; profile_id: string; hours: string; rate: string }
export type Saved = { id: string; name: string; project_id: string | null; inputs: State; median_fee: number | null; hourly_fee: number | null; sf_fee: number | null; pct_fee: number | null; created_at: string; updated_at: string }
export type State = { rows: HourRow[]; sf: string; perSf: string; costPerSf: string; pct: string; split: Record<string, string>; projectId?: string }

const KEY = 'abaya.feeTriangulator'
export const newRow = (): HourRow => ({ key: Math.random().toString(36).slice(2), profile_id: '', hours: '', rate: '' })
/** Starting split of the fee across phases (AIA-style); 0 leaves a phase out. */
export const DEFAULT_SPLIT: Record<string, string> = { CE: '0', SD: '15', DD: '20', CD: '40', BN: '5', PM: '0', CA: '20' }
export const EMPTY: State = { rows: [newRow()], sf: '', perSf: '', costPerSf: '', pct: '', split: DEFAULT_SPLIT }
const load = (): State => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && Array.isArray(s.rows) ? { ...EMPTY, ...s, split: { ...DEFAULT_SPLIT, ...(s.split ?? {}) } } : EMPTY } catch { return EMPTY } }
/** Anything typed in yet? (an untouched blank calculator isn't saved) */
const hasInput = (st: State) => st.rows.some((r) => r.profile_id || r.hours.trim() || r.rate.trim()) || !!(st.sf.trim() || st.perSf.trim() || st.costPerSf.trim() || st.pct.trim())
export const untitledName = () => { const d = new Date(); return `Untitled — ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` }
const snap = (st: State, nm: string) => JSON.stringify([st.rows.map(({ key: _k, ...r }) => { void _k; return r }), st.sf, st.perSf, st.costPerSf, st.pct, st.split, st.projectId ?? '', nm.trim()])
export const num = (s: string) => { const n = parseFloat(String(s).replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : 0 }
const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 }
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
export const vsAvg = (v: number, m: number) => { if (!m || !v) return ''; const d = (v - m) / m * 100; return Math.abs(d) < 0.5 ? 'at average' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}% vs average` }
/** A saved fee's average, from the three method fees stored with it. */
export const savedAvg = (x: { hourly_fee: number | null; sf_fee: number | null; pct_fee: number | null }) => mean([x.hourly_fee, x.sf_fee, x.pct_fee].map(Number).filter((v) => v > 0))

export function useFeeCalc() {
  const people = useLoad(async () => must(await supabase.from('profiles').select('id, full_name, bill_rate').in('role', ['admin', 'staff']).order('full_name')) as Person[])
  const [s, setS] = useState<State>(load)
  const projects = useLoad(async () => must(await supabase.from('projects').select('id, number, name').neq('number', 'OH').neq('status', 'complete').order('number', { ascending: false })) as { id: string; number: string; name: string }[])
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ } }, [s])
  const set = (patch: Partial<State>) => setS((o) => ({ ...o, ...patch }))
  // saved triangulations (firm-wide, in the database), listed by year on the right
  const saved = useLoad(async () => must(await supabase.from('fee_estimates').select('id, name, project_id, inputs, median_fee, hourly_fee, sf_fee, pct_fee, created_at, updated_at').order('created_at', { ascending: false })) as Saved[])
  const [cur, setCur] = useState<{ id: string; name: string } | null>(() => { try { return JSON.parse(localStorage.getItem(KEY + '.cur') || 'null') } catch { return null } })
  useEffect(() => { try { localStorage.setItem(KEY + '.cur', JSON.stringify(cur)) } catch { /* private mode */ } }, [cur])
  const [name, setName] = useState(cur?.name ?? '')
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3000); return () => clearTimeout(t) }, [msg])
  const years = useMemo(() => [...new Set((saved.data ?? []).map((x) => new Date(x.created_at).getFullYear()))].sort((a, b) => b - a), [saved.data])
  const [year, setYear] = useState<number | null>(null)
  const shownYear = year ?? years[0] ?? new Date().getFullYear()
  const inYear = (saved.data ?? []).filter((x) => new Date(x.created_at).getFullYear() === shownYear)
  const setRow = (key: string, patch: Partial<HourRow>) => setS((o) => ({ ...o, rows: o.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }))
  const pickPerson = (key: string, id: string) => {
    const p = people.data?.find((x) => x.id === id)
    setRow(key, { profile_id: id, rate: p?.bill_rate != null ? String(Number(p.bill_rate)) : '' })
  }

  const hourly = s.rows.reduce((a, r) => a + num(r.hours) * num(r.rate), 0)
  const hours = s.rows.reduce((a, r) => a + num(r.hours), 0)
  const bySf = num(s.sf) * num(s.perSf)
  // construction cost = area × construction cost per SF (the area is shared with corner 2)
  const cost = num(s.sf) * num(s.costPerSf)
  const byPct = cost * num(s.pct) / 100
  const fees = [hourly, bySf, byPct]
  const filled = fees.filter((f) => f > 0)
  const med = filled.length ? median(filled) : 0
  const avg = mean(filled)
  const lo = filled.length ? Math.min(...filled) : 0, hi = filled.length ? Math.max(...filled) : 0
  const spread = avg && filled.length > 1 ? (hi - lo) / avg * 100 : 0

  // phase split of the average fee
  const splitPct = PHASES.map(([c]) => [c, num(s.split[c] ?? '0')] as const)
  const splitTotal = splitPct.reduce((a, [, v]) => a + v, 0)
  const setSplit = (c: string, v: string) => setS((o) => ({ ...o, split: { ...o.split, [c]: v } }))
  // Create agreement: hands the average fee, the area and the phase split to the New proposal card below,
  // where the project is chosen (every agreement belongs to a project); the rest is filled in on the agreement.
  const splitOk = Math.abs(splitTotal - 100) < 0.01
  /** The fee to hand to a proposal, or a reason it can't go yet. */
  const seed = (): FeeSeed | string => {
    if (!avg) return 'Fill in at least one fee method first.'
    if (!splitOk) return 'The phase percentages need to add up to 100% before creating an agreement.'
    return { name: name.trim(), fee: Math.round(avg), sf: num(s.sf), split: splitPct.filter(([, v]) => v > 0).map(([c, v]) => [c, v]), projectId: s.projectId || undefined, estimateId: cur?.id }
  }
  const payload = () => ({ name: name.trim(), inputs: s, project_id: s.projectId || null, hourly_fee: hourly || null, sf_fee: bySf || null, pct_fee: byPct || null, median_fee: med || null, updated_at: new Date().toISOString() })
  // ── Autosave: every calculation is kept in Saved fees as you type (unnamed ones get "Untitled — date, time").
  const [saveState, setSaveState] = useState<'' | 'saving' | 'saved'>('')
  const baseline = useRef<string | null>(null) // inputs as last loaded/saved; changes from opening or clearing aren't typing
  if (baseline.current === null) baseline.current = snap(s, name)
  const creating = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ s, name, cur, fees: { hourly, bySf, byPct, med } })
  latest.current = { s, name, cur, fees: { hourly, bySf, byPct, med } }
  const persist = async () => {
    timer.current = null
    const { s: st, name: nm, cur: c, fees: fz } = latest.current
    if (!c && !hasInput(st) && !nm.trim()) return
    const row = { name: nm.trim() || c?.name || untitledName(), inputs: st, project_id: st.projectId || null, hourly_fee: fz.hourly || null, sf_fee: fz.bySf || null, pct_fee: fz.byPct || null, median_fee: fz.med || null, updated_at: new Date().toISOString() }
    setSaveState('saving'); setErr('')
    if (!c) {
      if (creating.current) return
      creating.current = true
      const { data, error } = await supabase.from('fee_estimates').insert(row).select('id, name, created_at').single()
      creating.current = false
      if (error) { setSaveState(''); return setErr(`Couldn't save: ${error.message}`) }
      const nn = nm.trim() ? nm : data.name
      baseline.current = snap(latest.current.s, nn)
      setCur({ id: data.id, name: data.name }); if (!nm.trim()) setName(data.name); setYear(new Date(data.created_at).getFullYear())
      // typed more while it was being created? save that too, once the new id is in place
      if (snap(latest.current.s, latest.current.name) !== snap(st, nm)) timer.current = setTimeout(() => { void persist() }, 700)
    } else {
      const { error } = await supabase.from('fee_estimates').update(row).eq('id', c.id)
      if (error) { setSaveState(''); return setErr(`Couldn't save: ${error.message}`) }
      if (row.name !== c.name) setCur({ id: c.id, name: row.name })
    }
    setSaveState('saved'); saved.reload()
  }
  useEffect(() => {
    if (snap(s, name) === baseline.current) return
    if (!cur && !hasInput(s) && !name.trim()) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void persist() }, 700)
  }, [s, name]) // eslint-disable-line react-hooks/exhaustive-deps
  // save anything pending before switching away (opening another fee, + New, leaving the page)
  const flush = async () => { if (timer.current) { clearTimeout(timer.current); await persist() } }
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void persist() } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const saveNew = async () => {
    await flush()
    const base = name.trim() || untitledName()
    const nm = cur && base === cur.name ? `${base} (copy)` : base
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('fee_estimates').insert({ ...payload(), name: nm }).select('id, name, created_at').single()
    setBusy(false)
    if (error) return setErr(error.message)
    baseline.current = snap(s, data.name)
    setCur({ id: data.id, name: data.name }); setName(data.name); setYear(new Date(data.created_at).getFullYear()); setMsg('Copied. You’re now editing the copy.'); saved.reload()
  }
  const open = async (x: Saved) => {
    await flush()
    const next: State = { ...EMPTY, ...x.inputs, projectId: x.project_id ?? x.inputs.projectId ?? '', split: { ...DEFAULT_SPLIT, ...(x.inputs.split ?? {}) }, rows: (x.inputs.rows?.length ? x.inputs.rows : [newRow()]).map((r) => ({ ...r, key: r.key || newRow().key })) }
    baseline.current = snap(next, x.name)
    setS(next)
    setCur({ id: x.id, name: x.name }); setName(x.name); setErr(''); setMsg(''); setSaveState('')
  }
  const startNew = async () => { await flush(); const blank: State = { ...EMPTY, rows: [newRow()], split: { ...DEFAULT_SPLIT } }; baseline.current = snap(blank, ''); setS(blank); setCur(null); setName(''); setErr(''); setMsg(''); setSaveState('') } // blank slate
  const rename = async (x: Saved) => {
    const n = window.prompt('Rename this fee', x.name)?.trim(); if (!n || n === x.name) return
    const { error } = await supabase.from('fee_estimates').update({ name: n }).eq('id', x.id)
    if (error) return setErr(error.message)
    if (cur?.id === x.id) { setCur({ id: x.id, name: n }); setName(n) }
    saved.reload()
  }
  const remove = async (x: Saved) => {
    if (!window.confirm(`Delete “${x.name}”? This can’t be undone.`)) return
    const { error } = await supabase.from('fee_estimates').delete().eq('id', x.id)
    if (error) return setErr(error.message)
    if (cur?.id === x.id) setCur(null)
    saved.reload()
  }
  const fmtD = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return { people, s, setS, set, projects, saved, cur, name, setName, msg, setMsg, err, setErr, busy, saveState, years, year, setYear, shownYear, inYear, setRow, pickPerson, hourly, hours, bySf, cost, byPct, fees, filled, med, avg, lo, hi, spread, splitPct, splitTotal, setSplit, splitOk, seed, flush, saveNew, open, startNew, rename, remove, fmtD }
}
export type FeeCalc = ReturnType<typeof useFeeCalc>

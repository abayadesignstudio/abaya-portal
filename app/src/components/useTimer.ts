import { useCallback, useEffect, useState } from 'react'
import { isNativeApp, toNative } from '../lib/native'
import { supabase } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { loadProjects, iso, announceTimeChange, TIME_CHANGED } from '../lib/time'
import { useDefaultRole } from './RolePicker'

export type RunningTimer = { project_id: string; phase_id: string | null; role_label: string | null; bill_rate?: number | null; activity: string | null; note: string | null; started_at: string; banked_minutes: number; paused_at?: string | null; banked_seconds?: number }
export type Recent = { project_id: string; phase_id: string | null; role_label: string | null; activity: string | null; projects: { number: string; name: string } | null; phases: { code: string } | null }
/** bill_rate: '' = the usual rate; a number = this entry's own hourly rate (custom role). */
export type TimerFields = { project_id: string; phase_id: string; role_label: string; activity: string; note: string; bill_rate: string }
export const EMPTY_FIELDS: TimerFields = { project_id: '', phase_id: '', role_label: '', activity: '', note: '', bill_rate: '' }

/** Today's logged time, one line per task (project · phase · role · activity), newest first. */
export type TodayTask = { key: string; project_id: string; phase_id: string | null; role_label: string | null; activity: string | null; minutes: number; last: string
  projects: { number: string; name: string; sector: string | null } | null; phases: { code: string } | null }
export const clockOf = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }

/** Shared timer state. Every instance (sidebar popover, phone bar) reads the same `timers` row
 *  and re-reads it whenever any instance announces a change, so they stay in sync. */
export function useTimer(me: string) {
  const [v, setV] = useState<TimerFields>(EMPTY_FIELDS)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const projects = useLoad(loadProjects)
  const timer = useLoad(async () => must(await supabase.from('timers').select('*').eq('profile_id', me).maybeSingle()) as RunningTimer | null, [me])
  const [recentKey, setRecentKey] = useState(0)
  const recent = useLoad(async () => must(await supabase.from('time_entries').select('project_id, phase_id, role_label, activity, projects(number, name), phases(code)')
    .eq('profile_id', me).order('created_at', { ascending: false }).limit(40)) as unknown as Recent[], [me, recentKey])

  const today = useLoad(async () => {
    const rows = must(await supabase.from('time_entries').select('project_id, phase_id, role_label, activity, minutes, created_at, projects(number, name, sector), phases(code)')
      .eq('profile_id', me).eq('work_date', iso(new Date())).order('created_at', { ascending: false })) as unknown as (Omit<TodayTask, 'key' | 'last'> & { created_at: string })[]
    const m = new Map<string, TodayTask>()
    for (const r of rows) {
      const key = `${r.project_id}|${r.phase_id}|${r.role_label}|${r.activity}`
      const o = m.get(key)
      if (o) o.minutes += r.minutes; else m.set(key, { ...r, key, last: r.created_at })
    }
    return [...m.values()]
  }, [me, recentKey])
  const t = timer.data
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])
  useEffect(() => { if (t) setV({ project_id: t.project_id, phase_id: t.phase_id ?? '', role_label: t.role_label ?? '', activity: t.activity ?? '', note: t.note ?? '', bill_rate: t.bill_rate != null ? String(Number(t.bill_rate)) : '' }) }, [t])
  const defaultRole = useDefaultRole(me)
  const reloadTimer = timer.reload, reloadToday = today.reload
  useEffect(() => {
    const f = () => { reloadTimer(); reloadToday() }
    const vis = () => { if (document.visibilityState === 'visible') f() } // phone app / home-screen app coming back to the front
    window.addEventListener(TIME_CHANGED, f); window.addEventListener('focus', f); document.addEventListener('visibilitychange', vis)
    return () => { window.removeEventListener(TIME_CHANGED, f); window.removeEventListener('focus', f); document.removeEventListener('visibilitychange', vis) }
  }, [reloadTimer, reloadToday])

  // running stretch since started_at (frozen at paused_at while paused) + time banked from earlier stretches
  const paused = !!t?.paused_at
  const elapsed = t ? (t.paused_at ? new Date(t.paused_at).getTime() : now) - new Date(t.started_at).getTime() + t.banked_minutes * 60000 + (t.banked_seconds ?? 0) * 1000 : 0
  const proj = projects.data?.find((p) => p.id === v.project_id)
  // iPhone app: mirror the timer to the Dynamic Island / lock screen (the clock ticks there by itself)
  const tp = projects.data?.find((p) => p.id === t?.project_id)
  useEffect(() => {
    if (!isNativeApp() || timer.loading || timer.error) return
    toNative({ type: 'timer', timer: t ? {
      code: tp?.number === 'OH' ? 'OH' : tp?.number ?? '', title: tp?.number === 'OH' ? 'Overhead' : tp?.name ?? 'Timer',
      detail: [t.activity, t.role_label].filter(Boolean).join(' · '), elapsed: Math.max(0, elapsed / 1000), paused,
    } : null })
  }, [t?.project_id, t?.activity, t?.role_label, t?.started_at, t?.paused_at, t?.banked_seconds, t?.banked_minutes, tp?.id, timer.loading, timer.data === null]) // eslint-disable-line react-hooks/exhaustive-deps
  const isOverhead = proj?.number === 'OH'
  // picking a project loads your usual role on it (team role, or what you used last)
  const setField = useCallback((k: keyof TimerFields, value: string) =>
    setV((o) => ({ ...o, [k]: value, ...(k === 'project_id' ? { phase_id: '', activity: '', role_label: defaultRole(value), bill_rate: '' } : {}) })), [defaultRole])
  const fields = () => ({ project_id: v.project_id, phase_id: v.phase_id || null, role_label: v.role_label || null, activity: v.activity || null, note: v.note || null,
    bill_rate: v.bill_rate !== '' && isFinite(Number(v.bill_rate)) ? Number(v.bill_rate) : null })

  const run = async (fn: () => Promise<boolean>) => { setBusy(true); try { return await fn() } finally { setBusy(false) } }
  const startNow = async () => {
    if (!v.project_id) { setErr('Choose a project.'); return false }
    const { error } = await supabase.from('timers').upsert({ profile_id: me, ...fields(), started_at: new Date().toISOString(), banked_minutes: 0, banked_seconds: 0, paused_at: null })
    if (error) { setErr(error.message); return false }
    setErr(''); announceTimeChange(); return true
  }
  const logNow = async () => {
    if (!t) return false
    const f = fields()
    const minutes = Math.max(1, Math.round(elapsed / 60000))
    const { error } = await supabase.from('time_entries').insert({ profile_id: me, ...f, project_id: f.project_id || t.project_id,
      work_date: iso(new Date()), minutes, started_at: t.started_at, ended_at: new Date().toISOString() })
    if (error) { setErr(error.message); return false }
    await supabase.from('timers').delete().eq('profile_id', me)
    // keep the combination on the timesheet (a duplicate row is rejected by the unique index, which is fine)
    await supabase.from('timesheet_rows').insert({ profile_id: me, project_id: f.project_id || t.project_id, phase_id: f.phase_id, role_label: f.role_label, activity: f.activity, bill_rate: f.bill_rate })
    setRecentKey((k) => k + 1); return true
  }

  // the clock carries on from what's already logged today for the same task (display only; ending logs just the new time)
  const loggedToday = t ? (today.data ?? []).filter((x) => x.project_id === t.project_id && x.phase_id === (t.phase_id ?? null) && x.role_label === (t.role_label ?? null) && x.activity === (t.activity ?? null))
    .reduce((n, x) => n + x.minutes, 0) : 0
  const patchTimer = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from('timers').update(patch).eq('profile_id', me)
    if (error) { setErr(error.message); return false }
    setErr(''); announceTimeChange(); return true
  }
  return {
    v, setV, setField, err, setErr, busy, running: t ?? null, paused, elapsed, clock: clockOf(elapsed + loggedToday * 60000), today: today.data ?? [], loggedToday,
    /** Freeze the clock. */
    pause: () => run(async () => !!t && !t.paused_at && patchTimer({ paused_at: new Date().toISOString() })),
    /** Carry on: bank the stretch before the pause and start a new stretch now. */
    resume: () => run(async () => {
      if (!t?.paused_at) return false
      const stretch = Math.round((new Date(t.paused_at).getTime() - new Date(t.started_at).getTime()) / 1000)
      return patchTimer({ banked_seconds: (t.banked_seconds ?? 0) + Math.max(0, stretch), started_at: new Date().toISOString(), paused_at: null })
    }),
    /** Back to 00:00 on the same task (nothing is logged). */
    restart: () => run(async () => !!t && patchTimer({ started_at: new Date().toISOString(), banked_minutes: 0, banked_seconds: 0, paused_at: null })),
    /** Start a timer on a task from today's list (logging whatever is running first). */
    pickUp: (x: TodayTask) => run(async () => {
      if (t && !(await logNow())) return false
      const next = { project_id: x.project_id, phase_id: x.phase_id ?? '', role_label: x.role_label ?? '', activity: x.activity ?? '', note: '', bill_rate: '' }
      setV(next)
      const { error } = await supabase.from('timers').upsert({ profile_id: me, project_id: next.project_id, phase_id: x.phase_id, role_label: x.role_label, activity: x.activity, note: null,
        started_at: new Date().toISOString(), banked_minutes: 0, banked_seconds: 0, paused_at: null })
      if (error) { setErr(error.message); return false }
      setErr(''); announceTimeChange(); return true
    }),
    projects: projects.data ?? [], proj, isOverhead, recent: recent.data ?? [], defaultRole,
    start: () => run(startNow),
    stop: () => run(async () => { const ok = await logNow(); if (ok) { setV(EMPTY_FIELDS); setErr(''); announceTimeChange() } return ok }),
    /** Log the running task, then start the task now in the form. */
    switchTask: () => run(async () => { const ok = await logNow(); if (!ok) return false; setV((o) => ({ ...o, note: '' })); return startNow() }),
    save: () => run(async () => { if (!t) return false; const { error } = await supabase.from('timers').update(fields()).eq('profile_id', me); if (error) { setErr(error.message); return false } announceTimeChange(); return true }),
    discard: () => run(async () => { await supabase.from('timers').delete().eq('profile_id', me); setV(EMPTY_FIELDS); announceTimeChange(); return true }),
    reset: () => { setV(EMPTY_FIELDS); setErr('') },
    refreshRecent: () => setRecentKey((k) => k + 1),
  }
}
export type TimerApi = ReturnType<typeof useTimer>

/** Unique recent combinations, newest first. */
export const uniqueRecent = (rows: Recent[], n = 8) =>
  Array.from(new Map(rows.map((r) => [`${r.project_id}|${r.phase_id}|${r.activity}|${r.role_label}`, r])).values()).slice(0, n)

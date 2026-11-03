import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { loadProjects, iso, announceTimeChange, TIME_CHANGED } from '../lib/time'

export type RunningTimer = { project_id: string; phase_id: string | null; role_label: string | null; activity: string | null; note: string | null; started_at: string; banked_minutes: number }
export type Recent = { project_id: string; phase_id: string | null; role_label: string | null; activity: string | null; projects: { number: string; name: string } | null; phases: { code: string } | null }
export type TimerFields = { project_id: string; phase_id: string; role_label: string; activity: string; note: string }
export const EMPTY_FIELDS: TimerFields = { project_id: '', phase_id: '', role_label: '', activity: '', note: '' }

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

  const t = timer.data
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])
  useEffect(() => { if (t) setV({ project_id: t.project_id, phase_id: t.phase_id ?? '', role_label: t.role_label ?? '', activity: t.activity ?? '', note: t.note ?? '' }) }, [t])
  const reloadTimer = timer.reload
  useEffect(() => {
    const f = () => reloadTimer()
    window.addEventListener(TIME_CHANGED, f); window.addEventListener('focus', f)
    return () => { window.removeEventListener(TIME_CHANGED, f); window.removeEventListener('focus', f) }
  }, [reloadTimer])

  const elapsed = t ? now - new Date(t.started_at).getTime() + t.banked_minutes * 60000 : 0
  const proj = projects.data?.find((p) => p.id === v.project_id)
  const isOverhead = proj?.number === 'OH'
  const setField = useCallback((k: keyof TimerFields, value: string) =>
    setV((o) => ({ ...o, [k]: value, ...(k === 'project_id' ? { phase_id: '', activity: '' } : {}) })), [])
  const fields = () => ({ project_id: v.project_id, phase_id: v.phase_id || null, role_label: v.role_label || null, activity: v.activity || null, note: v.note || null })

  const run = async (fn: () => Promise<boolean>) => { setBusy(true); try { return await fn() } finally { setBusy(false) } }
  const startNow = async () => {
    if (!v.project_id) { setErr('Choose a project.'); return false }
    const { error } = await supabase.from('timers').upsert({ profile_id: me, ...fields(), started_at: new Date().toISOString(), banked_minutes: 0 })
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
    await supabase.from('timesheet_rows').insert({ profile_id: me, project_id: f.project_id || t.project_id, phase_id: f.phase_id, role_label: f.role_label, activity: f.activity })
    setRecentKey((k) => k + 1); return true
  }

  return {
    v, setV, setField, err, setErr, busy, running: t ?? null, elapsed, clock: clockOf(elapsed),
    projects: projects.data ?? [], proj, isOverhead, recent: recent.data ?? [],
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

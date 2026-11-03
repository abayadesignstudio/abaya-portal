import { useEffect, useRef, useState } from 'react'
import { supabase, PHASE_NAME } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { ACTIVITIES, OVERHEAD, ROLES, loadProjects, iso, announceTimeChange, TIME_CHANGED } from '../lib/time'

type Timer = { project_id: string; phase_id: string | null; role_label: string | null; activity: string | null; note: string | null; started_at: string; banked_minutes: number }
type Recent = { project_id: string; phase_id: string | null; role_label: string | null; activity: string | null; projects: { number: string; name: string } | null; phases: { code: string } | null }
const EMPTY = { project_id: '', phase_id: '', role_label: '', activity: '', note: '' }

const clockOf = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }

/** Sidebar button + popover. The only place a running timer is controlled. */
export default function SidebarTimer({ me }: { me: string }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'form' | 'recent'>('form')
  const [v, setV] = useState(EMPTY)
  const [err, setErr] = useState('')
  const [now, setNow] = useState(Date.now())
  const projects = useLoad(loadProjects)
  const timer = useLoad(async () => must(await supabase.from('timers').select('*').eq('profile_id', me).maybeSingle()) as Timer | null, [me])
  const recent = useLoad(async () => must(await supabase.from('time_entries').select('project_id, phase_id, role_label, activity, projects(number, name), phases(code)')
    .eq('profile_id', me).order('created_at', { ascending: false }).limit(40)) as unknown as Recent[], [me, open])
  const pop = useRef<HTMLDivElement>(null)

  const t = timer.data
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])
  useEffect(() => { if (t) setV({ project_id: t.project_id, phase_id: t.phase_id ?? '', role_label: t.role_label ?? '', activity: t.activity ?? '', note: t.note ?? '' }) }, [t])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => { if (pop.current && !pop.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('keydown', onKey); setTimeout(() => window.addEventListener('mousedown', onClick))
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [open])

  const elapsed = t ? now - new Date(t.started_at).getTime() + t.banked_minutes * 60000 : 0
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((o) => ({ ...o, [k]: e.target.value, ...(k === 'project_id' ? { phase_id: '', activity: '' } : {}) }))
  const proj = projects.data?.find((p) => p.id === v.project_id)
  const isOverhead = proj?.number === 'OH'
  const fields = { project_id: v.project_id, phase_id: v.phase_id || null, role_label: v.role_label || null, activity: v.activity || null, note: v.note || null }

  const start = async () => {
    if (!v.project_id) return setErr('Choose a project.')
    const { error } = await supabase.from('timers').upsert({ profile_id: me, ...fields, started_at: new Date().toISOString(), banked_minutes: 0 })
    if (error) return setErr(error.message)
    setErr(''); timer.reload(); setOpen(false)
  }
  const log = async () => {
    if (!t) return false
    const minutes = Math.max(1, Math.round(elapsed / 60000))
    const { error } = await supabase.from('time_entries').insert({ profile_id: me, ...fields, project_id: v.project_id || t.project_id,
      work_date: iso(new Date()), minutes, started_at: t.started_at, ended_at: new Date().toISOString() })
    if (error) { setErr(error.message); return false }
    await supabase.from('timers').delete().eq('profile_id', me)
    // keep the row on the timesheet
    await supabase.from('timesheet_rows').upsert({ profile_id: me, project_id: fields.project_id || t.project_id, phase_id: fields.phase_id, role_label: fields.role_label, activity: fields.activity }, { ignoreDuplicates: true })
    announceTimeChange(); return true
  }
  const stop = async () => { if (await log()) { setV(EMPTY); setErr(''); timer.reload() } }
  const switchTask = async () => { if (await log()) { setV((o) => ({ ...o, note: '' })); timer.reload(); setOpen(true) } }
  const save = async () => { if (!t) return; await supabase.from('timers').update(fields).eq('profile_id', me); timer.reload(); setOpen(false) }
  const discard = async () => { await supabase.from('timers').delete().eq('profile_id', me); setV(EMPTY); timer.reload() }

  // refresh if another tab changed things
  const reloadTimer = timer.reload
  useEffect(() => { const f = () => reloadTimer(); window.addEventListener(TIME_CHANGED, f); window.addEventListener('focus', f); return () => { window.removeEventListener(TIME_CHANGED, f); window.removeEventListener('focus', f) } }, [reloadTimer])

  const recents = Array.from(new Map((recent.data ?? []).map((r) => [`${r.project_id}|${r.phase_id}|${r.activity}|${r.role_label}`, r])).values()).slice(0, 8)

  return (
    <div style={{ position: 'relative', padding: '0 16px 12px' }}>
      <button type="button" className="timer-btn" onClick={() => { setOpen(!open); setView('form') }} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 52, padding: '0 14px', borderRadius: 10, border: '1px solid rgba(154,143,99,.5)', background: t ? 'rgba(3,152,85,.18)' : 'rgba(237,230,214,.05)', color: '#ede6d6', font: '700 16px Arial', cursor: 'pointer' }}>
        <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: '50%', background: t ? '#039855' : '#9a8f63', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#02253d' }}>{t ? '■' : '▶'}</span>
        {t ? <span className="num">{clockOf(elapsed)}</span> : 'Timer'}
      </button>
      {open && (
        <div ref={pop} role="dialog" aria-label="Time entry" style={{ position: 'fixed', left: 244, bottom: 16, width: 420, maxWidth: 'calc(100vw - 260px)', zIndex: 30, background: '#fff', color: 'var(--text)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,.28)', overflow: 'hidden' }}>
          <div className="row between" style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)' }}>
            <button type="button" className="linkbtn" onClick={() => setView(view === 'form' ? 'recent' : 'form')}>{view === 'form' ? '‹ Recent entries' : '‹ Back'}</button>
            <button type="button" className="linkbtn" onClick={() => { setV(EMPTY); setErr('') }}>Reset</button>
          </div>
          {view === 'recent' ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 8, maxHeight: 360, overflowY: 'auto' }}>
              {recents.length === 0 && <li className="muted" style={{ padding: 12 }}>No entries yet.</li>}
              {recents.map((r, i) => <li key={i}><button type="button" className="recent" onClick={() => { setV({ project_id: r.project_id, phase_id: r.phase_id ?? '', role_label: r.role_label ?? '', activity: r.activity ?? '', note: '' }); setView('form') }}>
                <strong>{r.projects?.number} · {r.projects?.name}</strong><span className="muted">{[r.phases?.code, r.role_label, r.activity].filter(Boolean).join(' · ') || '—'}</span></button></li>)}
            </ul>
          ) : (
            <div className="stack" style={{ padding: 18, gap: 10 }}>
              <h2 style={{ fontSize: 22 }}>{t ? <>Running <span className="num" style={{ color: '#039855' }}>{clockOf(elapsed)}</span></> : 'Time entry'}</h2>
              <label className="sr" htmlFor="tm-p">Project</label>
              <select id="tm-p" className="input" value={v.project_id} onChange={set('project_id')}>
                <option value="">Project</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.number === 'OH' ? 'Overhead' : `${p.number} · ${p.name}`}</option>)}</select>
              {!isOverhead && <><label className="sr" htmlFor="tm-ph">Phase</label>
                <select id="tm-ph" className="input" value={v.phase_id} onChange={set('phase_id')} disabled={!proj}>
                  <option value="">Phase</option>{proj?.phases.map((x) => <option key={x.id} value={x.id}>{x.code} · {PHASE_NAME[x.code]}</option>)}</select></>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label className="sr" htmlFor="tm-r">Role</label><select id="tm-r" className="input" value={v.role_label} onChange={set('role_label')}><option value="">Role</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
                <div><label className="sr" htmlFor="tm-a">Activity</label><select id="tm-a" className="input" value={v.activity} onChange={set('activity')}><option value="">{isOverhead ? 'Overhead type' : 'Activity'}</option>{(isOverhead ? OVERHEAD : ACTIVITIES).map((a) => <option key={a}>{a}</option>)}</select></div>
              </div>
              <label className="sr" htmlFor="tm-n">Note</label>
              <textarea id="tm-n" className="input" rows={2} placeholder="Add a note (optional)" value={v.note} onChange={set('note')} style={{ background: '#f6f5f2', border: 0 }} />
              {err && <p className="err" role="alert">{err}</p>}
              {!t ? (
                <div className="row between"><button type="button" className="btn secondary" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn" onClick={start} disabled={!v.project_id}>Start timer</button></div>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><button type="button" className="btn" onClick={stop}>■ Stop &amp; log</button><button type="button" className="btn secondary" onClick={switchTask}>Switch task</button></div>
                  <div className="row between"><button type="button" className="linkbtn" onClick={save}>Save changes</button><button type="button" className="linkbtn" style={{ color: 'var(--red)' }} onClick={discard}>Discard time</button></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

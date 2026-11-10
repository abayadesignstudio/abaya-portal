import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase, PHASES, SECTOR_COLOR, phaseLabel } from '../lib/supabase'
import './time-mobile.css'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { ACTIVITIES, OVERHEAD, loadProjects, iso, mondayOf, hrs, TIME_CHANGED, announceTimeChange, type Proj } from '../lib/time'
import Combobox, { sectorColor, type ComboOption } from '../components/Combobox'
import { useDefaultRole } from '../components/RolePicker'

const PHONE = '(max-width: 900px)'
function useIsPhone() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches)
  useEffect(() => { const q = window.matchMedia(PHONE); const f = () => setM(q.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f) }, [])
  return m
}

const legacyOf = (es: { project_id: string; phase_id: string | null; legacy_phase?: string | null }[], r: { project_id: string; phase_id: string | null }) =>
  es.find((e) => e.project_id === r.project_id && !r.phase_id && !e.phase_id && e.legacy_phase)?.legacy_phase ?? 'No phase'
type Entry = { id: string; work_date: string; minutes: number; note: string | null; activity: string | null; role_label: string | null; project_id: string; phase_id: string | null; legacy_phase?: string | null }
type RowDef = { id?: string; project_id: string; phase_id: string | null; role_label: string | null; activity: string | null; bill_rate?: number | null }
const keyOf = (r: { project_id: string; phase_id: string | null; activity: string | null }) => `${r.project_id}|${r.phase_id ?? ''}|${r.activity ?? ''}`

export default function Time() {
  const { profile } = useAuth()
  const admin = profile?.role === 'admin'
  // whose timesheet this is: yours, or (admins) anyone's — `me` is the person whose hours are shown and saved
  const [me, setMe] = useState(profile!.id)
  const self = me === profile!.id
  const people = useLoad(async () => admin ? must(await supabase.from('profiles').select('id, full_name, email').in('role', ['admin', 'staff']).order('full_name')) as { id: string; full_name: string | null; email: string }[] : [], [admin])
  const defaultRole = useDefaultRole(me)
  const whoName = (people.data ?? []).find((p) => p.id === me)?.full_name ?? 'this person'
  const [week, setWeek] = useState(() => mondayOf(new Date()))
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(week); d.setDate(d.getDate() + i); return d }), [week])
  const projects = useLoad(loadProjects)
  const data = useLoad(async () => {
    const entries = must(await supabase.from('time_entries').select('id, work_date, minutes, note, activity, role_label, project_id, phase_id, legacy_phase')
      .eq('profile_id', me).gte('work_date', iso(days[0])).lte('work_date', iso(days[6])).order('created_at')) as Entry[]
    const rows = must(await supabase.from('timesheet_rows').select('id, project_id, phase_id, role_label, activity, bill_rate').eq('profile_id', me).order('created_at')) as RowDef[]
    const phaseIds = Array.from(new Set([...rows, ...entries].map((r) => r.phase_id).filter(Boolean))) as string[]
    const totals = phaseIds.length ? must(await supabase.from('time_entries').select('phase_id, minutes').eq('profile_id', me).in('phase_id', phaseIds)) as { phase_id: string; minutes: number }[] : []
    // hours assigned to this person on each phase (project → Budget), spread over the phase's weekdays
    const allocs = phaseIds.length ? must(await supabase.from('phase_allocations').select('phase_id, hours').eq('profile_id', me).in('phase_id', phaseIds)) as { phase_id: string; hours: number }[] : []
    return { entries, rows, totals, allocs }
  }, [me, week])
  const reload = data.reload
  useEffect(() => { window.addEventListener(TIME_CHANGED, reload); return () => window.removeEventListener(TIME_CHANGED, reload) }, [reload])
  const [err, setErr] = useState('')

  const pById = Object.fromEntries((projects.data ?? []).map((p) => [p.id, p])) as Record<string, Proj>
  const entries = data.data?.entries ?? []
  // rows: saved rows + any combination that has time this week
  const rows: RowDef[] = useMemo(() => {
    const m = new Map<string, RowDef>()
    ;(data.data?.rows ?? []).forEach((r) => m.set(keyOf(r), r))
    entries.forEach((e) => { if (!m.has(keyOf(e))) m.set(keyOf(e), { project_id: e.project_id, phase_id: e.phase_id, role_label: e.role_label, activity: e.activity }) })
    return Array.from(m.values())
  }, [data.data, entries])
  const cell = (r: RowDef, d: Date) => entries.filter((e) => keyOf(e) === keyOf(r) && e.work_date === iso(d)).reduce((a, e) => a + e.minutes, 0)
  const dayTotal = (d: Date) => entries.filter((e) => e.work_date === iso(d)).reduce((a, e) => a + e.minutes, 0)
  const weekTotal = entries.reduce((a, e) => a + e.minutes, 0)
  /** This week's share of the hours allocated on a phase: allocation × (phase weekdays in this week ÷ all phase weekdays). */
  const weekAlloc = (projectId: string, phaseId: string | null): number | null => {
    if (!phaseId) return null
    const a = (data.data?.allocs ?? []).find((x) => x.phase_id === phaseId)
    if (!a || !Number(a.hours)) return null
    const ph = pById[projectId]?.phases.find((x) => x.id === phaseId)
    if (!ph?.start_date || !ph?.end_date) return null
    const weekdays = (from: Date, to: Date) => { let n = 0; const d = new Date(from); while (d <= to) { const g = d.getDay(); if (g !== 0 && g !== 6) n++; d.setDate(d.getDate() + 1) } return n }
    const [s0, e0] = [ph.start_date, ph.end_date].map((x) => { const [y, m, d] = x.split('-').map(Number); return new Date(y, m - 1, d) })
    const total = weekdays(s0, e0); if (!total) return null
    const ws = days[0], we = days[6]
    const from = s0 > ws ? s0 : ws, to = e0 < we ? e0 : we
    return from > to ? 0 : Number(a.hours) * weekdays(from, to) / total
  }
  const phaseTotal = (phaseId: string | null) => phaseId ? (data.data?.totals ?? []).filter((t) => t.phase_id === phaseId).reduce((a, t) => a + t.minutes, 0) : 0

  // a note typed on a day with no hours yet waits here until hours go in
  const [pendingNote, setPendingNote] = useState<Record<string, string>>({})
  const noteOf = (r: RowDef, d: Date) => entries.filter((e) => keyOf(e) === keyOf(r) && e.work_date === iso(d)).map((e) => e.note).filter(Boolean).join(' / ') || pendingNote[keyOf(r) + '@' + iso(d)] || ''
  const setNote = async (r: RowDef, d: Date, text: string) => {
    const existing = entries.filter((e) => keyOf(e) === keyOf(r) && e.work_date === iso(d))
    const note = text.trim() || null
    if (!existing.length) { setPendingNote((m) => ({ ...m, [keyOf(r) + '@' + iso(d)]: text })); return }
    if ((existing.map((e) => e.note).filter(Boolean).join(' / ') || null) === note) return
    const [first, ...rest] = existing
    const { error } = await supabase.from('time_entries').update({ note }).eq('id', first.id)
    if (error) return setErr(error.message)
    if (rest.length) await supabase.from('time_entries').update({ note: null }).in('id', rest.map((e) => e.id))
    announceTimeChange()
  }
  const setCell = async (r: RowDef, d: Date, text: string) => {
    const val = parseFloat(text.replace(',', '.'))
    const minutes = isFinite(val) && val > 0 ? Math.round(val * 60) : 0
    if (minutes > 24 * 60) return setErr('A day can’t have more than 24 hours.')
    const existing = entries.filter((e) => keyOf(e) === keyOf(r) && e.work_date === iso(d))
    if (existing.reduce((a, e) => a + e.minutes, 0) === minutes) return
    setErr('')
    if (existing.length) { const { error } = await supabase.from('time_entries').delete().in('id', existing.map((e) => e.id)); if (error) return setErr(error.message) }
    if (minutes > 0) {
      const { error } = await supabase.from('time_entries').insert({ profile_id: me, project_id: r.project_id, phase_id: r.phase_id, role_label: r.role_label, activity: r.activity, bill_rate: r.bill_rate ?? null,
        work_date: iso(d), minutes, note: existing.map((e) => e.note).filter(Boolean).join(' / ') || pendingNote[keyOf(r) + '@' + iso(d)]?.trim() || null })
      if (error) return setErr(error.message)
    }
    await ensureRow(r); announceTimeChange()
  }
  const ensureRow = async (r: RowDef) => {
    if ((data.data?.rows ?? []).some((x) => keyOf(x) === keyOf(r))) return
    await supabase.from('timesheet_rows').insert({ profile_id: me, project_id: r.project_id, phase_id: r.phase_id, role_label: r.role_label, activity: r.activity })
  }
  const addRow = async (r: RowDef) => {
    if (rows.some((x) => keyOf(x) === keyOf(r))) return setErr('That row is already on your timesheet.')
    const { error } = await supabase.from('timesheet_rows').insert({ profile_id: me, ...r })
    if (error) return setErr(error.message)
    setErr(''); reload()
  }
  const changeActivity = async (r: RowDef, activity: string) => {
    const next = { ...r, activity: activity || null }
    if (rows.some((x) => keyOf(x) === keyOf(next))) return setErr('You already have a row with that activity.')
    const ids = entries.filter((e) => keyOf(e) === keyOf(r)).map((e) => e.id)
    if (ids.length) await supabase.from('time_entries').update({ activity: next.activity }).in('id', ids)
    if (r.id) await supabase.from('timesheet_rows').update({ activity: next.activity }).eq('id', r.id)
    else await supabase.from('timesheet_rows').insert({ profile_id: me, ...next })
    setErr(''); reload()
  }
  const removeRow = async (r: RowDef) => {
    const has = entries.some((e) => keyOf(e) === keyOf(r))
    if (has) return setErr('Clear this week’s hours on that row before removing it.')
    if (r.id) await supabase.from('timesheet_rows').delete().eq('id', r.id)
    reload()
  }

  const overhead = (projects.data ?? []).find((p) => p.number === 'OH')
  // grouped by phase, in phase order (CE → CA); within a phase, projects working in it now come first
  const STATUS_RANK: Record<string, number> = { in_progress: 0, paused: 1, not_started: 2, complete: 3 }
  const phaseOptions: ComboOption[] = (() => {
    const list = (projects.data ?? []).filter((p) => p.number !== 'OH')
    const out: ComboOption[] = []
    for (const [code, name] of PHASES) {
      const rows = list.flatMap((p) => p.phases.filter((ph) => ph.code === code).map((ph) => ({ p, ph })))
        .sort((a, b) => (STATUS_RANK[a.ph.status ?? ''] ?? 2) - (STATUS_RANK[b.ph.status ?? ''] ?? 2) || b.p.number.localeCompare(a.p.number))
      for (const { p, ph } of rows) out.push({ value: `${p.id}|${ph.id}`, chip: p.number, color: sectorColor(p.sector), label: p.name, group: `${code} · ${name}`,
        hint: ph.status === 'in_progress' ? '· in progress' : ph.status === 'complete' ? '· complete' : ph.status === 'paused' ? '· paused' : undefined, search: `${code} ${name}` })
    }
    // custom phases, then approved additional services, each its own line
    for (const { p, ph } of list.flatMap((p) => p.phases.filter((ph) => ph.code === 'CU').map((ph) => ({ p, ph }))))
      out.push({ value: `${p.id}|${ph.id}`, chip: p.number, color: sectorColor(p.sector), label: `${p.name} — ${phaseLabel(ph)}`, group: 'Custom phases',
        hint: ph.status === 'complete' ? '· complete' : undefined, search: `custom ${phaseLabel(ph)}` })
    const svc = list.flatMap((p) => p.phases.filter((ph) => ph.code === 'AS' && ph.status !== 'complete').map((ph) => ({ p, ph })))
    for (const { p, ph } of svc) out.push({ value: `${p.id}|${ph.id}`, chip: p.number, color: sectorColor(p.sector), label: `${p.name} — ${phaseLabel(ph)}`, group: 'Additional services',
      hint: ph.parent_phase_id ? `· under ${p.phases.find((x) => x.id === ph.parent_phase_id)?.code ?? ''}` : undefined, search: `AS additional ${phaseLabel(ph)}` })
    for (const p of list.filter((p) => p.phases.length === 0)) out.push({ value: `${p.id}|`, chip: p.number, color: sectorColor(p.sector), label: p.name, group: 'No phases yet' })
    return out
  })()
  const phone = useIsPhone()
  const [dayIdx, setDayIdx] = useState(() => { const i = (new Date().getDay() + 6) % 7; return i })
  const day = days[dayIdx]
  const groups = Array.from(new Set(rows.map((r) => r.project_id)))
  const today = iso(new Date())

  return (
    <div className="stack">
      <div className="row between">
        <div className="row" style={{ gap: 14 }}>
          <h1>Timesheet</h1>
          {admin && (people.data ?? []).length > 1 && <div className="row" style={{ gap: 6 }}>
            <label htmlFor="ts-who" className="muted" style={{ fontSize: 14 }}>Hours for</label>
            <select id="ts-who" className="input" style={{ width: 'auto', minHeight: 38, fontWeight: 700 }} value={me} onChange={(e) => setMe(e.target.value)}>
              {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.id === profile!.id ? `Me (${p.full_name ?? p.email})` : p.full_name ?? p.email}</option>)}
            </select>
          </div>}
        </div>
        <span className="muted" style={{ fontSize: 14 }}>Use the <strong>Timer</strong> {phone ? 'bar at the bottom of the screen' : 'at the bottom of the sidebar'} to track time live.</span>
      </div>
      {!self && <p className="ts-other" role="status">You’re entering hours for <strong>{whoName}</strong>. Rows and hours you add here go on their timesheet. <button type="button" className="linkbtn" onClick={() => setMe(profile!.id)}>Back to mine</button></p>}
      <div className="row between">
        <div className="row" style={phone ? { width: '100%' } : undefined}>
          <Combobox id="ts-add" label="Add project and phase" placeholder="Search for project and add phase" style={{ width: phone ? '100%' : 380 }} clearOnSelect value=""
            options={phaseOptions} onChange={(x) => { const [project_id, phase_id] = x.split('|'); if (project_id) addRow({ project_id, phase_id: phase_id || null, role_label: defaultRole(project_id) || null, activity: null }) }} />
          <label className="sr" htmlFor="ts-oh">Add overhead</label>
          <select id="ts-oh" className="input" style={{ width: phone ? '100%' : 200 }} value="" onChange={(e) => { if (e.target.value && overhead) addRow({ project_id: overhead.id, phase_id: null, role_label: null, activity: e.target.value }) }}>
            <option value="">Add overhead</option>{OVERHEAD.map((o) => <option key={o}>{o}</option>)}</select>
        </div>
        <div className="row" style={{ gap: 0, flexWrap: 'nowrap' }}>
          <button className="btn small secondary" aria-label="Previous week" onClick={() => { const d = new Date(week); d.setDate(d.getDate() - 7); setWeek(d) }}>‹</button>
          <label className="sr" htmlFor="ts-wk">Week of</label>
          <input id="ts-wk" type="date" className="input" style={{ width: 170, margin: '0 6px' }} value={iso(week)} onChange={(e) => { if (e.target.value) { const [y, m, d] = e.target.value.split('-').map(Number); setWeek(mondayOf(new Date(y, m - 1, d))) } }} />
          <button className="btn small secondary" aria-label="Next week" onClick={() => { const d = new Date(week); d.setDate(d.getDate() + 7); setWeek(d) }}>›</button>
          <button className="btn small secondary" style={{ marginLeft: 8 }} onClick={() => setWeek(mondayOf(new Date()))}>This week</button>
        </div>
      </div>
      {err && <p className="err" role="alert">{err}</p>}

      {phone ? (
        <>
          <div className="ts-days" role="group" aria-label="Day">
            {days.map((d, i) => <button key={iso(d)} type="button" className={'ts-day' + (i === dayIdx ? ' on' : '') + (iso(d) === today ? ' today' : '')} aria-pressed={i === dayIdx} onClick={() => setDayIdx(i)}>
              <span>{d.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong>{d.getDate()}</strong><span className="num">{hrs(dayTotal(d))}</span></button>)}
          </div>
          <div className="card pad row between" style={{ padding: '12px 16px' }}>
            <strong>{day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</strong>
            <span><span className="num" style={{ fontWeight: 700 }}>{hrs(dayTotal(day))}</span> <span className="muted">h · week {hrs(weekTotal)} h</span></span>
          </div>
          {groups.map((pid) => {
            const p = pById[pid]
            const isOH = p?.number === 'OH'
            return (
              <section key={pid} className="card">
                <h2 className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', gap: 10, fontSize: 18 }}>
                  {p && !isOH && <span className="tag" style={{ background: sectorColor(p.sector) }}>{p.number}</span>}{isOH ? 'Overhead' : (p?.name ?? 'Project')}</h2>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {rows.filter((r) => r.project_id === pid).map((r) => {
                    const phx = p?.phases.find((x) => x.id === r.phase_id); const code = phx?.code
                    return (
                      <li key={keyOf(r)} className="ts-mrow">
                        <div style={{ minWidth: 0, flex: 1 }}>
                          {!isOH && <div style={{ fontWeight: 700 }}>{phx ? `${code} · ${phaseLabel(phx)}` : legacyOf(data.data?.entries ?? [], r)}</div>}
                          <label className="sr" htmlFor={'mact-' + keyOf(r)}>Activity</label>
                          <select id={'mact-' + keyOf(r)} className="input" style={{ marginTop: 6 }} value={r.activity ?? ''} onChange={(e) => changeActivity(r, e.target.value)}>
                            <option value="">{isOH ? 'Overhead type' : 'Activity'}</option>{(isOH ? OVERHEAD : ACTIVITIES).map((x) => <option key={x}>{x}</option>)}</select>
                        </div>
                        <div className="stack" style={{ gap: 4, alignItems: 'center' }}>
                          <Cell value={cell(r, day)} today={false} label={`Hours, ${isOH ? 'Overhead' : `${p?.number ?? ''} ${p?.name ?? ''} ${code ?? ''}`} ${r.activity ?? ''}, ${day.toDateString()}`} note={noteOf(r, day)} onCommit={(t) => setCell(r, day, t)} onNote={(t) => setNote(r, day, t)} />
                          <button className="linkbtn" style={{ color: 'var(--muted)', fontSize: 14 }} aria-label="Remove row" onClick={() => removeRow(r)}>Remove</button>
                        </div>
                      </li>)
                  })}
                </ul>
              </section>)
          })}
        </>
      ) : (<>
      <div className="card" style={{ overflowX: 'auto' }}>
        <div className="ts-sheet">
          <div className="ts-row ts-head">
            <div className="cell ts-l">Project</div><div className="cell ts-l">Activity</div>
            {days.map((d) => <div key={iso(d)} className={'cell' + (iso(d) === today ? ' is-today' : '')}>{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>)}
            <div className="cell">Hours</div><div />
          </div>
          <div className="ts-row ts-sum">
            <div className="cell ts-l">All activities <span className="muted">· {rows.length}</span></div><div />
            {days.map((d) => <div key={iso(d)} className="cell num">{hrs(dayTotal(d))}</div>)}
            <div className="cell num">{hrs(weekTotal)}</div><div />
          </div>
        </div>
      </div>

      {groups.map((pid) => {
        const p = pById[pid]
        const isOH = p?.number === 'OH'
        return (
          <section key={pid} className="card" style={{ overflowX: 'auto' }}>
            <div className="ts-sheet">
              <h2 className="row ts-proj">
                {p && !isOH && <span className="tag" style={{ background: SECTOR_COLOR[p.sector ?? 'internal'] }}>{p.number}</span>}{isOH ? 'Overhead' : (p?.name ?? 'Project')}</h2>
              {rows.filter((r) => r.project_id === pid).map((r) => {
                const phx = p?.phases.find((x) => x.id === r.phase_id); const code = phx?.code
                const total = days.reduce((a, d) => a + cell(r, d), 0)
                return (
                  <div key={keyOf(r)} className="ts-row ts-line">
                    <div className="cell ts-l ts-what">
                      {isOH ? <strong>Overhead</strong> : <div style={{ minWidth: 0 }}>
                        <div>{code ? `${code} · ` : ''}{r.role_label ?? 'Role not set'}{r.bill_rate != null && <span className="muted"> · ${Number(r.bill_rate)}/hr</span>}</div>
                        <strong>{phx ? phaseLabel(phx) : legacyOf(data.data?.entries ?? [], r)}</strong></div>}
                      {r.phase_id && (() => {
                        // this week's allocated hours for this phase (from the phase timeline); the ring fills as hours are logged this week
                        const alloc = weekAlloc(r.project_id, r.phase_id)
                        const logged = days.reduce((a, d) => a + cell(r, d), 0) / 60
                        const pct = alloc ? Math.min(1, logged / alloc) : 0
                        const over = !!alloc && logged > alloc + 0.01
                        return <span className={'num ts-circle' + (over ? ' over' : '')} style={{ ['--p' as string]: `${pct * 360}deg` }}
                          title={alloc == null ? `No hours allocated to you on this phase (project → Budget). ${hrs(phaseTotal(r.phase_id))} h logged on it in total.`
                            : `${alloc.toFixed(1)} h allocated this week from the phase timeline · ${logged.toFixed(1)} h logged this week · ${hrs(phaseTotal(r.phase_id))} h on the phase in total`}>
                          {alloc == null ? '—' : (Math.round(alloc * 10) / 10).toLocaleString()}</span>
                      })()}
                    </div>
                    <div className="cell ts-l">
                      <label className="sr" htmlFor={'act-' + keyOf(r)}>Activity</label>
                      <select id={'act-' + keyOf(r)} className="input" value={r.activity ?? ''} onChange={(e) => changeActivity(r, e.target.value)}>
                        <option value="">{isOH ? 'Overhead type' : 'Activity'}</option>{(isOH ? OVERHEAD : ACTIVITIES).map((a) => <option key={a}>{a}</option>)}</select>
                    </div>
                    {days.map((d) => <div key={iso(d)} className="cell"><Cell value={cell(r, d)} today={iso(d) === today} note={noteOf(r, d)}
                      label={`${p?.name ?? ''} ${code ?? ''} ${r.activity ?? ''} ${d.toDateString()}`} onCommit={(t) => setCell(r, d, t)} onNote={(t) => setNote(r, d, t)} /></div>)}
                    <div className="cell num" style={{ fontWeight: 700 }}>{hrs(total)}</div>
                    <div className="cell"><button className="linkbtn" style={{ color: 'var(--muted)', fontSize: 18 }} aria-label="Remove row" onClick={() => removeRow(r)}>×</button></div>
                  </div>)
              })}
            </div>
          </section>)
      })}
      </>)}
      {data.data && rows.length === 0 && <p className="muted card pad" style={{ textAlign: 'center' }}><em>Nothing on this week yet. Add a project and phase above, or start the timer in the sidebar.</em></p>}
    </div>
  )
}

/** One day's hours. While it's focused, a note box opens above it (like Monograph); the note saves when you leave.
 *  The box is drawn on the page (fixed position) so the card's scroll area can't clip it. */
function Cell({ value, today, label, note, onCommit, onNote }: { value: number; today: boolean; label: string; note: string; onCommit: (t: string) => void; onNote: (t: string) => void }) {
  const [t, setT] = useState(hrs(value))
  const [n, setN] = useState(note)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  useEffect(() => setT(hrs(value)), [value])
  useEffect(() => { if (!open) setN(note) }, [note, open])
  useEffect(() => {
    if (!open) return
    const place = () => { const r = wrap.current?.getBoundingClientRect(); if (r) setPos({ left: r.left + r.width / 2, top: r.top }) }
    place(); window.addEventListener('scroll', place, true); window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])
  const leave = (e: React.FocusEvent) => {
    const to = e.relatedTarget as Node | null
    if (to && (wrap.current?.contains(to) || pop.current?.contains(to))) return
    setOpen(false)
    if (n !== note) onNote(n)
  }
  return (
    <div ref={wrap} className="ts-cellwrap" onFocus={() => setOpen(true)} onBlur={leave}>
      {open && pos && createPortal(
        <div ref={pop} className="ts-note" role="group" aria-label={`Note for ${label}`} style={{ left: pos.left, top: pos.top }}>
          <textarea rows={2} placeholder="Add a note…" value={n} onChange={(e) => setN(e.target.value)} aria-label="Note"
            onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur() }} />
          <p>Have an expense? <a href="#/expenses">Go to Expenses to add</a></p>
        </div>, document.body)}
      <input aria-label={label} className={'ts-in num' + (today ? ' today' : '')} inputMode="decimal" value={t} onChange={(e) => setT(e.target.value)}
        onFocus={(e) => e.target.select()} onBlur={() => onCommit(t)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      {note && !open && <span className="ts-hasnote" title={note} aria-label="Has a note" />}
    </div>)
}

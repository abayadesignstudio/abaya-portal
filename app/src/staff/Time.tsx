import { useEffect, useMemo, useState } from 'react'
import { supabase, PHASE_NAME, SECTOR_COLOR } from '../lib/supabase'
import './time-mobile.css'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { ACTIVITIES, OVERHEAD, loadProjects, iso, mondayOf, hrs, TIME_CHANGED, announceTimeChange, type Proj } from '../lib/time'
import Combobox, { sectorColor, type ComboOption } from '../components/Combobox'

const PHONE = '(max-width: 900px)'
function useIsPhone() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches)
  useEffect(() => { const q = window.matchMedia(PHONE); const f = () => setM(q.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f) }, [])
  return m
}

const legacyOf = (es: { project_id: string; phase_id: string | null; legacy_phase?: string | null }[], r: { project_id: string; phase_id: string | null }) =>
  es.find((e) => e.project_id === r.project_id && !r.phase_id && !e.phase_id && e.legacy_phase)?.legacy_phase ?? 'No phase'
type Entry = { id: string; work_date: string; minutes: number; note: string | null; activity: string | null; role_label: string | null; project_id: string; phase_id: string | null; legacy_phase?: string | null }
type RowDef = { id?: string; project_id: string; phase_id: string | null; role_label: string | null; activity: string | null }
const keyOf = (r: { project_id: string; phase_id: string | null; activity: string | null }) => `${r.project_id}|${r.phase_id ?? ''}|${r.activity ?? ''}`

export default function Time() {
  const { profile } = useAuth()
  const me = profile!.id
  const [week, setWeek] = useState(() => mondayOf(new Date()))
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(week); d.setDate(d.getDate() + i); return d }), [week])
  const projects = useLoad(loadProjects)
  const data = useLoad(async () => {
    const entries = must(await supabase.from('time_entries').select('id, work_date, minutes, note, activity, role_label, project_id, phase_id, legacy_phase')
      .eq('profile_id', me).gte('work_date', iso(days[0])).lte('work_date', iso(days[6])).order('created_at')) as Entry[]
    const rows = must(await supabase.from('timesheet_rows').select('id, project_id, phase_id, role_label, activity').eq('profile_id', me).order('created_at')) as RowDef[]
    const phaseIds = Array.from(new Set([...rows, ...entries].map((r) => r.phase_id).filter(Boolean))) as string[]
    const totals = phaseIds.length ? must(await supabase.from('time_entries').select('phase_id, minutes').eq('profile_id', me).in('phase_id', phaseIds)) as { phase_id: string; minutes: number }[] : []
    return { entries, rows, totals }
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
  const phaseTotal = (phaseId: string | null) => phaseId ? (data.data?.totals ?? []).filter((t) => t.phase_id === phaseId).reduce((a, t) => a + t.minutes, 0) : 0

  const setCell = async (r: RowDef, d: Date, text: string) => {
    const val = parseFloat(text.replace(',', '.'))
    const minutes = isFinite(val) && val > 0 ? Math.round(val * 60) : 0
    if (minutes > 24 * 60) return setErr('A day can’t have more than 24 hours.')
    const existing = entries.filter((e) => keyOf(e) === keyOf(r) && e.work_date === iso(d))
    if (existing.reduce((a, e) => a + e.minutes, 0) === minutes) return
    setErr('')
    if (existing.length) { const { error } = await supabase.from('time_entries').delete().in('id', existing.map((e) => e.id)); if (error) return setErr(error.message) }
    if (minutes > 0) {
      const { error } = await supabase.from('time_entries').insert({ profile_id: me, project_id: r.project_id, phase_id: r.phase_id, role_label: r.role_label, activity: r.activity,
        work_date: iso(d), minutes, note: existing.map((e) => e.note).filter(Boolean).join(' / ') || null })
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
  const phaseOptions: ComboOption[] = (projects.data ?? []).filter((p) => p.number !== 'OH').flatMap((p): ComboOption[] => (p.phases.length
    ? p.phases.map((ph) => ({ value: `${p.id}|${ph.id}`, chip: p.number, color: sectorColor(p.sector), label: `${p.name} — ${ph.code} · ${PHASE_NAME[ph.code] ?? ''}`, search: ph.code }))
    : [{ value: `${p.id}|`, chip: p.number, color: sectorColor(p.sector), label: p.name, hint: '— no phases yet' }]))
  const phone = useIsPhone()
  const [dayIdx, setDayIdx] = useState(() => { const i = (new Date().getDay() + 6) % 7; return i })
  const day = days[dayIdx]
  const groups = Array.from(new Set(rows.map((r) => r.project_id)))
  const today = iso(new Date())

  return (
    <div className="stack">
      <div className="row between"><h1>Timesheet</h1><span className="muted" style={{ fontSize: 14 }}>Use the <strong>Timer</strong> {phone ? 'bar at the bottom of the screen' : 'at the bottom of the sidebar'} to track time live.</span></div>
      <div className="row between">
        <div className="row" style={phone ? { width: '100%' } : undefined}>
          <Combobox id="ts-add" label="Add project and phase" placeholder="Search for project and add phase" style={{ width: phone ? '100%' : 380 }} clearOnSelect value=""
            options={phaseOptions} onChange={(x) => { const [project_id, phase_id] = x.split('|'); if (project_id) addRow({ project_id, phase_id: phase_id || null, role_label: null, activity: null }) }} />
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
                    const code = p?.phases.find((x) => x.id === r.phase_id)?.code
                    return (
                      <li key={keyOf(r)} className="ts-mrow">
                        <div style={{ minWidth: 0, flex: 1 }}>
                          {!isOH && <div style={{ fontWeight: 700 }}>{code ? `${code} · ${PHASE_NAME[code]}` : legacyOf(data.data?.entries ?? [], r)}</div>}
                          <label className="sr" htmlFor={'mact-' + keyOf(r)}>Activity</label>
                          <select id={'mact-' + keyOf(r)} className="input" style={{ marginTop: 6 }} value={r.activity ?? ''} onChange={(e) => changeActivity(r, e.target.value)}>
                            <option value="">{isOH ? 'Overhead type' : 'Activity'}</option>{(isOH ? OVERHEAD : ACTIVITIES).map((x) => <option key={x}>{x}</option>)}</select>
                        </div>
                        <div className="stack" style={{ gap: 4, alignItems: 'center' }}>
                          <Cell value={cell(r, day)} today={false} label={`Hours, ${isOH ? 'Overhead' : `${p?.number ?? ''} ${p?.name ?? ''} ${code ?? ''}`} ${r.activity ?? ''}, ${day.toDateString()}`} onCommit={(t) => setCell(r, day, t)} />
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
        <div style={{ minWidth: 980 }}>
          <div className="ts-grid" style={{ background: '#f6f5f2', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 14 }}>
            <div className="cell" style={{ textAlign: 'left', paddingLeft: 16 }}>Activity</div>
            {days.map((d) => <div key={iso(d)} className="cell" style={{ background: iso(d) === today ? '#eef2f6' : undefined }}>{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>)}
            <div className="cell">Hours</div><div />
          </div>
          <div className="ts-grid" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="cell" style={{ textAlign: 'left', paddingLeft: 16 }}>All activities <span className="muted">· {rows.length}</span></div>
            {days.map((d) => <div key={iso(d)} className="cell num" style={{ fontWeight: 700 }}>{hrs(dayTotal(d))}</div>)}
            <div className="cell num" style={{ fontWeight: 700 }}>{hrs(weekTotal)}</div><div />
          </div>
        </div>
      </div>

      {groups.map((pid) => {
        const p = pById[pid]
        const isOH = p?.number === 'OH'
        return (
          <section key={pid} className="card" style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 980 }}>
              <h2 className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', gap: 10 }}>
                {p && !isOH && <span className="tag" style={{ background: SECTOR_COLOR[p.sector ?? 'internal'] }}>{p.number}</span>}{isOH ? 'Overhead' : (p?.name ?? 'Project')}</h2>
              {rows.filter((r) => r.project_id === pid).map((r) => {
                const code = p?.phases.find((x) => x.id === r.phase_id)?.code
                const total = days.reduce((a, d) => a + cell(r, d), 0)
                return (
                  <div key={keyOf(r)} style={{ borderBottom: '1px solid #efece6' }}>
                    {!isOH && <div className="row between" style={{ padding: '10px 16px 0' }}>
                      <div><div>{code ? `${code} · ` : ''}{r.role_label ?? 'Role not set'}</div><strong>{code ? PHASE_NAME[code] : legacyOf(data.data?.entries ?? [], r)}</strong></div>
                      {r.phase_id && <span title="Your hours on this phase, all time" className="num" style={{ minWidth: 44, height: 44, borderRadius: '50%', border: '2px solid var(--line)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>{hrs(phaseTotal(r.phase_id))}</span>}
                    </div>}
                    <div className="ts-grid">
                      <div className="cell" style={{ paddingLeft: 16 }}>
                        <label className="sr" htmlFor={'act-' + keyOf(r)}>Activity</label>
                        <select id={'act-' + keyOf(r)} className="input" value={r.activity ?? ''} onChange={(e) => changeActivity(r, e.target.value)}>
                          <option value="">{isOH ? 'Overhead type' : 'Activity'}</option>{(isOH ? OVERHEAD : ACTIVITIES).map((a) => <option key={a}>{a}</option>)}</select>
                      </div>
                      {days.map((d) => <div key={iso(d)} className="cell"><Cell value={cell(r, d)} today={iso(d) === today} label={`${p?.name ?? ''} ${code ?? ''} ${r.activity ?? ''} ${d.toDateString()}`} onCommit={(t) => setCell(r, d, t)} /></div>)}
                      <div className="cell num" style={{ fontWeight: 700 }}>{hrs(total)}</div>
                      <div className="cell"><button className="linkbtn" style={{ color: 'var(--muted)', fontSize: 18 }} aria-label="Remove row" onClick={() => removeRow(r)}>×</button></div>
                    </div>
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

function Cell({ value, today, label, onCommit }: { value: number; today: boolean; label: string; onCommit: (t: string) => void }) {
  const [t, setT] = useState(hrs(value))
  useEffect(() => setT(hrs(value)), [value])
  return <input aria-label={label} className={'ts-in num' + (today ? ' today' : '')} inputMode="decimal" value={t} onChange={(e) => setT(e.target.value)}
    onFocus={(e) => e.target.select()} onBlur={() => onCommit(t)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
}

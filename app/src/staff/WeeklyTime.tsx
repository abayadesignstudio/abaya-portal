import { useMemo, useState } from 'react'
import { supabase, money } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { iso, mondayOf } from '../lib/time'
import Avatar from '../components/Avatar'

/** Bills page, right side: this week's logged time for everyone, against each person's weekly target
 *  (utilization target × 40 h) and the firm's weekly revenue need (billable hours × billing rate). */

type Person = { id: string; full_name: string | null; initials: string | null; avatar_url: string | null; util_target: number | null; bill_rate: number | null }
type Entry = { profile_id: string; minutes: number }
const WEEK_HOURS = 40
const h1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString()

export default function WeeklyTime({ weeklyNeed }: { weeklyNeed: number }) {
  const [start, setStart] = useState(() => mondayOf(new Date()))
  const end = useMemo(() => { const d = new Date(start); d.setDate(d.getDate() + 6); return d }, [start])
  const shift = (weeks: number) => { const d = new Date(start); d.setDate(d.getDate() + 7 * weeks); setStart(d) }
  const thisWeek = iso(start) === iso(mondayOf(new Date()))

  const data = useLoad(async () => {
    const people = must(await supabase.from('profiles').select('id, full_name, initials, avatar_url, util_target, bill_rate').in('role', ['admin', 'staff']).order('full_name')) as Person[]
    const entries = must(await supabase.from('time_entries').select('profile_id, minutes').eq('billable', true).gte('work_date', iso(start)).lte('work_date', iso(end))) as Entry[]
    return { people, entries }
  }, [iso(start)])

  const rows = (data.data?.people ?? []).map((p) => {
    // billable time only — overhead and other non-billable time doesn't count toward the target
    const billable = (data.data?.entries ?? []).filter((e) => e.profile_id === p.id).reduce((a, e) => a + e.minutes, 0) / 60
    const target = WEEK_HOURS * (Number(p.util_target) || 0) / 100
    return { p, billable, target, value: billable * (Number(p.bill_rate) || 0) }
  })
  const value = rows.reduce((a, r) => a + r.value, 0)
  const billable = rows.reduce((a, r) => a + r.billable, 0)
  const target = rows.reduce((a, r) => a + r.target, 0)
  // how far through the work week we are (Mon–Fri), so a Tuesday isn't judged against a full week
  const now = new Date()
  const workDaysGone = thisWeek ? Math.min(5, Math.max(0, ((now.getDay() + 6) % 7) + (now.getHours() >= 17 ? 1 : 0.5))) : 5
  const pace = workDaysGone / 5
  const label = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  return (
    <section className="card pad stack wt" aria-labelledby="wt-h">
      <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <div>
          <h2 id="wt-h" style={{ margin: 0 }}>Time this week</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Billable hours against each person’s target ({WEEK_HOURS} h × utilization).</p>
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button type="button" className="btn small secondary" style={{ minHeight: 30, padding: '0 9px' }} onClick={() => shift(-1)} aria-label="Previous week">‹</button>
          <button type="button" className="btn small secondary" style={{ minHeight: 30, padding: '0 9px' }} onClick={() => shift(1)} aria-label="Next week" disabled={thisWeek}>›</button>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{label}{thisWeek && <span className="muted" style={{ fontWeight: 400 }}> · this week</span>}</p>

      <div className="wt-need">
        <div className="row between" style={{ fontSize: 14 }}><strong>Billable value</strong><span className="num"><strong>{money(Math.round(value))}</strong> of {money(Math.round(weeklyNeed))}</span></div>
        <div className="bar wt-bar" aria-hidden="true"><span style={{ width: `${weeklyNeed ? Math.min(100, value / weeklyNeed * 100) : 0}%`, background: value >= weeklyNeed * pace ? '#067647' : '#b54708' }} />{thisWeek && pace < 1 && <i style={{ left: `${pace * 100}%` }} />}</div>
        <p className={value >= weeklyNeed * pace ? 'wt-ok' : 'wt-warn'} style={{ margin: '6px 0 0', fontSize: 13 }}>
          {weeklyNeed ? `${Math.round(value / weeklyNeed * 100)}% of the weekly need` : ''}
          {thisWeek && pace < 1 ? (value >= weeklyNeed * pace ? ' — on pace so far.' : ` — ${money(Math.round(weeklyNeed * pace - value))} behind pace.`) : value >= weeklyNeed ? ' — covered.' : ` — ${money(Math.round(weeklyNeed - value))} short.`}</p>
        <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>Billable hours × each person’s billing rate, against this year’s need ÷ 52.</p>
      </div>

      <ul className="wt-list">
        {rows.map(({ p, billable: b, target: t }) => {
          const ok = b >= t * pace
          return (
            <li key={p.id}>
              <div className="row between" style={{ flexWrap: 'nowrap', gap: 10 }}>
                <span className="row" style={{ gap: 8, flexWrap: 'nowrap', minWidth: 0 }}><Avatar url={p.avatar_url} name={p.full_name} initials={p.initials} size={26} /><strong className="wt-name">{p.full_name ?? 'Unnamed'}</strong></span>
                <span className="num" style={{ fontSize: 14, whiteSpace: 'nowrap' }}><strong>{h1(b)}</strong> / {h1(t)} h</span>
              </div>
              <div className="bar wt-bar" aria-hidden="true"><span style={{ width: `${t ? Math.min(100, b / t * 100) : 0}%`, background: ok ? 'var(--navy)' : '#b54708' }} />{thisWeek && pace < 1 && <i style={{ left: `${pace * 100}%` }} />}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3, textAlign: 'right' }}>{t ? `${Math.round(b / t * 100)}% of target` : 'No target set'}</div>
            </li>)
        })}
      </ul>
      <div className="row between" style={{ fontSize: 14, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <strong>Firm</strong><span className="num"><strong>{h1(billable)}</strong> / {h1(target)} h billable</span>
      </div>
      {thisWeek && pace < 1 && <p className="muted" style={{ margin: 0, fontSize: 12 }}>The tick on each bar is where you should be by now in the work week.</p>}
    </section>
  )
}

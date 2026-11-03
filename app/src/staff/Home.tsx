import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'

export default function StaffHome() {
  const { profile } = useAuth()
  const monday = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10) })()
  const yearStart = new Date().getFullYear() + '-01-01'
  const { data } = useLoad(async () => {
    const week = must(await supabase.from('time_entries').select('minutes').eq('profile_id', profile!.id).gte('work_date', monday)) as { minutes: number }[]
    const ytd = must(await supabase.from('time_entries').select('minutes, billable').eq('profile_id', profile!.id).gte('work_date', yearStart)) as { minutes: number; billable: boolean }[]
    const timer = must(await supabase.from('timers').select('started_at').eq('profile_id', profile!.id).maybeSingle())
    return { week: week.reduce((a, e) => a + e.minutes, 0) / 60, bill: ytd.filter((e) => e.billable).reduce((a, e) => a + e.minutes, 0) / 60, ytd: ytd.reduce((a, e) => a + e.minutes, 0) / 60, timer }
  }, [profile?.id])
  const target = profile?.util_target ? Math.round(1920 * Number(profile.util_target) / 100) : null
  const hour = new Date().getHours()
  return (
    <div className="stack">
      <div className="row between">
        <div><p className="muted" style={{ margin: 0 }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <h1>Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, {(profile?.full_name || '').split(' ')[0] || 'there'}</h1></div>
        <Link className="btn" to="/time">{data?.timer ? '● Timer running' : '▶ Start timer'}</Link>
      </div>
      <section className="card pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
        <div><div className="muted">This week</div><div className="num" style={{ fontSize: 26, fontWeight: 700 }}>{(data?.week ?? 0).toFixed(1)} <span style={{ fontSize: 15 }}>of 40 hrs</span></div></div>
        <div><div className="muted">Logged this year</div><div className="num" style={{ fontSize: 26, fontWeight: 700 }}>{(data?.ytd ?? 0).toFixed(0)}</div></div>
        <div><div className="muted">Billable this year</div><div className="num" style={{ fontSize: 26, fontWeight: 700 }}>{(data?.bill ?? 0).toFixed(0)}{target && <span style={{ fontSize: 15 }}> of {target}</span>}</div></div>
      </section>
      <p className="muted" style={{ fontSize: 13 }}>Calendar, deliverables and notifications are added on day 5.</p>
    </div>)
}

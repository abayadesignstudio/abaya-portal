import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { MULTIPLIER } from '../lib/fees'
import Avatar from '../components/Avatar'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { workload, fmt, AVAILABLE_HRS, yearFraction, isoDate, mondayOf } from './workload'
import './home.css'

type Person = { id: string; full_name: string | null; email: string; title: string | null; role: string; util_target: number | null; bill_rate: number | null; avatar_url: string | null }
type Entry = { profile_id: string; project_id: string | null; work_date: string; minutes: number; billable: boolean }

export default function Employees() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const year = new Date().getFullYear()
  const people = useLoad(async () => must(await supabase.from('profiles').select('id, full_name, email, title, role, util_target, bill_rate, avatar_url').in('role', ['admin', 'staff']).order('full_name')) as Person[])
  // Overhead (OH) time is never billable, whatever the entry says
  const time = useLoad(async () => (must(await supabase.from('time_entries').select('profile_id, project_id, work_date, minutes, billable, projects(number)').gte('work_date', `${year}-01-01`).lte('work_date', `${year}-12-31`)) as unknown as (Entry & { projects: { number: string } | null })[])
    .map((e) => ({ ...e, billable: e.billable && e.projects?.number !== 'OH' })))
  // a person's rate on a project (set on the project's team) wins over their standard rate
  const rates = useLoad(async () => must(await supabase.from('project_members').select('profile_id, project_id, bill_rate').not('bill_rate', 'is', null)) as { profile_id: string; project_id: string; bill_rate: number }[])

  const frac = yearFraction()

  return (
    <div className="stack">
      <div><h1>Employees</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>{year} · {Math.round(frac * 100)}% of the year gone · <em>{fmt(AVAILABLE_HRS)} available hours each (2,080 less 10 holidays and 10 PTO days)</em></p></div>
      {people.error && <p className="err">{people.error}</p>}
      <section className="em-cards" aria-label="Hours and utilization">
        {(people.data ?? []).map((p) => {
          const mine = (time.data ?? []).filter((t) => t.profile_id === p.id)
          const w = workload(p.util_target, mine.reduce((a, t) => a + t.minutes, 0), mine.filter((t) => t.billable).reduce((a, t) => a + t.minutes, 0))
          return <div key={p.id} className="em-col">
            <PersonCard p={p} w={w} canEdit={isAdmin} onSaved={people.reload} />
            <EarnedCard p={p} entries={mine} rates={rates.data ?? []} target={w.target} />
            <EarnedCard p={p} entries={mine} rates={rates.data ?? []} target={w.target} takeHome />
          </div>
        })}
        {people.data && people.data.length === 0 && <p className="muted"><em>No staff have signed in yet.</em></p>}
      </section>

    </div>
  )
}

function PersonCard({ p, w, canEdit, onSaved }: { p: Person; w: ReturnType<typeof workload>; canEdit: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState(false)
  const [util, setUtil] = useState(String(p.util_target ?? '')); const [rate, setRate] = useState(String(p.bill_rate ?? ''))
  const [err, setErr] = useState('')
  const save = async () => {
    const { error } = await supabase.from('profiles').update({ util_target: util === '' ? null : Number(util), bill_rate: rate === '' ? null : Number(rate) }).eq('id', p.id)
    if (error) return setErr(error.message)
    setErr(''); setEdit(false); onSaved()
  }
  const ini = (p.full_name || p.email).split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase()
  return (
    <article className="card pad stack">
      <div className="row" style={{ gap: 12 }}>
        <Avatar url={p.avatar_url} initials={ini} size={44} />
        <div style={{ flex: 1 }}><h2 style={{ fontSize: 18 }}>{p.full_name || p.email}</h2><p className="muted" style={{ margin: '2px 0 0', fontSize: 14 }}>{p.title || (p.role === 'admin' ? 'Admin' : 'Staff')}{p.bill_rate ? ` · $${p.bill_rate}/hr` : ''}</p></div>
        <div style={{ textAlign: 'right' }}><p className="num" style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{w.util ? w.util + '%' : '—'}</p><p className="muted" style={{ margin: 0, fontSize: 12 }}>utilization target</p></div>
      </div>
      {edit ? (
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div><label className="l" htmlFor={'ut-' + p.id}>Target %</label><input id={'ut-' + p.id} className="input num" style={{ width: 100 }} inputMode="decimal" value={util} onChange={(e) => setUtil(e.target.value)} /></div>
          <div><label className="l" htmlFor={'br-' + p.id}>Billable rate $/hr</label><input id={'br-' + p.id} className="input num" style={{ width: 130 }} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          <button className="btn small" onClick={save}>Save</button><button className="btn small secondary" onClick={() => setEdit(false)}>Cancel</button>
        </div>
      ) : w.util ? (
        <div>
          <div className="row between" style={{ fontSize: 14 }}><strong className="num">{fmt(w.bill)} of {fmt(w.target)} billable hrs</strong>
            <span style={{ fontWeight: 700, color: w.diff >= 0 ? 'var(--green)' : w.diff > -40 ? 'var(--amber)' : 'var(--red)' }}>{fmt(Math.abs(w.diff))} hrs {w.diff >= 0 ? 'ahead of' : 'behind'} pace</span></div>
          <div className="bar" aria-hidden="true" style={{ marginTop: 8 }}><span className="fill" style={{ width: w.fillPct + '%' }} /><span className="tick" style={{ left: w.pacePct + '%' }} /></div>
          <p className="muted num" style={{ margin: '6px 0 0', fontSize: 12 }}><em>Orange tick = {fmt(w.pace)} hrs expected by today</em></p>
        </div>
      ) : <p className="muted" style={{ margin: 0, fontSize: 14 }}><em>No utilization target set.</em></p>}
      {err && <p className="err" role="alert">{err}</p>}
      <dl className="em-stats">
        <div><dt>Target hrs / yr</dt><dd>{w.util ? fmt(w.target) : '—'}</dd></div>
        <div><dt>Logged YTD</dt><dd>{fmt(w.logged)}</dd></div>
        <div><dt>Utilization to date</dt><dd style={{ color: w.util ? (w.actual >= w.util ? 'var(--green)' : w.actual >= w.util - 5 ? 'var(--amber)' : 'var(--red)') : undefined }}>{w.actual}%</dd></div>
        <div><dt>Billable YTD</dt><dd>{fmt(w.bill)}</dd></div>
        <div><dt>Non-billable</dt><dd>{fmt(w.nonbill)}</dd></div>
        <div><dt>Billable hrs left</dt><dd>{w.util ? fmt(w.left) : '—'}</dd></div>
      </dl>
      {canEdit && !edit && <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit(true)}>Edit target and rate</button>}
    </article>
  )
}

// ---- billable earnings: billable hours × rate, this week / month / year, against the person's quota
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const hr = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const weekdays = (a: Date, b: Date) => { let n = 0; const d = new Date(a); while (d <= b) { if (d.getDay() % 6) n++; d.setDate(d.getDate() + 1) } return n }
/** Billable earned (what the person billed), or with takeHome: their pay out of it (billed ÷ the multiplier). */
function EarnedCard({ p, entries, rates, target, takeHome }: { p: Person; entries: Entry[]; rates: { profile_id: string; project_id: string; bill_rate: number }[]; target: number; takeHome?: boolean }) {
  const k = takeHome ? 1 / MULTIPLIER : 1
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const rateOf = (e: Entry) => Number(rates.find((r) => r.profile_id === p.id && r.project_id === e.project_id)?.bill_rate ?? p.bill_rate ?? 0)
  const wk0 = mondayOf(today), wk1 = new Date(wk0); wk1.setDate(wk1.getDate() + 6)
  const mo0 = new Date(today.getFullYear(), today.getMonth(), 1), mo1 = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  const yr0 = new Date(today.getFullYear(), 0, 1), yr1 = new Date(today.getFullYear(), 11, 31)
  const yrDays = weekdays(yr0, yr1)
  const periods = ([['This week', `${wk0.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${wk1.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, wk0, wk1],
    ['This month', today.toLocaleDateString('en-US', { month: 'long' }), mo0, mo1], ['This year', String(today.getFullYear()), yr0, yr1]] as [string, string, Date, Date][]).map(([label, sub, a, b]) => {
    const from = isoDate(a), to = isoDate(b)
    const mine = entries.filter((e) => e.billable && e.work_date >= from && e.work_date <= to)
    const hrs = mine.reduce((s, e) => s + e.minutes / 60, 0)
    const earned = mine.reduce((s, e) => s + e.minutes / 60 * rateOf(e), 0)
    // quota: the yearly billable target spread over the year's weekdays; the full year uses the target itself
    const quotaHrs = label === 'This year' ? target : target * weekdays(a, b) / yrDays
    const quota = quotaHrs * Number(p.bill_rate ?? 0)
    const pace = weekdays(a, b) ? Math.min(1, weekdays(a, today < b ? today : b) / weekdays(a, b)) : 0
    return { label, sub, hrs, earned, quotaHrs, quota, left: Math.max(0, quotaHrs - hrs), pace }
  })
  const pct = (x: typeof periods[number]) => x.quotaHrs > 0 ? Math.min(100, x.hrs / x.quotaHrs * 100) : 0
  return (
    <article className="card pad stack em-earn" aria-label={`${p.full_name || p.email} ${takeHome ? 'take-home pay' : 'billable earnings'}`}>
      <h3>{takeHome ? 'Take home' : 'Billable earned'}</h3>
      {!target && <p className="muted" style={{ margin: 0, fontSize: 14 }}><em>Set a utilization target to see a goal.</em></p>}
      {periods.map((x) => {
        const met = x.quotaHrs > 0 && x.hrs >= x.quotaHrs - 0.005
        const behind = !met && x.hrs < x.quotaHrs * x.pace - 0.5
        return <div key={x.label} className="em-per">
          <div className="row between"><span><strong>{x.label}</strong> <span className="muted">{x.sub}</span></span>
            <span className="num em-amt"><strong>{usd(x.earned * k)}</strong>{x.quota > 0 && <span className="muted"> / {usd(x.quota * k)}</span>}</span></div>
          {x.quotaHrs > 0 && <div className="bar" role="img" aria-label={`${Math.round(pct(x))}% of goal`} style={{ marginTop: 6 }}>
            <span className="fill" style={{ width: pct(x) + '%', background: met ? 'var(--green)' : undefined }} />
            {x.pace < 1 && <span className="tick" style={{ left: x.pace * 100 + '%' }} />}</div>}
          <div className="row between em-per-sub"><span className="num muted">{hr(x.hrs)} hrs billed</span>
            {x.quotaHrs > 0 && <span className="num" style={{ fontWeight: 700, color: met ? 'var(--green)' : behind ? 'var(--red)' : 'var(--text)' }}>{met ? 'Goal met' : `${hr(x.left)} hrs to go`}</span>}</div>
        </div>
      })}
      <p className="muted em-foot"><em>{takeHome
        ? <>Pay = billed ÷ {MULTIPLIER} ({MULTIPLIER}× multiplier); the rest covers overhead &amp; profit. Goal = pay at the utilization target. Orange tick = where you should be by today.</>
        : <>Billed = billable hours × billing rate. Goal = utilization target at {p.bill_rate ? `$${p.bill_rate}/hr` : 'their rate'}. Orange tick = where you should be by today.</>}</em></p>
    </article>
  )
}

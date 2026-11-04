import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SECTOR_COLOR } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { workload, fmt, isoDate, parseDate, mondayOf } from './workload'
import { MonthCalendar, useStaff } from './HomeCalendars'
import './home.css'

type Dl = { id: string; title: string; due_date: string | null; status: string; created_at: string; projects: { number: string; name: string; sector: string | null } | null; phases: { code: string } | null }
type Note = { id: number; kind: string; text: string; href: string | null; read_at: string | null; created_at: string }
type P = { id: string; number: string; name: string }

const STATUS: Record<string, [string, string, string]> = {
  todo: ['Not started', '#475467', '#f2f4f7'], in_progress: ['In progress', '#ffffff', '#039855'], in_review: ['In review', '#ffffff', '#b54708'], done: ['Done', '#344054', '#e4e7ec'],
}
const DAY_MS = 86400000

export default function StaffHome() {
  const { profile } = useAuth()
  const me = profile!.id
  const admin = profile?.role === 'admin'
  const staff = useStaff()
  const todayIso = isoDate(new Date())
  const [dFilter, setDFilter] = useState<'week' | 'all'>('week')

  const hours = useLoad(async () => {
    const ytd = must(await supabase.from('time_entries').select('minutes, billable, work_date').eq('profile_id', me).gte('work_date', new Date().getFullYear() + '-01-01')) as { minutes: number; billable: boolean; work_date: string }[]
    return ytd
  }, [me])
  const dls = useLoad(async () => must(await supabase.from('deliverables').select('id, title, due_date, status, created_at, projects(number, name, sector), phases(code)')
    .eq('assignee', me).order('due_date', { nullsFirst: false })) as unknown as Dl[], [me])
  const notes = useLoad(async () => must(await supabase.from('notifications').select('id, kind, text, href, read_at, created_at').eq('profile_id', me).order('created_at', { ascending: false }).limit(30)) as Note[], [me])
  const projects = useLoad(async () => must(await supabase.from('projects').select('id, number, name').in('status', ['active', 'paused']).order('number', { ascending: false })) as P[])

  // hours card
  const entries = hours.data ?? []
  const w = workload(profile?.util_target ?? null, entries.reduce((a, e) => a + e.minutes, 0), entries.filter((e) => e.billable).reduce((a, e) => a + e.minutes, 0))
  const thisMonday = mondayOf(new Date())
  const weekBars = Array.from({ length: 5 }, (_, i) => { const d = new Date(thisMonday); d.setDate(d.getDate() + i); const m = entries.filter((e) => e.work_date === isoDate(d)).reduce((a, e) => a + e.minutes, 0); return { d, h: m / 60 } })
  const weekTotal = weekBars.reduce((a, b) => a + b.h, 0)

  // deliverables list
  const dayDiff = (s: string) => Math.round((parseDate(s).getTime() - parseDate(todayIso).getTime()) / DAY_MS)
  const dlList = (dls.data ?? []).filter((d) => dFilter === 'all' || (d.status !== 'done' && d.due_date && dayDiff(d.due_date) <= 7))
  const setStatus = async (id: string, status: string) => { await supabase.from('deliverables').update({ status }).eq('id', id); dls.reload() }

  const unread = (notes.data ?? []).filter((n) => !n.read_at).length
  const markRead = async (id: number) => { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id); notes.reload() }
  const markAll = async () => { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('profile_id', me).is('read_at', null); notes.reload() }

  const hour = new Date().getHours()
  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div><p className="muted" style={{ margin: 0 }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <h1 style={{ fontSize: 28, marginTop: 2 }}>Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, {(profile?.full_name || '').split(' ')[0] || 'there'}</h1></div>
        <div className="row"><Link className="btn secondary" to="/time">Open timesheet</Link><Link className="btn secondary" to="/invoices/new">+ Invoice</Link></div>
      </div>

      <div className="hm-grid">
        <div className="stack" style={{ minWidth: 0 }}>
          <MonthCalendar me={me} admin={admin} people={staff.data ?? []} projects={projects.data ?? []} />

          <section className="card pad stack" aria-labelledby="hm-dl">
            <div className="row between">
              <h2 id="hm-dl">My deliverables <span className="muted" style={{ fontWeight: 400 }}>· {(dls.data ?? []).filter((d) => d.status !== 'done').length} open</span></h2>
              <div className="row" role="group" aria-label="Show">
                <button className={'btn small' + (dFilter === 'week' ? '' : ' secondary')} aria-pressed={dFilter === 'week'} onClick={() => setDFilter('week')}>Due in the next 7 days</button>
                <button className={'btn small' + (dFilter === 'all' ? '' : ' secondary')} aria-pressed={dFilter === 'all'} onClick={() => setDFilter('all')}>All assigned</button>
              </div>
            </div>
            {dls.error && <p className="err">{dls.error}</p>}
            {dls.data && dlList.length === 0 && <p className="muted" style={{ margin: 0 }}><em>{dFilter === 'week' ? 'Nothing due in the next 7 days.' : 'No deliverables are assigned to you yet.'}</em></p>}
            <div>
              {dlList.map((d) => {
                const st = STATUS[d.status] ?? STATUS.todo
                const dd = d.due_date ? dayDiff(d.due_date) : null
                const over = dd !== null && dd < 0 && d.status !== 'done'
                const dueTxt = dd === null ? 'No due date' : over ? `${-dd} day${dd === -1 ? '' : 's'} overdue` : dd === 0 ? 'Due today' : `Due ${parseDate(d.due_date!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${dd} day${dd === 1 ? '' : 's'}`
                return (
                  <div key={d.id} className="hm-dl">
                    <div style={{ minWidth: 0 }}>
                      <p className="row" style={{ margin: 0, gap: 8 }}>{d.projects && <span className="tag" style={{ background: SECTOR_COLOR[d.projects.sector ?? 'internal'] }}>{d.projects.number}</span>}{d.phases && <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{d.phases.code}</span>}</p>
                      <p style={{ margin: '4px 0 0', fontWeight: 700, textDecoration: d.status === 'done' ? 'line-through' : 'none' }}>{d.title}</p>
                      {d.projects && <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>{d.projects.name}</p>}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: over ? 'var(--red)' : dd !== null && dd <= 2 ? 'var(--amber)' : 'var(--muted)' }}>{dueTxt}</span>
                    <div><label className="sr" htmlFor={'dl-' + d.id}>Status of {d.title}</label>
                      <select id={'dl-' + d.id} className="input" value={d.status} onChange={(e) => setStatus(d.id, e.target.value)} style={{ minHeight: 38, fontWeight: 700, color: st[1], background: st[2] }}>
                        <option value="todo">Not started</option><option value="in_progress">In progress</option><option value="in_review">In review</option><option value="done">Done</option></select></div>
                  </div>)
              })}
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="card pad stack" aria-labelledby="hm-me">
            <div className="row" style={{ gap: 12 }}>
              <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--navy)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>{(profile?.full_name || profile?.email || '?').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase()}</span>
              <div style={{ flex: 1 }}><h2 id="hm-me">My hours</h2><p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>{profile?.title || (profile?.role === 'admin' ? 'Admin' : 'Staff')}</p></div>
              <div style={{ textAlign: 'right' }}><p className="num" style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{w.util ? w.util + '%' : '—'}</p><p className="muted" style={{ margin: 0, fontSize: 12 }}>utilization target</p></div>
            </div>
            {w.util ? (
              <div>
                <div className="row between" style={{ fontSize: 14 }}><strong className="num">{fmt(w.bill)} of {fmt(w.target)} billable hrs</strong>
                  <span style={{ fontWeight: 700, color: w.diff >= 0 ? 'var(--green)' : 'var(--amber)' }}>{fmt(Math.abs(w.diff))} hrs {w.diff >= 0 ? 'ahead of' : 'behind'} pace</span></div>
                <div className="bar" aria-hidden="true" style={{ marginTop: 8 }}><span className="fill" style={{ width: w.fillPct + '%' }} /><span className="tick" style={{ left: w.pacePct + '%' }} /></div>
                <p className="muted num" style={{ margin: '6px 0 0', fontSize: 12 }}><em>Orange tick = {fmt(w.pace)} hrs expected by today</em></p>
              </div>
            ) : <p className="muted" style={{ margin: 0, fontSize: 14 }}><em>No utilization target set. An admin can set it on the Employees page.</em></p>}
            <dl className="em-stats">
              <div><dt>Logged YTD</dt><dd>{fmt(w.logged)}</dd></div>
              <div><dt>Utilization</dt><dd style={{ color: w.util && w.actual < w.util ? 'var(--amber)' : undefined }}>{w.actual}%</dd></div>
              <div><dt>Billable left</dt><dd>{w.util ? fmt(w.left) : '—'}</dd></div>
            </dl>
            <div style={{ paddingTop: 12, borderTop: '1px solid #ece9e3' }}>
              <div className="row between" style={{ fontSize: 14 }}><strong>This week</strong><span className="num"><strong>{weekTotal.toFixed(1)}</strong> of 40 hrs</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, alignItems: 'end', height: 84, marginTop: 8 }} aria-label={`Hours this week: ${weekBars.map((b) => b.d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + b.h.toFixed(1)).join(', ')}`}>
                {weekBars.map((b) => <div key={isoDate(b.d)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, justifyContent: 'flex-end', height: '100%' }}>
                  <span className="num muted" style={{ fontSize: 11 }}>{b.h ? b.h.toFixed(1) : '—'}</span>
                  <span aria-hidden="true" style={{ width: '100%', height: Math.max(4, Math.min(60, b.h / 9 * 60)), borderRadius: '4px 4px 0 0', background: isoDate(b.d) === todayIso ? 'var(--navy)' : '#c9c4b8' }} />
                  <span style={{ fontSize: 12 }}>{b.d.toLocaleDateString('en-US', { weekday: 'short' })}</span></div>)}
              </div>
            </div>
            <Link to="/employees" style={{ fontSize: 14, fontWeight: 700 }}>All employees ›</Link>
          </section>

          <section className="card pad stack" aria-labelledby="hm-nt">
            <div className="row between"><h2 id="hm-nt">Notifications <span style={{ fontSize: 14, color: unread ? 'var(--red)' : 'var(--muted)' }}>{unread ? unread + ' new' : 'All caught up'}</span></h2>
              {unread > 0 && <button className="linkbtn" onClick={markAll}>Mark all read</button>}</div>
            {notes.error && <p className="err">{notes.error}</p>}
            {notes.data && notes.data.length === 0 && <p className="muted" style={{ margin: 0 }}><em>No notifications yet. Invoice views, payments, client comments and assignments will show up here.</em></p>}
            <ul style={{ listStyle: 'none', margin: '0 -8px', padding: 0 }}>
              {(notes.data ?? []).map((n) => (
                <li key={n.id} className="hm-note" style={{ background: n.read_at ? '#fff' : '#f4f7fa' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {n.href ? <a href={n.href} onClick={() => !n.read_at && markRead(n.id)} style={{ color: 'var(--text)', textDecoration: 'none', fontWeight: n.read_at ? 400 : 700, fontSize: 14 }}>{n.text}</a>
                      : <span style={{ fontWeight: n.read_at ? 400 : 700, fontSize: 14 }}>{n.text}</span>}
                    <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>{new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                  </div>
                  {!n.read_at && <button className="linkbtn" style={{ fontSize: 12, alignSelf: 'flex-start' }} onClick={() => markRead(n.id)} aria-label={'Mark read: ' + n.text}>
                    <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#2b5c8a', marginRight: 6 }} />Mark read</button>}
                </li>))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

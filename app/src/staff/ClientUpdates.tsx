import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SECTOR_COLOR } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { KIND_LABEL, fmtDate } from '../lib/projectContent'

type U = { id: string; kind: string; title: string | null; body: string | null; items: string[]; notify: string; visible_to_client: boolean; created_at: string; project_id: string
  projects: { number: string; name: string; sector: string | null; clients: { name: string } | null } | null }
type Settings = { digest_time: string; digest_enabled: boolean }

export default function ClientUpdates() {
  const { profile } = useAuth()
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const d = useLoad(async () => ({
    settings: must(await supabase.from('firm_settings').select('digest_time, digest_enabled').eq('id', 1).single()) as Settings,
    queue: must(await supabase.from('updates').select('id, kind, title, body, items, notify, visible_to_client, created_at, project_id, projects(number, name, sector, clients(name))')
      .eq('notify', 'digest').eq('visible_to_client', true).gte('created_at', start.toISOString()).order('created_at')) as unknown as U[],
    sent: must(await supabase.from('updates').select('id, kind, title, body, items, notify, visible_to_client, created_at, project_id, projects(number, name, sector, clients(name))')
      .in('notify', ['now', 'digest']).eq('visible_to_client', true).lt('created_at', start.toISOString()).order('created_at', { ascending: false }).limit(40)) as unknown as U[],
    projects: must(await supabase.from('projects').select('id, number, name').in('status', ['active', 'paused']).neq('number', 'OH').order('number', { ascending: false })) as { id: string; number: string; name: string }[],
  }))
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [f, setF] = useState({ project_id: '', title: '', body: '' })
  if (d.error) return <p className="err">{d.error}</p>
  if (!d.data) return <p>Loading…</p>
  const { settings, queue, sent, projects } = d.data
  const byProject = queue.reduce<Record<string, U[]>>((a, u) => { (a[u.project_id] ??= []).push(u); return a }, {})
  const time12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }

  const saveSettings = async (patch: Partial<Settings>) => {
    const { error } = await supabase.from('firm_settings').update(patch).eq('id', 1)
    if (error) setErr(error.message); else { setMsg('Settings saved.'); d.reload() }
  }
  const sendNow = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('')
    if (!f.project_id || !f.body.trim()) return setErr('Choose a project and write a message.')
    const { error } = await supabase.from('updates').insert({ project_id: f.project_id, author: profile?.id, kind: 'memo', title: f.title.trim() || null, body: f.body.trim(), notify: 'now', visible_to_client: true })
    if (error) return setErr(error.message)
    setF({ project_id: f.project_id, title: '', body: '' }); setMsg('Posted to the client’s feed. The email will go out once sending is connected.'); d.reload()
  }
  const hold = async (u: U) => { await supabase.from('updates').update({ notify: 'none' }).eq('id', u.id); d.reload() }

  return (
    <div className="stack">
      <h1>Notifications</h1>
      <p className="err" role="note" style={{ margin: 0 }}><strong>Emails are not connected yet.</strong> Everything below is recorded and shown in each client’s portal; the 6 PM summary and “send now” emails start once billing@abayadesignstudio.com is set up (day 5).</p>
      {err && <p className="err" role="alert">{err}</p>}{msg && <p className="ok" role="status">{msg}</p>}
      <section className="card pad row between" aria-label="Summary settings">
        <div><h2>Daily summary</h2><p className="muted" style={{ margin: '4px 0 0' }}>One email per client, only on days with updates, at {time12(settings.digest_time)} Central.</p></div>
        <div className="row">
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={settings.digest_enabled} onChange={(e) => saveSettings({ digest_enabled: e.target.checked })} style={{ width: 18, height: 18 }} />Send daily summaries</label>
          <label className="sr" htmlFor="dg-t">Send time</label>
          <input id="dg-t" type="time" className="input" style={{ width: 130 }} defaultValue={settings.digest_time.slice(0, 5)} onBlur={(e) => { if (e.target.value && e.target.value !== settings.digest_time.slice(0, 5)) saveSettings({ digest_time: e.target.value }) }} />
        </div>
      </section>

      <section className="card pad stack" aria-labelledby="q-h">
        <h2 id="q-h">Tonight’s summary <span className="muted" style={{ fontWeight: 400 }}>· {queue.length} update{queue.length === 1 ? '' : 's'} for {Object.keys(byProject).length} project{Object.keys(byProject).length === 1 ? '' : 's'}</span></h2>
        {queue.length === 0 && <p className="muted" style={{ margin: 0 }}><em>Nothing queued today. Posts marked “Include in tonight’s summary” appear here.</em></p>}
        {Object.entries(byProject).map(([pid, list]) => { const p = list[0].projects
          return <div key={pid} style={{ borderTop: '1px solid #efece6', paddingTop: 10 }}>
            <div className="row" style={{ gap: 8 }}>{p && <span className="tag" style={{ background: SECTOR_COLOR[p.sector ?? 'internal'] }}>{p.number}</span>}<Link to={`/projects/${pid}`} style={{ fontWeight: 700 }}>{p?.name}</Link><span className="muted">→ {p?.clients?.name ?? 'no client'}</span></div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>{list.map((u) => <li key={u.id} style={{ margin: '4px 0' }}><span className="pill" style={{ marginRight: 6 }}>{KIND_LABEL[u.kind] ?? u.kind}</span>{u.title ?? (u.body ?? u.items.join('; ')).slice(0, 120)}
              <button className="linkbtn" style={{ marginLeft: 8 }} onClick={() => hold(u)}>Leave out</button></li>)}</ul></div> })}
      </section>

      <form onSubmit={sendNow} className="card pad stack" aria-labelledby="sn-h">
        <h2 id="sn-h">Send a notice now</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) minmax(220px,1fr)', gap: 12 }}>
          <div><label className="l" htmlFor="sn-p">Project</label><select id="sn-p" className="input" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</select></div>
          <div><label className="l" htmlFor="sn-t">Subject (optional)</label><input id="sn-t" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        </div>
        <div><label className="l" htmlFor="sn-b">Message</label><textarea id="sn-b" className="input" rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
        <div><button className="btn">Post &amp; send now</button></div>
      </form>

      <section className="card pad stack" aria-labelledby="sl-h">
        <h2 id="sl-h">Earlier notices</h2>
        {sent.length === 0 && <p className="muted" style={{ margin: 0 }}><em>None yet.</em></p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{sent.map((u) => <li key={u.id} className="row between" style={{ padding: '8px 0', borderTop: '1px solid #efece6' }}>
          <span>{u.projects?.number} · <strong>{u.title ?? KIND_LABEL[u.kind]}</strong> <span className="muted">{(u.body ?? '').slice(0, 80)}</span></span>
          <span className="muted" style={{ fontSize: 13 }}>{u.notify === 'now' ? 'Sent immediately' : 'In daily summary'} · {fmtDate(u.created_at)}</span></li>)}</ul>
      </section>
    </div>
  )
}

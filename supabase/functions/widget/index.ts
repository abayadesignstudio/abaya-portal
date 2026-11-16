// Data for the iPhone home-screen widget, and the widget's timer buttons.
// The widget can't share the portal's sign-in, so each phone gets its own long-lived widget token:
//   POST { action: 'register' }  with the user's JWT                → { token }   (stored hashed; one per device label)
//   POST { action: 'feed' }      header x-widget-token               → { timer, recent, items }
//   POST { action: 'start'|'pause'|'resume'|'stop' } header x-widget-token → { ok } then the widget reloads
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { accessToken, listEvents } from './google.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-widget-token', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const TZ = 'America/Chicago'
const SECTOR: Record<string, string> = { commercial: '#2b5c8a', residential: '#a32d2d', medical: '#2e7d4f', consultation: '#6b7280', civic: '#5b4b8a', internal: '#02253d' }
const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, '0')).join('')

type Timer = { project_id: string; phase_id: string | null; role_label: string | null; bill_rate: number | null; activity: string | null; note: string | null
  started_at: string; banked_minutes: number; paused_at: string | null; banked_seconds: number | null }
const elapsedSec = (t: Timer, now = Date.now()) =>
  ((t.paused_at ? new Date(t.paused_at).getTime() : now) - new Date(t.started_at).getTime()) / 1000 + t.banked_minutes * 60 + (t.banked_seconds ?? 0)

async function feed(db: SupabaseClient, me: string) {
  const today = dayOf(new Date()), until = dayOf(new Date(Date.now() + 13 * 86400_000))
  const [{ data: t }, { data: recent }, { data: tasks }, { data: evs }, { data: members }] = await Promise.all([
    db.from('timers').select('*, projects(number, name, sector)').eq('profile_id', me).maybeSingle(),
    db.from('time_entries').select('project_id, activity, role_label, projects(number, name)').eq('profile_id', me).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('tasks').select('id, title, due_on, due_time, projects(number, sector)').eq('assignee', me).is('done_at', null).lte('due_on', until).order('due_on').order('due_time', { nullsFirst: true }).limit(40),
    db.from('calendar_events').select('id, title, starts_on, ends_on, start_time, projects(number, sector)').eq('profile_id', me).lte('starts_on', until).gte('ends_on', today).limit(40),
    db.from('project_members').select('project_id').eq('profile_id', me),
  ])
  const mine = (members ?? []).map((m: { project_id: string }) => m.project_id)
  const [{ data: ms }, { data: dl }] = mine.length ? await Promise.all([
    db.from('milestones').select('id, title, date, done, projects(number, sector)').in('project_id', mine).gte('date', today).lte('date', until).eq('done', false),
    db.from('deliverables').select('id, title, due_date, status, projects(number, sector)').in('project_id', mine).gte('due_date', today).lte('due_date', until).neq('status', 'done'),
  ]) : [{ data: [] }, { data: [] }]

  type Item = { day: string; time: string | null; kind: string; title: string; code: string | null; color: string; overdue?: boolean }
  // deno-lint-ignore no-explicit-any
  const p = (x: any) => ({ code: x?.number ?? null, color: SECTOR[x?.sector ?? 'internal'] ?? '#6b7280' })
  const items: Item[] = []
  // deno-lint-ignore no-explicit-any
  for (const x of (tasks ?? []) as any[]) items.push({ day: x.due_on < today ? today : x.due_on, time: x.due_time?.slice(0, 5) ?? null, kind: 'task', title: x.title, ...p(x.projects), overdue: x.due_on < today })
  // deno-lint-ignore no-explicit-any
  for (const x of (evs ?? []) as any[]) items.push({ day: x.starts_on < today ? today : x.starts_on, time: x.start_time?.slice(0, 5) ?? null, kind: 'event', title: x.title, ...p(x.projects) })
  // deno-lint-ignore no-explicit-any
  for (const x of (ms ?? []) as any[]) items.push({ day: x.date, time: null, kind: 'milestone', title: x.title, ...p(x.projects) })
  // deno-lint-ignore no-explicit-any
  for (const x of (dl ?? []) as any[]) items.push({ day: x.due_date, time: null, kind: 'deliverable', title: x.title, ...p(x.projects) })
  // Google Calendar meetings (if this person connected Google)
  try {
    const { data: conn } = await db.from('google_connections').select('refresh_token').eq('profile_id', me).maybeSingle()
    if (conn?.refresh_token) {
      const g = await listEvents(await accessToken(conn.refresh_token), today, until)
      for (const e of g ?? []) {
        if (e.status === 'cancelled' || e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue
        const start = e.start?.dateTime ? new Date(e.start.dateTime) : null
        const day = start ? dayOf(start) : e.start?.date ?? null
        if (!day) continue
        const time = start ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(start) : null
        if (start && start.getTime() < Date.now() - 30 * 60_000 && day === today) continue // already over
        items.push({ day: day < today ? today : day, time, kind: 'meeting', title: e.visibility === 'private' ? 'Busy' : (e.summary ?? 'Busy'), code: null, color: '#1a73e8' })
      }
    }
  } catch { /* Google is optional */ }
  items.sort((a, b) => (a.day + (a.time ?? '00:00') + a.kind).localeCompare(b.day + (b.time ?? '00:00') + b.kind))

  // deno-lint-ignore no-explicit-any
  const tp = (t as any)?.projects
  // deno-lint-ignore no-explicit-any
  const r = recent as any
  return {
    today,
    timer: t ? { code: tp?.number === 'OH' ? 'OH' : tp?.number ?? '', title: tp?.number === 'OH' ? 'Overhead' : tp?.name ?? 'Timer', detail: [t.activity, t.role_label].filter(Boolean).join(' · '),
      color: SECTOR[tp?.sector ?? 'internal'], elapsed: Math.max(0, Math.round(elapsedSec(t as Timer))), paused: !!t.paused_at } : null,
    recent: r ? { code: r.projects?.number === 'OH' ? 'OH' : r.projects?.number ?? '', title: r.projects?.number === 'OH' ? 'Overhead' : r.projects?.name ?? '', detail: r.activity ?? '' } : null,
    items: items.slice(0, 30),
  }
}

async function act(db: SupabaseClient, me: string, action: string) {
  const { data: t } = await db.from('timers').select('*').eq('profile_id', me).maybeSingle() as { data: Timer | null }
  const now = new Date().toISOString()
  if (action === 'pause') { if (t && !t.paused_at) await db.from('timers').update({ paused_at: now }).eq('profile_id', me); return }
  if (action === 'resume') {
    if (!t?.paused_at) return
    const stretch = Math.round((new Date(t.paused_at).getTime() - new Date(t.started_at).getTime()) / 1000)
    await db.from('timers').update({ banked_seconds: (t.banked_seconds ?? 0) + Math.max(0, stretch), started_at: now, paused_at: null }).eq('profile_id', me); return
  }
  if (action === 'stop') {
    if (!t) return
    const minutes = Math.max(1, Math.round(elapsedSec(t) / 60))
    const { error } = await db.from('time_entries').insert({ profile_id: me, project_id: t.project_id, phase_id: t.phase_id, role_label: t.role_label, activity: t.activity, note: t.note,
      bill_rate: t.bill_rate, work_date: dayOf(new Date()), minutes, started_at: t.started_at, ended_at: now })
    if (error) throw new Error(error.message)
    await db.from('timers').delete().eq('profile_id', me)
    await db.from('timesheet_rows').insert({ profile_id: me, project_id: t.project_id, phase_id: t.phase_id, role_label: t.role_label, activity: t.activity, bill_rate: t.bill_rate })
    return
  }
  if (action === 'start') {
    if (t) return
    const { data: r } = await db.from('time_entries').select('project_id, phase_id, role_label, activity, bill_rate').eq('profile_id', me).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!r) throw new Error('No recent task to start — start one in the app first.')
    await db.from('timers').upsert({ profile_id: me, ...r, note: null, started_at: now, banked_minutes: 0, banked_seconds: 0, paused_at: null })
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let body: { action?: string; label?: string } = {}
  try { body = await req.json() } catch { /* empty */ }

  if (body.action === 'register') {
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await asUser.auth.getUser()
    if (!user) return json({ error: 'Sign in first.' }, 401)
    const { data: prof } = await db.from('profiles').select('role').eq('id', user.id).single()
    if (!prof || !['admin', 'staff'].includes(prof.role)) return json({ error: 'Staff only.' }, 403)
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, '0')).join('')
    const label = String(body.label ?? 'iPhone').slice(0, 60)
    await db.from('widget_tokens').delete().eq('profile_id', user.id).eq('label', label)
    const { error } = await db.from('widget_tokens').insert({ profile_id: user.id, token_hash: await sha(token), label })
    if (error) return json({ error: error.message }, 500)
    return json({ token })
  }

  const token = req.headers.get('x-widget-token') ?? ''
  if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: 'Not linked' }, 401)
  const { data: w } = await db.from('widget_tokens').select('id, profile_id').eq('token_hash', await sha(token)).maybeSingle()
  if (!w) return json({ error: 'Not linked' }, 401)
  const { data: prof } = await db.from('profiles').select('role').eq('id', w.profile_id).single()
  if (!prof || !['admin', 'staff'].includes(prof.role)) return json({ error: 'Not linked' }, 401)
  db.from('widget_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', w.id).then(() => {})

  try {
    if (body.action && body.action !== 'feed') await act(db, w.profile_id, body.action)
    return json(await feed(db, w.profile_id))
  } catch (e) { return json({ error: (e as Error).message }, 400) }
})

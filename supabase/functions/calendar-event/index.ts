// Add, change or delete an event in the caller's own Google Calendar from the portal (like Google Calendar's quick add).
// POST with a staff member's JWT:
//   { op: 'create', title, all_day, date, end_date?, start_time?, end_time?, time_zone, location?, description?, guests?: [profile ids], project_id? }
//   { op: 'update', id, ...same fields }      { op: 'delete', id }
// Staff picked as guests get Google's normal invitation (sendUpdates=all). Only the event's organizer can change or delete it.
import { admin, json, CORS, staffCaller } from './mail.ts'
import { googleConfigured, GOOGLE_NOT_CONFIGURED, accessToken, writeEvent } from './google.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/
const TAG = /\n*^Portal project: .*$/m // line the portal adds so the project shows in Google too
const addDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const uid = await staffCaller(req)
  if (!uid) return json({ error: 'Forbidden' }, 403)
  if (!googleConfigured()) return json(GOOGLE_NOT_CONFIGURED, 503)
  // deno-lint-ignore no-explicit-any
  let b: any = {}
  try { b = await req.json() } catch { /* empty */ }
  const op = b.op === 'update' ? 'update' : b.op === 'delete' ? 'delete' : 'create'
  const id = typeof b.id === 'string' && b.id.length < 300 ? b.id : null
  if (op !== 'create' && !id) return json({ error: 'Missing event id' }, 400)
  const db = admin()
  const { data: c } = await db.from('google_connections').select('refresh_token').eq('profile_id', uid).maybeSingle()
  if (!c) return json({ error: 'Connect Google on My account first.', code: 'not_connected' }, 409)
  let token: string
  try { token = await accessToken(c.refresh_token) } catch { return json({ error: 'Google access expired. Reconnect Google on My account.', code: 'reconnect' }, 409) }
  const scopeErr = () => json({ error: 'Reconnect Google on My account to let the portal add events to your calendar.', code: 'reconnect' }, 409)

  if (op !== 'create') { // only the organizer may change or delete
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id!)}`, { headers: { Authorization: `Bearer ${token}` } })
    const ev = await r.json().catch(() => null)
    if (!r.ok || !(ev?.organizer?.self ?? ev?.creator?.self)) return json({ error: 'Only the person who created this event can change it.' }, 403)
  }
  if (op === 'delete') {
    const r = await writeEvent(token, 'DELETE', id)
    if (r.insufficientScope) return scopeErr()
    if (r.status >= 300 && r.status !== 404 && r.status !== 410) return json({ error: `Google error ${r.status}` }, 502)
    await db.from('calendar_event_projects').delete().eq('google_event_id', id!)
    return json({ ok: true })
  }

  const title = String(b.title ?? '').trim().slice(0, 300)
  if (!title) return json({ error: 'Add a title.' }, 400)
  if (!DAY.test(b.date)) return json({ error: 'Choose a date.' }, 400)
  const endDate = DAY.test(b.end_date ?? '') && b.end_date >= b.date ? b.end_date : b.date
  const tz = typeof b.time_zone === 'string' && /^[A-Za-z_]+\/[A-Za-z_\/-]+$/.test(b.time_zone) ? b.time_zone : 'America/Chicago'
  let start, end
  if (b.all_day) { start = { date: b.date }; end = { date: addDay(endDate, 1) } }
  else {
    if (!TIME.test(b.start_time ?? '') || !TIME.test(b.end_time ?? '')) return json({ error: 'Choose start and end times.' }, 400)
    const endOn = endDate === b.date && b.end_time <= b.start_time ? addDay(b.date, 1) : endDate // e.g. 11pm–1am
    start = { dateTime: `${b.date}T${b.start_time}:00`, timeZone: tz }; end = { dateTime: `${endOn}T${b.end_time}:00`, timeZone: tz }
  }
  // guests: staff only, by profile id; the organizer is added by Google
  const ids: string[] = Array.isArray(b.guests) ? b.guests.filter((x: unknown) => typeof x === 'string' && x !== uid).slice(0, 20) : []
  const { data: gs } = ids.length ? await db.from('profiles').select('email').in('id', ids).in('role', ['admin', 'staff']) : { data: [] }
  let proj: { id: string; number: string; name: string } | null = null
  if (typeof b.project_id === 'string' && b.project_id) {
    const { data } = await db.from('projects').select('id, number, name').eq('id', b.project_id).maybeSingle()
    proj = data
  }
  const desc = String(b.description ?? '').replace(TAG, '').trim().slice(0, 4000)
  const body = {
    summary: title, location: String(b.location ?? '').trim().slice(0, 300) || undefined,
    description: [desc, proj ? `Portal project: ${proj.number} · ${proj.name}` : ''].filter(Boolean).join('\n\n') || undefined,
    start, end, attendees: (gs ?? []).map((g) => ({ email: g.email })),
  }
  const r = await writeEvent(token, op === 'create' ? 'POST' : 'PATCH', id, op === 'update' ? { ...body, description: body.description ?? '', location: body.location ?? '' } : body)
  if (r.insufficientScope) return scopeErr()
  if (r.status >= 300 || !r.data) return json({ error: `Google error ${r.status}` }, 502)
  const eid = r.data.id
  if (proj) await db.from('calendar_event_projects').upsert({ google_event_id: eid, project_id: proj.id, set_by: uid, updated_at: new Date().toISOString() })
  else if (op === 'update') await db.from('calendar_event_projects').delete().eq('google_event_id', eid)
  return json({ ok: true, id: eid })
})

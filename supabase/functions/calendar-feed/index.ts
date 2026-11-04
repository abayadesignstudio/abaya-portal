// Everyone's Google Calendar meetings for the portal's month calendar (titles visible to all staff, by firm choice).
// POST { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } with a staff member's JWT → { events, connected: [profile ids], me_connected }.
// Reads each connected person's primary calendar with their own Google permission. Nothing is stored.
//  - Events marked Private in Google come back as "Busy" with no details; declined events are left out.
//  - Descriptions never leave this function except for the caller's own events (to edit them); they are only used here
//    to spot a project number (auto_project_id).
import { admin, json, CORS, staffCaller } from './mail.ts'
import { googleConfigured, accessToken, listEvents, type GItem } from './google.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/
type Proj = { id: string; number: string }
const esc = (s: string) => s.replace(/[^A-Za-z0-9]/g, '\\$&')
function matcher(projects: Proj[]) {
  const c = projects.filter((p) => p.number && p.number !== 'OH' && p.number.length >= 3).sort((a, b) => b.number.length - a.number.length)
    .map((p) => ({ id: p.id, re: new RegExp(`(^|[^A-Za-z0-9])${esc(p.number)}([^A-Za-z0-9]|$)`, 'i') }))
  return (text: string) => c.find((p) => p.re.test(text))?.id ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const uid = await staffCaller(req)
  if (!uid) return json({ error: 'Forbidden' }, 403)
  let from = '', to = ''
  try { const b = await req.json(); from = String(b.from ?? ''); to = String(b.to ?? '') } catch { /* empty */ }
  if (!DAY.test(from) || !DAY.test(to) || from > to) return json({ error: 'Bad dates' }, 400)
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 62) return json({ error: 'Range too long' }, 400)
  if (!googleConfigured()) return json({ events: [], connected: [], me_connected: false, skipped: 'google not configured' })
  const db = admin()
  const [{ data: conns }, { data: staff }, { data: projects }] = await Promise.all([
    db.from('google_connections').select('profile_id, refresh_token'),
    db.from('profiles').select('id, email').in('role', ['admin', 'staff']),
    db.from('projects').select('id, number'),
  ])
  const byEmail = new Map((staff ?? []).map((p) => [String(p.email).toLowerCase(), p.id as string]))
  const match = matcher((projects ?? []) as Proj[])
  const connected: string[] = []
  const lists = await Promise.all((conns ?? []).map(async (c) => {
    try {
      const items = await listEvents(await accessToken(c.refresh_token), from, to)
      if (!items) return []
      connected.push(c.profile_id)
      return items.map((e) => shape(e, c.profile_id)).filter(Boolean)
    } catch (e) {
      if ((e as { revoked?: boolean }).revoked) await db.from('google_connections').delete().eq('profile_id', c.profile_id)
      return []
    }
  }))
  function shape(e: GItem, pid: string) {
    if (e.status === 'cancelled' || e.eventType === 'workingLocation') return null
    const mine = (e.attendees ?? []).find((a) => a.self)
    if (mine?.responseStatus === 'declined') return null
    const priv = e.visibility === 'private' || e.visibility === 'confidential'
    const allDay = !!e.start?.date
    const own = pid === uid
    const canEdit = own && !priv ? !!(e.organizer?.self ?? e.creator?.self) : false
    const guests = (e.attendees ?? []).map((a) => byEmail.get(String(a.email ?? '').toLowerCase())).filter((x): x is string => !!x)
    return {
      id: String(e.id), uid: e.iCalUID ?? String(e.id), profile_id: pid, busy_only: priv, all_day: allDay,
      title: priv ? 'Busy' : String(e.summary ?? '(No title)'),
      start: allDay ? e.start!.date! : e.start?.dateTime ?? '', end: allDay ? e.end!.date! : e.end?.dateTime ?? '',
      location: priv ? null : (e.location ?? null),
      guests: priv ? [] : guests,
      organizer: priv ? null : byEmail.get(String(e.organizer?.email ?? '').toLowerCase()) ?? null,
      auto_project_id: priv ? null : match(`${e.summary ?? ''} ${e.location ?? ''} ${e.description ?? ''}`),
      can_edit: canEdit,
      description: canEdit ? (e.description ?? '').replace(/\n*^Portal project: .*$/m, '').trim() : undefined,
      link: own ? e.htmlLink ?? null : null,
    }
  }
  return json({ events: lists.flat(), connected, me_connected: connected.includes(uid) })
})

// Everyone's Google Calendar meetings for the portal's month calendar (titles visible to all staff, by firm choice).
// POST { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } with a staff member's JWT → { events, connected: [profile ids], me_connected }.
// Reads each connected person's primary calendar with their own Google permission (calendar.readonly).
// Events marked Private in Google come back as "Busy" with no details. Nothing is stored.
import { admin, json, CORS, staffCaller } from './mail.ts'
import { googleConfigured, accessToken, listEvents, type FeedEvent } from './google.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/

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
  const { data: conns } = await db.from('google_connections').select('profile_id, refresh_token')
  const connected: string[] = []
  const lists = await Promise.all((conns ?? []).map(async (c) => {
    try {
      const token = await accessToken(c.refresh_token)
      const evs = await listEvents(token, c.profile_id, from, to)
      if (evs) connected.push(c.profile_id)
      return evs ?? []
    } catch (e) {
      if ((e as { revoked?: boolean }).revoked) await db.from('google_connections').delete().eq('profile_id', c.profile_id)
      return [] as FeedEvent[]
    }
  }))
  return json({ events: lists.flat(), connected, me_connected: connected.includes(uid) })
})

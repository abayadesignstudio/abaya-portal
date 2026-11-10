// Everyone's Google Calendar meetings for the portal's month calendar (titles visible to all staff, by firm choice).
// POST { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } with a staff member's JWT → { events, connected: [profile ids], me_connected }.
// Reads each connected person's primary calendar with their own Google permission. Nothing is stored.
//  - Events marked Private in Google come back as "Busy" with no details; declined events are left out.
//  - Descriptions never leave this function except for the caller's own events (to edit them); they are only used here
//    to spot a project number (auto_project_id).
import { admin, json, CORS, staffCaller } from './mail.ts'
import { googleConfigured, accessToken, listEvents, type GItem } from './google.ts'
import ICAL from 'npm:ical.js@2.1.0'

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
  const db = admin()
  const { events: personal, errors: personal_errors } = await personalEvents(db, uid, from, to)
  if (!googleConfigured()) return json({ events: personal, personal_errors, connected: [], me_connected: false, skipped: 'google not configured' })
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
  return json({ events: [...lists.flat(), ...personal], personal_errors, connected, me_connected: connected.includes(uid) })
})

// ---- personal calendars (iCal links) ----
const addDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
// deno-lint-ignore no-explicit-any
async function personalEvents(db: any, uid: string, from: string, to: string) {
  const { data: cals } = await db.from('personal_calendars').select('id, profile_id, label, ics_url, visibility')
  // coworkers only see calendars shared as busy or details; the owner always sees everything
  const mine = (cals ?? []).filter((c: { profile_id: string; visibility: string }) => c.profile_id === uid || c.visibility !== 'private')
  // problems reading the caller's own calendars are reported back so My account can show them
  const errors: { id: string; label: string; error: string }[] = []
  const lists = await Promise.all(mine.map(async (c: { id: string; profile_id: string; label: string; ics_url: string; visibility: string }) => {
    const fail = (error: string) => { if (c.profile_id === uid) errors.push({ id: c.id, label: c.label, error }); return [] }
    try {
      const own = c.profile_id === uid
      const busy = !own && c.visibility === 'busy'
      // a Google calendar shared with the owner's work account: read it with their Google connection
      if (!/^(https?|webcal):/i.test(c.ics_url)) {
        const { data: conn } = await db.from('google_connections').select('refresh_token').eq('profile_id', c.profile_id).maybeSingle()
        if (!conn) return fail('Connect Google (above) first — the shared calendar is read through it.')
        const token = await accessToken(conn.refresh_token)
        const items: GItem[] = []
        let page = ''
        for (let i = 0; i < 5; i++) {
          const q = new URLSearchParams({ timeMin: `${from}T00:00:00-12:00`, timeMax: `${to}T23:59:59+14:00`, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' })
          if (page) q.set('pageToken', page)
          const g = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.ics_url)}/events?${q}`, { headers: { Authorization: `Bearer ${token}` } })
          if (g.status === 404 || g.status === 403) return fail('Your work Google account can’t see that calendar yet. Share it with your work email (see the steps), then try again.')
          if (!g.ok) return fail(`Google didn’t answer (${g.status}).`)
          const j = await g.json(); items.push(...(j.items ?? [])); page = j.nextPageToken ?? ''
          if (!page) break
        }
        return items.filter((e) => e.status !== 'cancelled').map((e) => {
          const allDay = !!e.start?.date
          const priv = e.visibility === 'private' || e.visibility === 'confidential'
          const hide = busy || (priv && !own)
          const start = allDay ? e.start!.date! : e.start?.dateTime ?? ''
          return { id: `pc:${c.id}:${e.id}`, uid: `pc:${e.iCalUID ?? e.id}:${start}`, profile_id: c.profile_id, busy_only: hide, all_day: allDay,
            title: hide ? 'Busy' : String(e.summary ?? '(No title)'), start, end: allDay ? e.end!.date! : e.end?.dateTime ?? '',
            location: hide ? null : (e.location ?? null), guests: [], organizer: null, auto_project_id: null, can_edit: false, link: null, personal: own ? c.label : null }
        })
      }
      const url = c.ics_url.replace(/^webcal:/i, 'https:')
      if (!safeUrl(url)) return fail('That link isn’t allowed.')
      const get = () => fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'text/calendar, */*', 'User-Agent': 'Mozilla/5.0 (compatible; AbayaPortal/1.0; +https://abayadesignstudio.com)' } })
      let r = await get()
      if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 1200)); r = await get() } // busy: try once more
      if (!r.ok) return fail(r.status === 429 && /google\.com/.test(url) ? 'Google doesn’t allow its iCal links to be read by servers. Use “Share with my work Google account” instead.' : `The calendar didn’t answer (${r.status}). Check the link.`)
      const text = await r.text()
      if (text.length > 8_000_000) return fail('The calendar is too large.')
      if (!text.includes('BEGIN:VCALENDAR')) return fail('That link isn’t an iCal calendar.')
      return expand(text, from, to).map((e) => ({
        id: `pc:${c.id}:${e.uid}:${e.start}`, uid: `pc:${e.uid}:${e.start}`, profile_id: c.profile_id,
        busy_only: busy || e.priv, all_day: e.allDay,
        title: busy || (e.priv && !own) ? 'Busy' : e.title || '(No title)',
        start: e.start, end: e.end, location: busy || (e.priv && !own) ? null : e.location, guests: [], organizer: null,
        auto_project_id: null, can_edit: false, link: null, personal: own ? c.label : null,
      }))
    } catch (e) { return fail(`Couldn’t read the calendar: ${String((e as Error)?.message ?? e).slice(0, 160)}`) }
  }))
  return { events: lists.flat(), errors }
}

// public internet only (the link is user-supplied)
function safeUrl(u: string) {
  try {
    const x = new URL(u)
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return false
    const h = x.hostname.toLowerCase()
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.supabase.co') || h.endsWith('.supabase.internal')) return false
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.includes(':') || h === '[::1]') return false
    return true
  } catch { return false }
}

type Occ = { uid: string; title: string; location: string | null; start: string; end: string; allDay: boolean; priv: boolean }
function expand(text: string, from: string, to: string): Occ[] {
  const comp = new ICAL.Component(ICAL.parse(text))
  for (const tz of comp.getAllSubcomponents('vtimezone')) { try { ICAL.TimezoneService.register(tz) } catch { /* ignore */ } }
  const lo = ICAL.Time.fromDateString(from), hi = ICAL.Time.fromDateString(addDay(to, 1))
  const vevents = comp.getAllSubcomponents('vevent')
  const exceptions = vevents.filter((v: { hasProperty: (k: string) => boolean }) => v.hasProperty('recurrence-id'))
  const out: Occ[] = []
  // deno-lint-ignore no-explicit-any
  const fmt = (t: any) => t.isDate ? t.toString().slice(0, 10) : t.toJSDate().toISOString()
  // deno-lint-ignore no-explicit-any
  const push = (item: any, s: any, e: any) => {
    if (String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return
    const cls = String(item.component.getFirstPropertyValue('class') ?? '').toUpperCase()
    out.push({ uid: String(item.uid), title: String(item.summary ?? ''), location: item.location ? String(item.location) : null,
      start: fmt(s), end: fmt(e ?? s), allDay: !!s.isDate, priv: cls === 'PRIVATE' || cls === 'CONFIDENTIAL' })
  }
  for (const v of vevents) {
    if (v.hasProperty('recurrence-id')) continue
    const ev = new ICAL.Event(v)
    for (const x of exceptions) if (x.getFirstPropertyValue('uid') === ev.uid) { try { ev.relateException(x) } catch { /* ignore */ } }
    if (!ev.startDate) continue
    if (ev.isRecurring()) {
      const it = ev.iterator()
      for (let n = 0, next = it.next(); next && n < 20000; n++, next = it.next()) {
        if (next.compare(hi) >= 0) break
        const o = ev.getOccurrenceDetails(next)
        if (o.endDate && o.endDate.compare(lo) <= 0) continue
        push(o.item, o.startDate, o.endDate)
      }
    } else if (ev.startDate.compare(hi) < 0 && (ev.endDate ?? ev.startDate).compare(lo) > 0) push(ev, ev.startDate, ev.endDate)
  }
  return out
}

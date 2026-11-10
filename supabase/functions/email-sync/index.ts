// Project emails and meetings → project updates. Every 15 minutes (cron, x-cron-secret) or on demand (staff POST, own mailbox).
// For each person who allowed Gmail (read-only), looks at mail from the last 2 days. An email to or from a project contact
// (Contacts tab: GC, engineers…) or a client contact becomes a short update on that project, visible in the client portal.
// Meetings on connected Google Calendars with those contacts are logged the same way (kind 'event').
//  - Project: a project contact's own project; else a client contact's project — the project number in the subject
//    wins, otherwise the client's only active project; otherwise skipped.
//  - The same email in several mailboxes is logged once (by Message-ID). Nothing is emailed to the client (notify none).
//  - Only the subject, who/when and Gmail's short preview text are stored — never the full body or attachments.
import { admin, json, CORS, staffCaller, cronCaller } from './mail.ts'
import { googleConfigured, accessToken } from './google.ts'

const GM = 'https://gmail.googleapis.com/gmail/v1/users/me'
type Hdr = { name: string; value: string }
const addrs = (v: string | undefined) => [...String(v ?? '').matchAll(/([^<>,"\s]+@[^<>,"\s]+\.[^<>,"\s]+)/g)].map((m) => m[1].toLowerCase())
const nameOf = (v: string | undefined) => { const m = String(v ?? '').match(/^\s*"?([^"<]+?)"?\s*</); return m ? m[1].trim() : null }
const unent = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
const esc = (s: string) => s.replace(/[^A-Za-z0-9]/g, '\\$&')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const cron = await cronCaller(req)
  const uid = cron ? null : await staffCaller(req)
  if (!cron && !uid) return json({ error: 'Forbidden' }, 403)
  if (!googleConfigured()) return json({ skipped: 'google not configured' })
  const db = admin()

  let cq = db.from('google_connections').select('profile_id, refresh_token, gmail_enabled')
  if (uid) cq = cq.eq('profile_id', uid)
  const [{ data: conns }, { data: staff }, { data: contacts }, { data: projects }, { data: pcs }] = await Promise.all([
    cq,
    db.from('profiles').select('id, full_name, email').in('role', ['admin', 'staff']),
    db.from('client_contacts').select('client_id, name, email'),
    db.from('projects').select('id, number, client_id, status'),
    db.from('project_contacts').select('project_id, name, email, trade'),
  ])
  // project contacts (trades) by email → their projects
  const pcBy = new Map<string, { name: string | null; projects: string[] }>()
  for (const c of pcs ?? []) { if (!c.email) continue; const k = String(c.email).toLowerCase(); const v = pcBy.get(k) ?? { name: c.name, projects: [] }; v.projects.push(c.project_id); pcBy.set(k, v) }
  const staffBy = new Map((staff ?? []).map((p) => [String(p.email).toLowerCase(), p]))
  const contactBy = new Map((contacts ?? []).filter((c) => c.email).map((c) => [String(c.email).toLowerCase(), c]))
  const live = (projects ?? []).filter((p) => p.client_id && ['active', 'paused', 'proposal'].includes(p.status))
  const first = (s: string | null | undefined) => (s ?? '').split(/\s+/)[0]
  const who = (email: string, header?: string) => {
    const s = staffBy.get(email); if (s) return s.full_name || email
    const c = contactBy.get(email); if (c?.name) return c.name
    const pc = pcBy.get(email); if (pc?.name) return pc.name
    return nameOf(header) || email
  }
  const report: Record<string, unknown> = {}
  const projById = new Map((projects ?? []).map((p) => [p.id, p]))
  /** Which project an email/meeting belongs to, from everyone on it and its subject. */
  const pickProject = (everyone: string[], subject: string) => {
    const numberIn = (list: { number: string | null }[]) => list.find((p) => p.number && new RegExp(`(^|[^A-Za-z0-9])${esc(p.number)}([^A-Za-z0-9]|$)`, 'i').test(subject))
    const viaTrades = [...new Set(everyone.flatMap((e) => pcBy.get(e)?.projects ?? []))].map((id) => projById.get(id)).filter((p): p is NonNullable<typeof p> => !!p)
    if (viaTrades.length) return numberIn(viaTrades) ?? (viaTrades.length === 1 ? viaTrades[0] : viaTrades.filter((p) => ['active', 'paused'].includes(p.status)).length === 1 ? viaTrades.filter((p) => ['active', 'paused'].includes(p.status))[0] : null)
    const clientIds = [...new Set(everyone.map((e) => contactBy.get(e)?.client_id).filter(Boolean))] as string[]
    if (!clientIds.length) return null
    // only ever a project of a client on the email — never another client's project, even if its number appears
    const cand = live.filter((p) => clientIds.includes(p.client_id))
    return numberIn(cand) ?? (cand.length === 1 ? cand[0] : null)
  }
  const isContact = (e: string) => contactBy.has(e) || pcBy.has(e)

  for (const c of conns ?? []) {
    let logged = 0, looked = 0, meetings = 0
    try {
      const token = await accessToken(c.refresh_token)
      const H = { Authorization: `Bearer ${token}` }
      meetings = await logMeetings(c.profile_id, H)
      if (!c.gmail_enabled) { report[c.profile_id] = { meetings }; continue }
      const ids: { id: string; threadId: string }[] = []
      let page = ''
      for (let i = 0; i < 3; i++) {
        const q = new URLSearchParams({ q: 'newer_than:2d -in:chats -in:spam -in:trash', maxResults: '100' })
        if (page) q.set('pageToken', page)
        const r = await fetch(`${GM}/messages?${q}`, { headers: H })
        if (r.status === 403) { report[c.profile_id] = 'gmail access not granted'; ids.length = 0; break }
        if (!r.ok) break
        const j = await r.json(); ids.push(...(j.messages ?? [])); page = j.nextPageToken ?? ''
        if (!page) break
      }
      if (!ids.length) { await db.from('google_connections').update({ gmail_synced_at: new Date().toISOString() }).eq('profile_id', c.profile_id); report[c.profile_id] ??= { looked: 0, logged: 0 }; continue }
      const { data: seen } = await db.from('email_seen').select('gmail_id').eq('profile_id', c.profile_id).in('gmail_id', ids.map((x) => x.id))
      const seenSet = new Set((seen ?? []).map((s) => s.gmail_id))
      for (const m of ids.filter((x) => !seenSet.has(x.id)).reverse()) { // oldest first, so replies follow what they answer
        looked++
        const mq = new URLSearchParams({ format: 'metadata' })
        for (const h of ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID', 'In-Reply-To']) mq.append('metadataHeaders', h)
        const r = await fetch(`${GM}/messages/${m.id}?${mq}`, { headers: H })
        await db.from('email_seen').upsert({ profile_id: c.profile_id, gmail_id: m.id })
        if (!r.ok) continue
        const msg = await r.json()
        if ((msg.labelIds ?? []).some((l: string) => l === 'DRAFT' || l === 'SPAM' || l === 'TRASH')) continue
        const hs: Hdr[] = msg.payload?.headers ?? []
        const h = (n: string) => hs.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value
        const from = addrs(h('From'))[0]
        const to = [...addrs(h('To')), ...addrs(h('Cc'))]
        if (!from) continue
        const everyone = [from, ...to]
        if (!everyone.some(isContact)) continue
        // a staff member must be on it too (this is work correspondence)
        if (!everyone.some((e) => staffBy.has(e))) continue
        const subject = String(h('Subject') ?? '(no subject)').trim()
        const project = pickProject(everyone, subject)
        const messageId = String(h('Message-ID') ?? `gmail:${m.id}`).trim()
        const sentAt = new Date(Number(msg.internalDate) || Date.now()).toISOString()
        const { data: logRow } = await db.from('email_log').upsert({
          message_id: messageId, thread_id: m.threadId, project_id: project?.id ?? null, from_email: from, to_emails: to, subject, sent_at: sentAt, found_by: c.profile_id,
        }, { onConflict: 'message_id', ignoreDuplicates: true }).select('message_id')
        if (!logRow?.length || !project) continue // already logged from another mailbox, or no single project
        // short entry: who → whom, subject, Gmail's preview line
        const sender = who(from, h('From'))
        const recips = [...new Set(to.filter((e) => e !== from && (isContact(e) || staffBy.has(e))))].map((e) => first(who(e)) || e)
        const reply = !!h('In-Reply-To') || /^\s*(re|aw)\s*:/i.test(subject)
        const verb = reply ? 'replied to' : 'emailed'
        const title = `${first(sender) || sender} ${verb} ${recips.length ? recips.join(', ') : 'the team'}`
        const snippet = unent(String(msg.snippet ?? '')).replace(/\s+/g, ' ').trim()
        const body = `${subject}${snippet ? `\n“${snippet.length > 220 ? snippet.slice(0, 217) + '…' : snippet}”` : ''}`
        const author = staffBy.get(from)?.id ?? null
        const { data: up } = await db.from('updates').insert({ project_id: project.id, author, kind: 'email', title, body, visible_to_client: true, notify: 'none', created_at: sentAt }).select('id').single()
        if (up) { await db.from('email_log').update({ update_id: up.id }).eq('message_id', messageId); logged++ }
      }
      await db.from('google_connections').update({ gmail_synced_at: new Date().toISOString() }).eq('profile_id', c.profile_id)
      report[c.profile_id] = { looked, logged, meetings }
    } catch (e) {
      report[c.profile_id] = `error: ${String((e as Error)?.message ?? e).slice(0, 120)}`
    }
  }
  return json({ ok: true, report })

  /** Meetings on this person's Google Calendar (changed in the last 2 days) that include a project or client contact. */
  async function logMeetings(pid: string, H: Record<string, string>) {
    let n = 0
    const now = Date.now()
    const q = new URLSearchParams({ updatedMin: new Date(now - 2 * 86400_000).toISOString(), timeMin: new Date(now - 30 * 86400_000).toISOString(),
      timeMax: new Date(now + 180 * 86400_000).toISOString(), singleEvents: 'true', maxResults: '250', showDeleted: 'false' })
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, { headers: H })
    if (!r.ok) return 0
    const items = (await r.json()).items ?? []
    for (const e of items) {
      if (e.status === 'cancelled' || e.visibility === 'private' || e.visibility === 'confidential') continue
      const people = [...new Set([String(e.organizer?.email ?? '').toLowerCase(), ...(e.attendees ?? []).map((a: { email?: string }) => String(a.email ?? '').toLowerCase())].filter(Boolean))]
      if (!people.some(isContact)) continue
      const title = String(e.summary ?? 'Meeting').trim()
      const project = pickProject(people, title)
      if (!project) continue
      const start = e.start?.dateTime ?? e.start?.date ?? ''
      const key = `${e.iCalUID ?? e.id}|${start}`
      const { data: row } = await db.from('event_log').upsert({ event_key: key, project_id: project.id }, { onConflict: 'event_key', ignoreDuplicates: true }).select('event_key')
      if (!row?.length) continue
      const org = String(e.organizer?.email ?? '').toLowerCase()
      const host = staffBy.get(org) ?? (staff ?? []).find((s) => s.id === pid)
      const guests = people.filter((x) => x !== org && isContact(x)).map((x) => first(who(x)) || x)
      const when = e.start?.dateTime
        ? new Date(e.start.dateTime).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : new Date(`${e.start?.date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
      const hostName = staffBy.has(org) ? first(host?.full_name) || 'The team' : first(who(org)) || 'A contact'
      const { data: up } = await db.from('updates').insert({ project_id: project.id, author: staffBy.get(org)?.id ?? null, kind: 'event',
        title: `${hostName} scheduled a meeting${guests.length ? ` with ${guests.join(', ')}` : ''}`,
        body: `${title}\n${when}${e.location ? ` · ${String(e.location).slice(0, 120)}` : ''}`, visible_to_client: true, notify: 'none' }).select('id').single()
      if (up) { await db.from('event_log').update({ update_id: up.id }).eq('event_key', key); n++ }
    }
    return n
  }
})

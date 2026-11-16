// Sends a web push notification to every device a person turned notifications on for.
// Called by the database (x-cron-secret) when a notification or a "notify now" client update is created.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const PUBLIC_KEY = 'BC99vgZA4jd7vIP82JZebsuwArfnxLdaN8xjGvrxRP6EenCXT6_7lOaPonUz3ACBcqJkNVNkvAdWYMFuGKMmpD4'
const PORTAL = 'https://abayadesignstudio.github.io/abaya-portal/portal/'
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const secret = req.headers.get('x-cron-secret')
  if (!secret || (await db.rpc('check_cron_secret', { s: secret })).data !== true) return json({ error: 'Forbidden' }, 403)

  let body: { profile_ids?: string[]; title?: string; body?: string; url?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const ids = (body.profile_ids ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x))
  if (!ids.length) return json({ sent: 0 })

  const { data: key } = await db.rpc('vapid_private_key')
  if (!key) return json({ error: 'VAPID key missing' }, 500)
  webpush.setVapidDetails('https://abayadesignstudio.com', PUBLIC_KEY, key as string)

  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('profile_id', ids)
  const url = !body.url ? PORTAL : /^https?:/.test(body.url) ? body.url : PORTAL + (body.url.startsWith('#') ? body.url : '#' + body.url.replace(/^\/?/, '/'))
  const payload = JSON.stringify({ title: (body.title ?? 'Abaya').slice(0, 80), body: (body.body ?? '').slice(0, 240), url })
  let sent = 0
  const gone: number[] = []
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 })
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) gone.push(s.id) // device turned notifications off or the subscription expired
    }
  }))
  if (gone.length) await db.from('push_subscriptions').delete().in('id', gone)
  return json({ sent, removed: gone.length })
})

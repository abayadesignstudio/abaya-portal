// Emails one project update to the client's contacts right away.
// Called by staff (JWT) or by the database when an update is posted with notify = 'now'.
import { admin, json, CORS, cronCaller, staffCaller, mailConfigured, NOT_CONFIGURED, sendMail, frame, button, esc } from './mail.ts'
import { updateHtml, updateText, type Upd } from './update-mail.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const fromCron = await cronCaller(req)
  if (!fromCron && !(await staffCaller(req))) return json({ error: 'Forbidden' }, 403)
  let id = ''
  try { id = String((await req.json()).update_id ?? '') } catch { /* empty */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Missing update_id' }, 400)
  if (!mailConfigured()) return json(NOT_CONFIGURED, 503)
  const db = admin()
  const { data: u } = await db.from('updates').select('id, project_id, kind, title, body, items, photo_paths, created_at, visible_to_client, emailed_at, projects(name, number, client_id)').eq('id', id).maybeSingle()
  if (!u) return json({ error: 'Update not found' }, 404)
  if (!u.visible_to_client) return json({ error: 'This update is staff-only' }, 400)
  if (u.emailed_at) return json({ skipped: 'already emailed' })
  // deno-lint-ignore no-explicit-any
  const p = u.projects as any
  if (!p?.client_id) return json({ error: 'Project has no client' }, 400)
  const { data: contacts } = await db.from('client_contacts').select('email').eq('client_id', p.client_id).eq('receives_updates', true)
  if (!contacts?.length) return json({ error: 'No client contacts receive updates' }, 400)
  const { data: fs } = await db.from('firm_settings').select('public_base_url').eq('id', 1).single()
  const portal = `${(fs?.public_base_url ?? '').replace(/\/$/, '')}/portal/`
  const html = frame(`<h2 style="font-size:17px;margin:0 0 10px">${esc(p.number)} · ${esc(p.name)}</h2>${await updateHtml(db, u as unknown as Upd)}${button(portal, 'Open your project portal')}`)
  const sent: string[] = [], failed: string[] = []
  for (const c of contacts) {
    try { await sendMail({ to: c.email, subject: `Project update — ${p.name}`, html, text: `${p.number} · ${p.name}\n\n${updateText(u as unknown as Upd)}\n\nPortal: ${portal}\n` }); sent.push(c.email) }
    catch { failed.push(c.email) }
  }
  if (sent.length) await db.from('updates').update({ emailed_at: new Date().toISOString() }).eq('id', id)
  return json({ sent, failed })
})

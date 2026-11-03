// Runs hourly from pg_cron; at firm_settings.digest_time (Central) it emails each client
// one summary of today's visible project updates marked for the digest.
import { admin, json, CORS, cronCaller, mailConfigured, NOT_CONFIGURED, central, sendMail, frame, button, esc } from './mail.ts'
import { updateHtml, updateText, type Upd } from './update-mail.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!(await cronCaller(req))) return json({ error: 'Forbidden' }, 403)
  const db = admin()
  const { date, hour } = central()
  const { data: fs } = await db.from('firm_settings').select('digest_time, digest_enabled, last_digest_on, public_base_url').eq('id', 1).single()
  const digestHour = Number(String(fs?.digest_time ?? '18:00').slice(0, 2))
  if (!fs?.digest_enabled || hour < digestHour || fs.last_digest_on === date) return json({ skipped: true, date, hour })
  if (!mailConfigured()) return json(NOT_CONFIGURED, 503)

  const since = new Date(Date.now() - 36 * 3600000).toISOString()
  const { data: ups } = await db.from('updates')
    .select('id, project_id, kind, title, body, items, photo_paths, created_at, projects(name, number, client_id)')
    .eq('notify', 'digest').eq('visible_to_client', true).is('emailed_at', null).gte('created_at', since).order('created_at')
  // only updates written on today's Central date
  const todays = (ups ?? []).filter((u) => central(new Date(u.created_at)).date === date)
  // deno-lint-ignore no-explicit-any
  const byClient = new Map<string, { project: any; ups: Upd[] }[]>()
  for (const u of todays) {
    // deno-lint-ignore no-explicit-any
    const p = u.projects as any
    if (!p?.client_id) continue
    const list = byClient.get(p.client_id) ?? []
    let g = list.find((x) => x.project.number === p.number)
    if (!g) { g = { project: p, ups: [] }; list.push(g) }
    g.ups.push(u as unknown as Upd)
    byClient.set(p.client_id, list)
  }
  const portal = `${(fs.public_base_url ?? '').replace(/\/$/, '')}/portal/`
  const sent: string[] = [], failed: string[] = []
  for (const [clientId, groups] of byClient) {
    const { data: contacts } = await db.from('client_contacts').select('email').eq('client_id', clientId).eq('receives_updates', true)
    if (!contacts?.length) continue
    let inner = `<p style="margin:0 0 14px">Here is today’s summary from Abaya Design Studio.</p>`
    let text = 'Today’s summary from Abaya Design Studio\n\n'
    for (const g of groups) {
      inner += `<h2 style="font-size:17px;margin:18px 0 8px">${esc(g.project.number)} · ${esc(g.project.name)}</h2>`
      text += `${g.project.number} · ${g.project.name}\n`
      for (const u of g.ups) { inner += await updateHtml(db, u); text += updateText(u) + '\n\n' }
    }
    inner += button(portal, 'Open your project portal')
    const html = frame(inner)
    let ok = false
    for (const c of contacts) {
      try { await sendMail({ to: c.email, subject: `Today on your project — ${groups.map((g) => g.project.name).join(', ')}`, html, text: text + `\nPortal: ${portal}\n` }); sent.push(c.email); ok = true }
      catch { failed.push(c.email) }
    }
    if (ok) await db.from('updates').update({ emailed_at: new Date().toISOString() }).in('id', groups.flatMap((g) => g.ups.map((u) => u.id)))
  }
  await db.from('firm_settings').update({ last_digest_on: date }).eq('id', 1)
  return json({ date, sent, failed })
})

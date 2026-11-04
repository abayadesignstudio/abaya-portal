// Mirror a portal task into the assignee's Google Tasks (create/update/complete) or remove it there.
// Called by the portal after each task change: POST { id, op: 'upsert' | 'delete' } with the user's JWT.
// Quietly does nothing when Google isn't set up or the assignee hasn't connected Google.
import { admin, json, CORS, staffCaller } from './mail.ts'
import { googleConfigured, pushTask, deleteTask } from './google.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const uid = await staffCaller(req)
  if (!uid) return json({ error: 'Forbidden' }, 403)
  let id = '', op = 'upsert'
  try { const b = await req.json(); id = String(b.id ?? ''); op = b.op === 'delete' ? 'delete' : 'upsert' } catch { /* empty */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Missing id' }, 400)
  if (!googleConfigured()) return json({ skipped: 'google not configured' })
  const db = admin()
  const { data: t } = await db.from('tasks').select('assignee, created_by, google_task_id').eq('id', id).maybeSingle()
  if (!t) return json({ skipped: 'task not found' })
  const { data: me } = await db.from('profiles').select('role').eq('id', uid).maybeSingle()
  const allowed = me?.role === 'admin' || t.assignee === uid || t.created_by === uid
  if (!allowed) return json({ error: 'Forbidden' }, 403)
  const { data: fs } = await db.from('firm_settings').select('public_base_url').eq('id', 1).maybeSingle()
  const portal = `${(fs?.public_base_url ?? '').replace(/\/$/, '')}/portal/`
  const result = op === 'delete' ? await deleteTask(db, t.assignee, t.google_task_id) : await pushTask(db, id, portal)
  return json({ result })
})

// Google OAuth + Google Tasks helpers for the task sync. Copied next to each function at deploy time.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const googleConfigured = () => !!Deno.env.get('GOOGLE_CLIENT_ID') && !!Deno.env.get('GOOGLE_CLIENT_SECRET')
export const GOOGLE_NOT_CONFIGURED = { error: 'Google sync is not set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the Supabase function secrets.', code: 'google_not_configured' }
export const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/tasks']
export const redirectUri = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-oauth`

// ---- signed state (so the callback knows who connected, and can't be forged) ----
const enc = new TextEncoder()
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
async function hmac(data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! + ':google-state'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}
export async function signState(o: { uid: string; ret: string }) {
  const body = b64u(enc.encode(JSON.stringify({ ...o, exp: Date.now() + 15 * 60_000 })))
  return `${body}.${await hmac(body)}`
}
export async function readState(s: string): Promise<{ uid: string; ret: string } | null> {
  const [body, sig] = s.split('.')
  if (!body || !sig || (await hmac(body)) !== sig) return null
  const o = JSON.parse(new TextDecoder().decode(unb64u(body)))
  return o.exp > Date.now() ? o : null
}

// ---- tokens ----
export async function exchangeCode(code: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!, redirect_uri: redirectUri(), grant_type: 'authorization_code' }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Google token ${r.status}: ${j.error_description ?? j.error}`)
  return j as { access_token: string; refresh_token?: string; id_token?: string }
}
export async function accessToken(refresh: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refresh, client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!, grant_type: 'refresh_token' }),
  })
  const j = await r.json()
  if (!r.ok) { const e = new Error(`Google refresh ${r.status}: ${j.error}`); (e as Error & { revoked?: boolean }).revoked = j.error === 'invalid_grant'; throw e }
  return String(j.access_token)
}
export const emailFromIdToken = (idt?: string) => { try { return JSON.parse(new TextDecoder().decode(unb64u(idt!.split('.')[1]))).email ?? null } catch { return null } }

// ---- Google Tasks ----
export type PortalTask = { id: string; title: string; notes: string | null; due_on: string; due_time: string | null; done_at: string | null; google_task_id: string | null
  projects: { number: string; name: string } | null; creator: { full_name: string | null } | null }
const time12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
export function toGoogle(t: PortalTask, portalUrl: string) {
  const lines = [
    t.due_time ? `Time: ${time12(t.due_time)}` : '',
    t.projects ? `Project: ${t.projects.number} · ${t.projects.name}` : '',
    t.notes ?? '',
    `From the Abaya portal${t.creator?.full_name ? ` (added by ${t.creator.full_name})` : ''}: ${portalUrl}`,
  ].filter(Boolean)
  // Google Tasks stores only the date of "due" (time is ignored), so the time goes in the notes
  return { title: t.title, notes: lines.join('\n'), due: `${t.due_on}T00:00:00.000Z`, status: t.done_at ? 'completed' : 'needsAction' }
}
const TASKS = 'https://tasks.googleapis.com/tasks/v1'
export async function gt(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${TASKS}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (r.status === 204) return { status: 204, data: null }
  const data = await r.json().catch(() => null)
  return { status: r.status, data }
}

/** Create or update one portal task in the assignee's Google Tasks. Returns what happened. */
export async function pushTask(db: SupabaseClient, taskId: string, portalUrl: string): Promise<string> {
  const { data: t } = await db.from('tasks').select('id, title, notes, assignee, due_on, due_time, done_at, google_task_id, projects(number, name), creator:profiles!tasks_created_by_fkey(full_name)').eq('id', taskId).maybeSingle()
  if (!t) return 'task not found'
  const { data: c } = await db.from('google_connections').select('refresh_token, tasklist_id').eq('profile_id', t.assignee).maybeSingle()
  if (!c) return 'assignee not connected'
  let token: string
  try { token = await accessToken(c.refresh_token) } catch (e) {
    if ((e as { revoked?: boolean }).revoked) await db.from('google_connections').delete().eq('profile_id', t.assignee) // access was removed in Google
    return 'google access expired'
  }
  const list = encodeURIComponent(c.tasklist_id || '@default')
  const g = toGoogle(t as unknown as PortalTask, portalUrl)
  if (t.google_task_id) {
    const r = await gt(token, 'PATCH', `/lists/${list}/tasks/${encodeURIComponent(t.google_task_id)}`, g)
    if (r.status < 300) { await db.from('tasks').update({ google_synced_at: new Date().toISOString() }).eq('id', t.id); return 'updated' }
    if (r.status !== 404) return `google error ${r.status}`
  }
  const r = await gt(token, 'POST', `/lists/${list}/tasks`, g)
  if (r.status >= 300) return `google error ${r.status}`
  await db.from('tasks').update({ google_task_id: (r.data as { id: string }).id, google_synced_at: new Date().toISOString() }).eq('id', t.id)
  return 'created'
}

export async function deleteTask(db: SupabaseClient, assignee: string, googleTaskId: string | null) {
  if (!googleTaskId) return 'not in google'
  const { data: c } = await db.from('google_connections').select('refresh_token, tasklist_id').eq('profile_id', assignee).maybeSingle()
  if (!c) return 'assignee not connected'
  try {
    const token = await accessToken(c.refresh_token)
    const r = await gt(token, 'DELETE', `/lists/${encodeURIComponent(c.tasklist_id || '@default')}/tasks/${encodeURIComponent(googleTaskId)}`)
    return r.status < 300 || r.status === 404 ? 'deleted' : `google error ${r.status}`
  } catch { return 'google access expired' }
}

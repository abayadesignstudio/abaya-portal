// Shared helpers for the email functions. Copied next to each function's index.ts
// at deploy time (scripts/sync-shared.sh) so every function deploys on its own.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`
export const admin = (): SupabaseClient => createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

/** Is email switched on? Both secrets must be set. */
export const mailConfigured = () => !!Deno.env.get('RESEND_API_KEY') && !!Deno.env.get('MAIL_FROM')
export const NOT_CONFIGURED = { error: 'Email is not configured yet: add RESEND_API_KEY and MAIL_FROM to the Supabase function secrets.', code: 'email_not_configured' }

export async function sendMail(m: { to: string; subject: string; html: string; text: string; replyTo?: string }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('MAIL_FROM'), to: [m.to], subject: m.subject, html: m.html, text: m.text,
      reply_to: m.replyTo ?? Deno.env.get('MAIL_REPLY_TO') ?? undefined }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body?.message ?? JSON.stringify(body)}`)
  return String(body.id ?? '')
}

/** Caller must be signed-in staff (admin or staff). Returns the profile id or null. */
export async function staffCaller(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const db = admin()
  const { data: u } = await db.auth.getUser(auth.slice(7))
  if (!u?.user) return null
  const { data: p } = await db.from('profiles').select('id, role').eq('id', u.user.id).maybeSingle()
  return p && (p.role === 'admin' || p.role === 'staff') ? p.id : null
}

/** Scheduled jobs send x-cron-secret; the value lives only in Supabase Vault. */
export async function cronCaller(req: Request): Promise<boolean> {
  const s = req.headers.get('x-cron-secret')
  if (!s) return false
  const { data } = await admin().rpc('check_cron_secret', { s })
  return data === true
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export const money = (n: number) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
export const longDate = (iso: string | null) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** Today's date and hour in Coppell, Texas */
export function central(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(now).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 }
}

export const FIRM = {
  name: 'Abaya Design Studio, LLC',
  address: '215 S Denton Tap Rd, Suite 215, Coppell, Texas 75019',
  site: 'abayadesignstudio.com',
}

/** Branded email frame: navy header, white card, quiet footer */
export function frame(inner: string, pixelUrl?: string) {
  return `<!doctype html><html><body style="margin:0;background:#f3f1ec;font-family:Arial,Helvetica,sans-serif;color:#1c1f23">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ec;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e4e0d8">
<tr><td style="background:#02253d;padding:22px;text-align:center;font-family:Georgia,'EB Garamond',serif;color:#ede6d6">
<div style="font-size:26px;letter-spacing:6px">ABAYA</div><div style="font-size:10px;letter-spacing:5px">DESIGN STUDIO</div></td></tr>
<tr><td style="padding:26px 28px;font-size:15px;line-height:1.5">${inner}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e4e0d8;font-size:12px;color:#5f6368">${esc(FIRM.name)} · ${esc(FIRM.address)} · ${esc(FIRM.site)}</td></tr>
</table></td></tr></table>${pixelUrl ? `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">` : ''}</body></html>`
}
export const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:14px;padding:12px 22px;background:#02253d;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700">${esc(label)}</a>`
export const paras = (text: string | null | undefined) =>
  (text ?? '').split('\n').filter((l) => l.trim()).map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join('')

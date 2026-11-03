// Emails an invoice (or a reminder) to each recipient separately so opens and views
// can be tracked per person. Staff only. Off until RESEND_API_KEY and MAIL_FROM are set.
import { admin, json, CORS, mailConfigured, NOT_CONFIGURED, staffCaller } from './mail.ts'
import { sendInvoiceEmails } from './invoice-mail.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const actor = await staffCaller(req)
  if (!actor) return json({ error: 'Staff sign-in required' }, 401)
  let body: { invoice_id?: string; mode?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  if (!/^[0-9a-f-]{36}$/i.test(body.invoice_id ?? '')) return json({ error: 'Missing invoice_id' }, 400)
  if (!mailConfigured()) return json(NOT_CONFIGURED, 503)
  try {
    const r = await sendInvoiceEmails(admin(), body.invoice_id!, body.mode === 'reminder' ? 'reminder' : 'invoice', actor)
    return json(r)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
})

// Start an online payment for an invoice from the no-login invoice page.
//  POST { token, method: 'card' | 'ach', r? } → { url } of a Stripe Checkout page for the balance due
//  (plus the processing fee when the invoice passes it to the client). verify_jwt is off: the invoice's unguessable
//  view token is the key, the same as the invoice page itself. GET → { configured, mode } for the Settings page.
import { admin, json, CORS } from './mail.ts'
import { stripeConfigured, stripeMode, stripe, cardFee, achFee } from './stripe.ts'

const UUID = /^[0-9a-f-]{36}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method === 'GET') return json({ configured: stripeConfigured(), webhook: !!Deno.env.get('STRIPE_WEBHOOK_SECRET'), mode: stripeConfigured() ? stripeMode() : null })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!stripeConfigured()) return json({ error: 'Online payment isn’t available yet.', code: 'not_configured' }, 503)
  let b: { token?: string; method?: string; r?: string } = {}
  try { b = await req.json() } catch { /* empty */ }
  if (!UUID.test(b.token ?? '')) return json({ error: 'Not found' }, 404)
  const method = b.method === 'ach' ? 'ach' : 'card'
  const db = admin()
  const { data: inv } = await db.from('invoices')
    .select('id, number, status, total, amount_paid, allow_card, allow_ach, pass_card_fee, pass_ach_fee, view_token, projects(number, name)')
    .eq('view_token', b.token!).maybeSingle()
  if (!inv || inv.status === 'draft' || inv.status === 'void') return json({ error: 'Not found' }, 404)
  const balance = Math.round((Number(inv.total) - Number(inv.amount_paid)) * 100) / 100
  if (balance < 0.5 || inv.status === 'paid') return json({ error: 'This invoice is already paid.' }, 409)
  if ((method === 'card' && !inv.allow_card) || (method === 'ach' && !inv.allow_ach)) return json({ error: 'That payment method isn’t offered on this invoice.' }, 400)
  const fee = method === 'card' ? (inv.pass_card_fee ? cardFee(balance) : 0) : (inv.pass_ach_fee ? achFee(balance) : 0)

  let email: string | null = null
  if (UUID.test(b.r ?? '')) { const { data } = await db.from('invoice_recipients').select('email').eq('invoice_id', inv.id).eq('track_token', b.r!).maybeSingle(); email = data?.email ?? null }
  const { data: fs } = await db.from('firm_settings').select('public_base_url').eq('id', 1).maybeSingle()
  const page = `${(fs?.public_base_url ?? '').replace(/\/$/, '')}/invoice/?t=${inv.view_token}${b.r && UUID.test(b.r) ? `&r=${b.r}` : ''}`
  // deno-lint-ignore no-explicit-any
  const p = inv.projects as any
  const meta = { invoice_id: inv.id, invoice_number: inv.number, applied: balance.toFixed(2), method }
  const lines: Record<string, unknown> = {
    0: { quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(balance * 100), product_data: { name: `Invoice ${inv.number}`, description: `${p?.number ?? ''} ${p?.name ?? ''}`.trim() || undefined } } },
  }
  if (fee > 0) lines[1] = { quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(fee * 100), product_data: { name: method === 'card' ? 'Card processing fee' : 'Bank transfer processing fee' } } }
  try {
    const s = await stripe('POST', '/checkout/sessions', {
      mode: 'payment', line_items: lines, success_url: `${page}&paid=${method}`, cancel_url: page,
      payment_method_types: { 0: method === 'ach' ? 'us_bank_account' : 'card' },
      ...(method === 'ach' ? { payment_method_options: { us_bank_account: { verification_method: 'automatic' } } } : {}),
      customer_email: email ?? undefined, client_reference_id: inv.id, metadata: meta,
      payment_intent_data: { description: `Abaya Design Studio · Invoice ${inv.number}`, metadata: meta },
      submit_type: 'pay',
    })
    await db.from('invoice_events').insert({ invoice_id: inv.id, kind: 'payment_started', recipient: email, detail: `Opened ${method === 'ach' ? 'bank transfer' : 'card'} checkout` })
    return json({ url: s.url })
  } catch (e) {
    console.error(e)
    return json({ error: 'Online payment couldn’t start. Please try again, or contact billing@abayadesignstudio.com.' }, 502)
  }
})

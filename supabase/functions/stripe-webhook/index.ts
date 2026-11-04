// Stripe tells the portal when an online payment finishes. Endpoint: …/functions/v1/stripe-webhook
// Events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed.
//  - Card payments are paid at checkout → recorded on the invoice right away.
//  - Bank (ACH) payments take a few business days: logged as started, recorded when Stripe confirms, or marked failed.
// verify_jwt is off: every request must carry a valid Stripe-Signature for STRIPE_WEBHOOK_SECRET.
import { admin, json } from './mail.ts'
import { verifySignature, recordPayment, notifyAdmins } from './stripe.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const payload = await req.text()
  if (!(await verifySignature(payload, req.headers.get('stripe-signature')))) return json({ error: 'Bad signature' }, 400)
  const ev = JSON.parse(payload)
  const s = ev.data?.object
  if (!s?.metadata?.invoice_id) return json({ ignored: true })
  const db = admin()
  const num = s.metadata.invoice_number ?? ''
  if (ev.type === 'checkout.session.completed') {
    if (s.payment_status === 'paid') return json({ result: await recordPayment(db, s) })
    // ACH: money is on its way
    await db.from('invoice_events').insert({ invoice_id: s.metadata.invoice_id, kind: 'payment_started', recipient: s.customer_details?.email ?? null,
      detail: `Bank transfer of $${s.metadata.applied} submitted; it usually clears in about 4 business days. Stripe ref ${s.id}` })
    await notifyAdmins(db, `Invoice ${num}: bank transfer of $${s.metadata.applied} submitted (clears in about 4 business days).`, '#/invoices')
    return json({ result: 'processing' })
  }
  if (ev.type === 'checkout.session.async_payment_succeeded') return json({ result: await recordPayment(db, s) })
  if (ev.type === 'checkout.session.async_payment_failed') {
    await db.from('invoice_events').insert({ invoice_id: s.metadata.invoice_id, kind: 'payment_failed', detail: `Bank transfer of $${s.metadata.applied} failed. Stripe ref ${s.id}` })
    await notifyAdmins(db, `Invoice ${num}: bank transfer of $${s.metadata.applied} failed.`, '#/invoices')
    return json({ result: 'failed' })
  }
  return json({ ignored: ev.type })
})

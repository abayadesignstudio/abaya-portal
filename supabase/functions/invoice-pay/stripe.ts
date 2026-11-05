// Stripe helpers for online invoice payments. Copied next to each function at deploy time (scripts/sync-shared.sh).
// Uses the firm's own Stripe account: STRIPE_SECRET_KEY (a restricted or secret key) and STRIPE_WEBHOOK_SECRET
// (signing secret of the webhook endpoint …/functions/v1/stripe-webhook) live only in Supabase function secrets.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const stripeConfigured = () => !!Deno.env.get('STRIPE_SECRET_KEY')
export const stripeMode = () => (Deno.env.get('STRIPE_SECRET_KEY') ?? '').includes('_test_') ? 'test' : 'live'
const round2 = (n: number) => Math.round(n * 100) / 100
// same estimates the invoice builder shows (cards 2.9% + 30¢; ACH 0.8%, $5 cap)
export const cardFee = (t: number) => round2(t * 0.029 + 0.3)
export const achFee = (t: number) => round2(Math.min(t * 0.008, 5))
/** Card payment is only offered while the card fee would stay at or under this (invoices up to about $17,231). */
export const CARD_FEE_MAX = 500
export const cardAllowed = (t: number) => cardFee(t) <= CARD_FEE_MAX

/** Flatten { a: { b: 1 } } into Stripe's form encoding a[b]=1. */
function form(o: Record<string, unknown>, pre = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue
    const key = pre ? `${pre}[${k}]` : k
    if (typeof v === 'object') form(v as Record<string, unknown>, key, out)
    else out.append(key, String(v))
  }
  return out
}
export async function stripe(method: 'GET' | 'POST', path: string, params?: Record<string, unknown>) {
  const r = await fetch(`https://api.stripe.com/v1${path}${method === 'GET' && params ? `?${form(params)}` : ''}`, {
    method, headers: { Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    body: method === 'POST' && params ? form(params) : undefined,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${data?.error?.message ?? 'error'}`)
  return data
}

/** Check the Stripe-Signature header (HMAC-SHA256 of "t.payload"); rejects anything older than 5 minutes. */
export async function verifySignature(payload: string, header: string | null) {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!secret || !header) return false
  const t = header.split(',').find((p) => p.startsWith('t='))?.slice(2)
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3))
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)))
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0)
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** Tell every admin (bell + home page). */
export async function notifyAdmins(db: SupabaseClient, text: string, href: string) {
  const { data: admins } = await db.from('profiles').select('id').eq('role', 'admin')
  if (admins?.length) await db.from('notifications').insert(admins.map((a) => ({ profile_id: a.id, kind: 'payment', text, href })))
}

// deno-lint-ignore no-explicit-any
type Session = { id: string; metadata?: Record<string, string>; amount_total?: number; payment_method_types?: string[]; customer_details?: { email?: string | null } | any }

/** Apply a successful Checkout payment to its invoice once (Stripe may deliver the same event more than once). */
export async function recordPayment(db: SupabaseClient, s: Session) {
  const invoiceId = s.metadata?.invoice_id
  const applied = Number(s.metadata?.applied ?? 0)
  if (!invoiceId || !(applied > 0)) return 'no invoice'
  const { count } = await db.from('invoice_events').select('id', { count: 'exact', head: true }).eq('invoice_id', invoiceId).eq('kind', 'paid').like('detail', `%${s.id}%`)
  if (count) return 'already recorded'
  const { data: inv } = await db.from('invoices').select('id, number, total, amount_paid, status').eq('id', invoiceId).maybeSingle()
  if (!inv) return 'invoice missing'
  const how = s.metadata?.method === 'ach' ? 'ACH (Stripe)' : 'Card (Stripe)'
  const paid = round2(Number(inv.amount_paid) + applied)
  const full = paid >= Number(inv.total) - 0.005
  const today = new Date().toISOString().slice(0, 10)
  await db.from('invoices').update({ amount_paid: paid, status: full ? 'paid' : inv.status, paid_at: full ? today : null, payment_method: how }).eq('id', inv.id)
  const fee = round2((s.amount_total ?? 0) / 100 - applied)
  await db.from('invoice_events').insert({ invoice_id: inv.id, kind: 'paid', recipient: s.customer_details?.email ?? null,
    detail: `${full ? 'Paid in full' : 'Partial payment'} online: ${money(applied)} by ${how}${fee > 0.004 ? ` (client also paid ${money(fee)} processing fee)` : ''}. Stripe ref ${s.id}` })
  await notifyAdmins(db, `Invoice ${inv.number} ${full ? 'paid in full' : 'partly paid'} online: ${money(applied)} by ${how === 'ACH (Stripe)' ? 'bank transfer' : 'card'}.`, `#/invoices`)
  return 'recorded'
}

// Public invoice data for the no-login invoice page. Only the invoice whose
// unguessable view_token is given; records a "viewed" event.
import { admin, json, CORS } from './mail.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const q = new URL(req.url).searchParams
  const token = q.get('token') ?? '', r = q.get('r') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: 'Not found' }, 404)
  const db = admin()
  const { data: inv } = await db.from('invoices')
    .select('id, number, status, issue_date, due_date, terms_days, period_start, period_end, total, amount_paid, note, allow_card, allow_ach, pass_card_fee, pass_ach_fee, billing_basis, allow_wire, projects(number, name, sector), clients(name)')
    .eq('view_token', token).maybeSingle()
  if (!inv || inv.status === 'draft' || inv.status === 'void') return json({ error: 'Not found' }, 404)
  const { data: lines } = await db.from('invoice_lines').select('kind, description, pct_to_date, amount, sort').eq('invoice_id', inv.id).order('sort')

  let recipient: string | null = null
  if (/^[0-9a-f-]{36}$/i.test(r)) {
    const { data: rc } = await db.from('invoice_recipients').select('email').eq('track_token', r).eq('invoice_id', inv.id).maybeSingle()
    recipient = rc?.email ?? null
  }
  const since = new Date(Date.now() - 10 * 60000).toISOString()
  let dup = db.from('invoice_events').select('id', { count: 'exact', head: true }).eq('invoice_id', inv.id).eq('kind', 'viewed').gte('at', since)
  dup = recipient ? dup.eq('recipient', recipient) : dup.is('recipient', null)
  const { count } = await dup
  if (!count) await db.from('invoice_events').insert({ invoice_id: inv.id, kind: 'viewed', recipient })

  // wire instructions: only on this page (never emailed), only when the invoice allows wire and Settings has them
  let wire = null
  if (inv.allow_wire && inv.status === 'open') {
    const { data: fs } = await db.from('firm_settings').select('phone, wire_bank_name, wire_bank_address, wire_account_name, wire_routing, wire_account, wire_swift, wire_notes').eq('id', 1).maybeSingle()
    if (fs?.wire_routing && fs?.wire_account) wire = { bank_name: fs.wire_bank_name, bank_address: fs.wire_bank_address, account_name: fs.wire_account_name, routing: fs.wire_routing,
      account: fs.wire_account, swift: fs.wire_swift, notes: fs.wire_notes, phone: fs.phone }
  }
  // card only while the card fee would stay at or under $500 (same rule as invoice-pay / _shared/stripe.ts)
  const due = Math.max(0, Number(inv.total) - Number(inv.amount_paid))
  const cardTooBig = Math.round((due * 0.029 + 0.3) * 100) / 100 > 500
  // deno-lint-ignore no-explicit-any
  const p = inv.projects as any, c = inv.clients as any
  return json({
    number: inv.number, status: inv.status, issue_date: inv.issue_date, due_date: inv.due_date, terms_days: inv.terms_days,
    period_start: inv.period_start, period_end: inv.period_end, total: Number(inv.total), amount_paid: Number(inv.amount_paid), note: inv.note,
    allow_card: inv.allow_card && !cardTooBig, card_limited: inv.allow_card && cardTooBig, allow_ach: inv.allow_ach, pass_card_fee: inv.pass_card_fee, pass_ach_fee: inv.pass_ach_fee,
    pay_online: !!Deno.env.get('STRIPE_SECRET_KEY'), advance: inv.billing_basis === 'advance', wire,
    project: { number: p?.number ?? '', name: p?.name ?? '', sector: p?.sector ?? null }, client: c?.name ?? null,
    lines: (lines ?? []).map((l) => ({ kind: l.kind, description: l.description, pct_to_date: l.pct_to_date === null ? null : Number(l.pct_to_date), amount: Number(l.amount) })),
  })
})

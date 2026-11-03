// Builds and sends invoice / reminder emails, one per recipient, and logs events.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sendMail, frame, button, paras, esc, money, longDate, FUNCTIONS_URL } from './mail.ts'

export async function sendInvoiceEmails(db: SupabaseClient, invoiceId: string, mode: 'invoice' | 'reminder', actor: string | null) {
  const { data: inv, error } = await db.from('invoices')
    .select('id, number, status, total, amount_paid, due_date, issue_date, view_token, email_subject, email_message, reminders_sent, projects(number, name), clients(name)')
    .eq('id', invoiceId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!inv) throw new Error('Invoice not found')
  if (inv.status === 'void' || inv.status === 'paid' || inv.status === 'uncollectible') throw new Error(`Invoice is ${inv.status}`)
  const { data: rcpts } = await db.from('invoice_recipients').select('email, kind, track_token').eq('invoice_id', invoiceId)
  if (!rcpts?.length) throw new Error('Add at least one recipient')
  const { data: fs } = await db.from('firm_settings').select('public_base_url').eq('id', 1).maybeSingle()
  const base = (fs?.public_base_url ?? '').replace(/\/$/, '')
  // deno-lint-ignore no-explicit-any
  const project = inv.projects as any, client = inv.clients as any
  const due = Math.max(0, Number(inv.total) - Number(inv.amount_paid))
  const subject = mode === 'reminder'
    ? `Reminder: invoice ${inv.number} — ${money(due)} ${inv.due_date ? `due ${longDate(inv.due_date)}` : 'due'}`
    : (inv.email_subject || `Invoice ${inv.number} — ${project?.name ?? ''}`)
  const intro = mode === 'reminder'
    ? `<p style="margin:0 0 10px">This is a friendly reminder that invoice ${esc(inv.number)} for ${esc(project?.name ?? 'your project')} is still open.</p>`
    : paras(inv.email_message || `Please find our invoice ${inv.number} for ${project?.name ?? 'your project'} below.`)

  const sent: string[] = []
  const failed: { email: string; error: string }[] = []
  for (const r of rcpts) {
    const link = `${base}/invoice/?t=${inv.view_token}&r=${r.track_token}`
    const pixel = `${FUNCTIONS_URL}/track-open?t=${r.track_token}`
    const card = `<div style="margin:18px 0;padding:18px;border:1px solid #e4e0d8;border-radius:8px;text-align:center">
<div style="color:#5f6368">Invoice ${esc(inv.number)} · ${esc(project?.name ?? '')}</div>
<div style="font-size:30px;font-weight:700;margin:6px 0 2px">${money(due)}</div>
<div style="color:#5f6368">${inv.due_date ? `Due ${longDate(inv.due_date)}` : 'Due on receipt'}</div>
${button(link, 'View & pay invoice')}</div>`
    const html = frame(`${intro}${card}<p style="margin:0;font-size:13px;color:#5f6368">Questions? Reply to this email.</p>`, pixel)
    const text = `${mode === 'reminder' ? 'Reminder: ' : ''}Invoice ${inv.number} for ${project?.name ?? ''}\nAmount due: ${money(due)}\n${inv.due_date ? `Due ${longDate(inv.due_date)}\n` : ''}View and pay: ${link}\n`
    try {
      const id = await sendMail({ to: r.email, subject, html, text })
      sent.push(r.email)
      await db.from('invoice_events').insert({ invoice_id: inv.id, kind: 'delivered', recipient: r.email, detail: `Accepted by mail service (${id})` })
    } catch (e) {
      failed.push({ email: r.email, error: e instanceof Error ? e.message : String(e) })
      await db.from('invoice_events').insert({ invoice_id: inv.id, kind: 'bounced', recipient: r.email, detail: e instanceof Error ? e.message : String(e) })
    }
  }
  if (sent.length) {
    if (mode === 'invoice') {
      await db.from('invoices').update({ status: 'open', sent_at: new Date().toISOString() }).eq('id', inv.id)
      await db.from('invoice_events').insert({ invoice_id: inv.id, kind: 'sent', actor, detail: `Emailed to ${sent.join(', ')}` })
    } else {
      await db.from('invoices').update({ reminders_sent: (inv.reminders_sent ?? 0) + 1, last_reminder_at: new Date().toISOString() }).eq('id', inv.id)
      await db.from('invoice_events').insert({ invoice_id: inv.id, kind: 'reminder', actor, detail: `Reminder emailed to ${sent.join(', ')}` })
    }
  }
  if (!sent.length) throw new Error(`No email was sent: ${failed.map((f) => `${f.email} (${f.error})`).join('; ')}`)
  return { sent, failed, client: client?.name ?? null }
}

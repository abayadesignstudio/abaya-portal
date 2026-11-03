// Runs hourly from pg_cron; once a day after 9 AM Central it emails reminders for open
// invoices whose days past due match firm_settings.reminder_days (0 = due date).
import { admin, json, CORS, cronCaller, mailConfigured, NOT_CONFIGURED, central } from './mail.ts'
import { sendInvoiceEmails } from './invoice-mail.ts'

const daysBetween = (a: string, b: string) => {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!(await cronCaller(req))) return json({ error: 'Forbidden' }, 403)
  const db = admin()
  const { date, hour } = central()
  const { data: fs } = await db.from('firm_settings').select('reminder_days, last_reminders_on').eq('id', 1).single()
  if (hour < 9 || fs?.last_reminders_on === date) return json({ skipped: true, date, hour })
  if (!mailConfigured()) return json(NOT_CONFIGURED, 503)

  const days: number[] = fs?.reminder_days ?? [0, 7, 14, 21]
  const { data: open } = await db.from('invoices').select('id, number, due_date, last_reminder_at, sent_at')
    .eq('status', 'open').eq('reminders', true).not('due_date', 'is', null).not('sent_at', 'is', null)
  const results: { number: string; ok: boolean; error?: string }[] = []
  for (const inv of open ?? []) {
    const late = daysBetween(inv.due_date!, date)
    if (late < 0 || !days.includes(late)) continue
    if (inv.last_reminder_at && central(new Date(inv.last_reminder_at)).date === date) continue
    try { await sendInvoiceEmails(db, inv.id, 'reminder', null); results.push({ number: inv.number, ok: true }) }
    catch (e) { results.push({ number: inv.number, ok: false, error: e instanceof Error ? e.message : String(e) }) }
  }
  await db.from('firm_settings').update({ last_reminders_on: date }).eq('id', 1)
  return json({ date, reminders: results })
})

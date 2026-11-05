import { supabase } from './supabase'
import { must } from './useQuery'

export type InvoiceRow = {
  id: string; number: string; project_id: string; client_id: string | null; status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'
  issue_date: string | null; due_date: string | null; paid_at: string | null; total: number; amount_paid: number; payment_method: string | null
  project_number: string; project_name: string; sector: string | null; client_name: string | null; best_activity: string | null; days_past_due: number
}
export type InvEvent = { id: number; invoice_id: string; kind: string; recipient: string | null; detail: string | null; at: string }

export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const addDays = (isoDate: string, n: number) => { const [y, m, d] = isoDate.split('-').map(Number); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
export const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—'
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
export const num = (x: string | number | null | undefined) => { const n = parseFloat(String(x ?? '').replace(/[$,]/g, '')); return isFinite(n) ? n : 0 }
export const round2 = (n: number) => Math.round(n * 100) / 100

/** Effective status shown to people: open + due date passed = past due */
export function displayStatus(i: Pick<InvoiceRow, 'status' | 'due_date' | 'total' | 'amount_paid'>): { key: string; label: string; color: string } {
  if (i.status === 'paid') return { key: 'paid', label: 'Paid', color: '#067647' }
  if (i.status === 'uncollectible') return { key: 'uncollectible', label: 'Uncollectible', color: '#5f6368' }
  if (i.status === 'void') return { key: 'void', label: 'Void', color: '#5f6368' }
  if (i.status === 'draft') return { key: 'draft', label: 'Draft', color: '#5f6368' }
  const due = i.due_date ?? ''
  const t = todayIso()
  if (due && due < t) return { key: 'past', label: 'Past due', color: '#b42318' }
  if (due === t) return { key: 'due', label: 'Due today', color: '#b54708' }
  return { key: 'open', label: 'Open', color: '#1c1f23' }
}
export const daysBetween = (a: string, b: string) => {
  const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

const KIND_LABEL: Record<string, string> = {
  created: 'Created', sent: 'Sent', delivered: 'Delivered', bounced: 'Bounced', opened: 'Opened the email', viewed: 'Viewed the invoice',
  reminder: 'Reminder sent', payment_started: 'Payment started', paid: 'Paid', payment_failed: 'Payment failed', voided: 'Voided', note: 'Note',
}
export const eventLabel = (e: InvEvent) => (e.kind === 'note' ? (e.detail ?? 'Note') : KIND_LABEL[e.kind] ?? e.kind)
export const EVENT_STYLE: Record<string, [string, string]> = {
  sent: ['#02253d', '↗'], reminder: ['#02253d', '↗'], delivered: ['#98a2b3', '•'], opened: ['#b54708', '✉'], viewed: ['#067647', '◉'],
  payment_started: ['#067647', '$'], paid: ['#067647', '✓'], payment_failed: ['#b42318', '!'], bounced: ['#b42318', '!'], voided: ['#5f6368', '×'],
  note: ['#98a2b3', '•'], created: ['#98a2b3', '+'],
}

/** "Client activity" for the list: best tracked event, else what Monograph last reported */
export function activityOf(i: InvoiceRow, events: InvEvent[]): { label: string; color: string } {
  if (i.status === 'paid') return { label: 'Paid', color: '#067647' }
  const kinds = new Set(events.map((e) => e.kind))
  if (kinds.has('payment_started')) return { label: 'Payment started', color: '#067647' }
  if (kinds.has('viewed')) return { label: 'Viewed invoice', color: '#067647' }
  if (kinds.has('opened')) return { label: 'Opened email · not viewed', color: '#b54708' }
  const imported = events.find((e) => e.kind === 'note' && e.detail?.startsWith('Imported from Monograph'))
  if (imported) {
    const m = /last activity: ([a-z_]+)/.exec(imported.detail ?? '')
    const map: Record<string, [string, string]> = {
      viewed: ['Viewed (Monograph)', '#067647'], sent: ['Sent, not opened (Monograph)', '#b42318'], sent_reminder: ['Reminder sent (Monograph)', '#b54708'],
      marked_as_uncollectible: ['Marked uncollectible', '#5f6368'], marked_as_paid: ['Marked paid', '#067647'], payment_succeeded: ['Paid online', '#067647'],
    }
    const v = map[m?.[1] ?? ''] ?? [`${(m?.[1] ?? 'imported').replace(/_/g, ' ')} (Monograph)`, '#5f6368']
    return { label: v[0], color: v[1] }
  }
  if (kinds.has('sent')) return { label: 'Sent · not opened', color: '#b42318' }
  if (i.status === 'draft') return { label: 'Not sent', color: '#5f6368' }
  return { label: '—', color: '#5f6368' }
}

/** Stripe standard US pricing estimates (confirm against the account) */
export const cardFee = (t: number) => round2(t * 0.029 + 0.3)
export const CARD_FEE_MAX = 500 // card isn't offered when its fee would top this (same rule in the invoice-pay function)
export const achFee = (t: number) => round2(Math.min(t * 0.008, 5))

/** Next invoice number for a project: <project number>-NNN */
export async function nextInvoiceNumber(projectId: string, projectNumber: string) {
  const rows = must(await supabase.from('invoices').select('number').eq('project_id', projectId)) as { number: string }[]
  let max = 0
  rows.forEach((r) => { const m = /-(\d+)$/.exec(r.number); if (m) max = Math.max(max, parseInt(m[1], 10)) })
  let n = max + 1
  const taken = new Set(rows.map((r) => r.number))
  while (taken.has(`${projectNumber}-${String(n).padStart(3, '0')}`)) n++
  return `${projectNumber}-${String(n).padStart(3, '0')}`
}

/** Email an invoice (or a reminder) through the send-invoice function.
 *  Returns notConfigured when the email provider keys haven't been added yet — nothing is marked sent then. */
export async function emailInvoice(invoiceId: string, mode: 'invoice' | 'reminder' = 'invoice'): Promise<{ ok: boolean; message: string; notConfigured?: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-invoice', { body: { invoice_id: invoiceId, mode } })
  if (!error) {
    const r = data as { sent: string[]; failed: { email: string; error: string }[] }
    const what = mode === 'reminder' ? 'Reminder emailed' : 'Invoice emailed'
    return { ok: true, message: `${what} to ${r.sent.join(', ')}.${r.failed.length ? ` Couldn’t send to ${r.failed.map((f) => f.email).join(', ')}.` : ''}` }
  }
  let body: { error?: string; code?: string } = {}
  const ctx = (error as { context?: unknown }).context
  if (ctx instanceof Response) body = await ctx.json().catch(() => ({}))
  if (body.code === 'email_not_configured') return { ok: false, notConfigured: true, message: 'Email isn’t switched on yet, so nothing was sent and the invoice is still a draft. Once the email provider key is added in Supabase, this button sends it.' }
  return { ok: false, message: body.error ?? error.message }
}

import { supabase, PHASES } from './supabase'

export type PhaseRow = { id: string; code: string; fee: number; status: string; start_date: string | null; end_date: string | null; meetings_included: number | null }
export type Update = { id: string; project_id: string; author: string | null; kind: string; title: string | null; body: string | null; items: string[]; photo_paths: string[]
  visible_to_client: boolean; notify: string; created_at: string; profiles?: { full_name: string | null } | null }
export type Drawing = { id: string; project_id: string; phase_id: string | null; title: string; sheet_count: number | null; issued_on: string; storage_path: string; locked_until_invoice: string | null }
export type ContractItem = { id: string; project_id: string; phase_id: string | null; title: string; status: string; sort: number }
export type Meeting = { id: string; project_id: string; phase_id: string | null; held_on: string; title: string | null }
export type ServiceRequest = { id: string; project_id: string; description: string; status: string; quote: number | null; created_at: string }

export const sortPhases = <T extends { code: string }>(list: T[]) => [...list].sort((a, b) => PHASES.findIndex(([c]) => c === a.code) - PHASES.findIndex(([c]) => c === b.code))

/** Phase colors: complete = gray, in progress = green, paused = red, not started = outline */
export const PHASE_STYLE: Record<string, { bg: string; fg: string; border: string; label: string }> = {
  complete: { bg: '#e4e7ec', fg: '#344054', border: '#d0d5dd', label: 'Complete' },
  in_progress: { bg: '#039855', fg: '#ffffff', border: '#039855', label: 'In progress' },
  paused: { bg: '#d92d20', fg: '#ffffff', border: '#d92d20', label: 'Paused' },
  not_started: { bg: '#ffffff', fg: '#475467', border: '#98a2b3', label: 'Not started' },
}
export const BAR_COLOR: Record<string, string> = { complete: '#d0d5dd', in_progress: '#039855', paused: '#d92d20', not_started: '#98a2b3' }

export const KIND_LABEL: Record<string, string> = { memo: 'Memo', photos: 'Photos', list: 'List', meeting: 'Meeting notes', change: 'Change from meeting' }

export const fmtDate = (d: string | null | undefined) => d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export async function signedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data } = await supabase.storage.from('photos').createSignedUrls(paths, 3600)
  return Object.fromEntries((data ?? []).filter((x) => x.signedUrl && x.path).map((x) => [x.path as string, x.signedUrl as string]))
}

/** Ask the drawing-url function for a signed link. Returns {url} or {locked, invoice}. */
export async function drawingLink(id: string, download = false): Promise<{ url?: string; locked?: boolean; invoice?: string | null; error?: string }> {
  const { data: s } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drawing-url${download ? '?download=1' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string },
    body: JSON.stringify({ id }),
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 402) return { locked: true, invoice: body.invoice ?? null }
  if (!res.ok) return { error: body.error ?? `Error ${res.status}` }
  return { url: body.url }
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))
export const extOf = (name: string) => (name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')

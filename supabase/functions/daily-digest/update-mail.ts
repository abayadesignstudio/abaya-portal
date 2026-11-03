// Formats project updates (memos, lists, meeting notes, photos) for client email.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { esc } from './mail.ts'

export type Upd = { id: string; project_id: string; kind: string; title: string | null; body: string | null; items: unknown; photo_paths: string[]; created_at: string }

export async function updateHtml(db: SupabaseClient, u: Upd) {
  const items = Array.isArray(u.items) ? (u.items as unknown[]).map((x) => (typeof x === 'string' ? x : (x as { text?: string })?.text ?? '')).filter(Boolean) : []
  const label: Record<string, string> = { memo: 'Memo', photos: 'Photos', list: 'List', meeting: 'Meeting notes', change: 'Change from meeting' }
  let photos = ''
  for (const p of (u.photo_paths ?? []).slice(0, 4)) {
    const { data } = await db.storage.from('photos').createSignedUrl(p, 60 * 60 * 24 * 7)
    if (data?.signedUrl) photos += `<img src="${data.signedUrl}" alt="" width="240" style="width:240px;max-width:48%;margin:4px 4px 0 0;border-radius:6px">`
  }
  return `<div style="margin:0 0 16px;padding:0 0 14px;border-bottom:1px solid #efece6">
<div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#5f6368">${esc(label[u.kind] ?? 'Update')}</div>
${u.title ? `<div style="font-weight:700;margin:4px 0">${esc(u.title)}</div>` : ''}
${u.body ? `<div style="white-space:pre-wrap">${esc(u.body)}</div>` : ''}
${items.length ? `<ul style="margin:6px 0 0;padding-left:20px">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}${photos}</div>`
}
export function updateText(u: Upd) {
  const items = Array.isArray(u.items) ? (u.items as unknown[]).map((x) => (typeof x === 'string' ? x : (x as { text?: string })?.text ?? '')).filter(Boolean) : []
  return [u.title, u.body, ...items.map((i) => `- ${i}`)].filter(Boolean).join('\n')
}

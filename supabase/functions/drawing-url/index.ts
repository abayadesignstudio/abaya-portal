// Returns a short-lived signed URL for a drawing, only if the caller can see it
// (row-level security decides) and it is not held for an unpaid invoice.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const auth = req.headers.get('Authorization') ?? ''
  let id = ''
  try { id = String((await req.json()).id ?? '') } catch { /* fallthrough */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Missing drawing id' }, 400)

  const url = Deno.env.get('SUPABASE_URL')!
  // As the caller: RLS decides whether this drawing is visible at all
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: d, error } = await asUser.from('drawings').select('id, storage_path, title, locked_until_invoice').eq('id', id).maybeSingle()
  if (error) return json({ error: error.message }, 400)
  if (!d) return json({ error: 'Not found' }, 404)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if (d.locked_until_invoice) {
    const { data: inv } = await admin.from('invoices').select('status, number').eq('id', d.locked_until_invoice).maybeSingle()
    if (!inv || inv.status !== 'paid') return json({ locked: true, invoice: inv?.number ?? null }, 402)
  }
  const download = new URL(req.url).searchParams.get('download') === '1'
  const { data: signed, error: sErr } = await admin.storage.from('drawings').createSignedUrl(d.storage_path, 600, download ? { download: `${d.title}.pdf` } : undefined)
  if (sErr) return json({ error: sErr.message }, 500)
  return json({ url: signed.signedUrl })
})

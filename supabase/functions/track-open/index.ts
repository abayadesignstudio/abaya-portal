// 1×1 tracking image. Records "opened" for the recipient (at most once per 10 minutes).
// Apple Mail and some filters fetch images automatically, so this is a hint, not proof.
import { admin } from './mail.ts'

const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0))
const img = () => new Response(GIF, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, private', 'Access-Control-Allow-Origin': '*' } })

Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get('t') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(t)) return img()
  try {
    const db = admin()
    const { data: r } = await db.from('invoice_recipients').select('invoice_id, email').eq('track_token', t).maybeSingle()
    if (r) {
      const since = new Date(Date.now() - 10 * 60000).toISOString()
      const { count } = await db.from('invoice_events').select('id', { count: 'exact', head: true })
        .eq('invoice_id', r.invoice_id).eq('kind', 'opened').eq('recipient', r.email).gte('at', since)
      if (!count) await db.from('invoice_events').insert({ invoice_id: r.invoice_id, kind: 'opened', recipient: r.email })
    }
  } catch { /* never break the image */ }
  return img()
})

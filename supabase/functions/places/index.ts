// Location suggestions for the portal's event form, from Google Maps (Places API "Autocomplete (New)").
// POST with a staff member's JWT: { q: string, session?: string, near?: { lat, lng } }  →  { suggestions: [{ text, main, secondary, place_id }] }
// Needs the Supabase secret GOOGLE_MAPS_API_KEY (Google Cloud key restricted to the Places API (New)).
// Without it the function answers 503 { code: 'not_configured' } and the form stays a plain text box.
import { json, CORS, staffCaller } from './mail.ts'

const KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? ''
// The firm is in Coppell: bias results toward DFW unless the phone sends where it is
const DFW = { latitude: 32.9546, longitude: -97.015 }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!(await staffCaller(req))) return json({ error: 'Forbidden' }, 403)
  if (!KEY) return json({ error: 'Google Maps search isn’t set up yet.', code: 'not_configured' }, 503)
  // deno-lint-ignore no-explicit-any
  let b: any = {}
  try { b = await req.json() } catch { /* empty */ }
  const q = typeof b.q === 'string' ? b.q.trim().slice(0, 200) : ''
  if (q.length < 2) return json({ suggestions: [] })
  const near = b.near && Number.isFinite(+b.near.lat) && Number.isFinite(+b.near.lng) ? { latitude: +b.near.lat, longitude: +b.near.lng } : DFW
  const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY },
    body: JSON.stringify({
      input: q, includedRegionCodes: ['us'], languageCode: 'en',
      locationBias: { circle: { center: near, radius: 50000 } },
      ...(typeof b.session === 'string' && b.session.length <= 64 ? { sessionToken: b.session } : {}),
    }),
  })
  // deno-lint-ignore no-explicit-any
  const d: any = await r.json().catch(() => ({}))
  if (!r.ok) return json({ error: d?.error?.message ?? 'Google Maps search failed.' }, 502)
  // deno-lint-ignore no-explicit-any
  const suggestions = (d.suggestions ?? []).map((s: any) => s.placePrediction).filter(Boolean).slice(0, 6).map((p: any) => ({
    place_id: p.placeId, text: p.text?.text ?? '',
    main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '', secondary: p.structuredFormat?.secondaryText?.text ?? '',
  }))
  return json({ suggestions })
})

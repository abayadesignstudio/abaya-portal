// Just what the widget needs from the Google helpers: an access token and the caller's calendar events.
export async function accessToken(refresh: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refresh, client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!, grant_type: 'refresh_token' }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Google refresh ${r.status}: ${j.error}`)
  return String(j.access_token)
}
export type GItem = { id: string; status?: string; summary?: string; visibility?: string
  start?: { date?: string; dateTime?: string }; attendees?: { self?: boolean; responseStatus?: string }[] }
export async function listEvents(token: string, from: string, to: string): Promise<GItem[] | null> {
  const q = new URLSearchParams({ timeMin: `${from}T00:00:00-12:00`, timeMax: `${to}T23:59:59+14:00`, singleEvents: 'true', orderBy: 'startTime', maxResults: '100' })
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) return null
  return ((await r.json()).items ?? []) as GItem[]
}

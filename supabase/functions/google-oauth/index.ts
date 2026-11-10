// Connect a staff member's Google account for task sync.
//  POST (signed-in staff, JSON { return_to, gmail? })  → { url } to send the browser to Google's consent screen.
//       gmail: true also asks for read-only Gmail, used to log project emails as project updates (email-sync).
//  GET  ?code&state  (Google's redirect back)    → stores the refresh token, syncs open tasks, returns to the portal.
// verify_jwt is off because Google's redirect carries no Supabase token; the POST checks the caller itself and the
// GET trusts only a state value this function signed (15-minute expiry).
import { admin, json, CORS, staffCaller } from './mail.ts'
import { googleConfigured, GOOGLE_NOT_CONFIGURED, SCOPES, redirectUri, signState, readState, exchangeCode, emailFromIdToken, pushTask } from './google.ts'

const GMAIL = 'https://www.googleapis.com/auth/gmail.readonly'
const ALLOWED_RETURN = /^https:\/\/([a-z0-9-]+\.github\.io|(portal\.)?abayadesignstudio\.com)(\/|$)|^http:\/\/localhost(:\d+)?\//

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)

  if (req.method === 'POST') {
    const uid = await staffCaller(req)
    if (!uid) return json({ error: 'Forbidden' }, 403)
    if (!googleConfigured()) return json(GOOGLE_NOT_CONFIGURED, 503)
    let ret = '', gmail = false
    try { const b = await req.json(); ret = String(b.return_to ?? ''); gmail = b.gmail === true } catch { /* empty */ }
    if (!ALLOWED_RETURN.test(ret)) return json({ error: 'Bad return address' }, 400)
    const q = new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, redirect_uri: redirectUri(), response_type: 'code', scope: [...SCOPES, ...(gmail ? [GMAIL] : [])].join(' '),
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: await signState({ uid, ret }),
    })
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` })
  }

  if (req.method === 'GET') {
    const st = await readState(url.searchParams.get('state') ?? '')
    if (!st) return new Response('This link has expired. Go back to the portal and click Connect Google again.', { status: 400 })
    const back = (result: string) => Response.redirect(`${st.ret.split('#')[0]}#/account?google=${result}`, 302)
    if (url.searchParams.get('error')) return back('cancelled')
    const code = url.searchParams.get('code')
    if (!code || !googleConfigured()) return back('error')
    try {
      const tok = await exchangeCode(code)
      if (!tok.refresh_token) return back('error')
      const db = admin()
      const granted = String((tok as { scope?: string }).scope ?? '').split(' ')
      await db.from('google_connections').upsert({ profile_id: st.uid, refresh_token: tok.refresh_token, google_email: emailFromIdToken(tok.id_token), tasklist_id: '@default', connected_at: new Date().toISOString(),
        gmail_enabled: granted.includes(GMAIL) })
      // send this person's open tasks (last 30 days onward) to Google right away
      const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
      const { data: open } = await db.from('tasks').select('id').eq('assignee', st.uid).is('done_at', null).is('google_task_id', null).gte('due_on', since).limit(100)
      const portal = `${st.ret.split('#')[0]}`
      for (const t of open ?? []) { try { await pushTask(db, t.id, portal) } catch { /* keep going */ } }
      return back('connected')
    } catch { return back('error') }
  }
  return json({ error: 'Method not allowed' }, 405)
})

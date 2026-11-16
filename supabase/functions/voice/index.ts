// Voice: transcribes recordings and turns them into portal records.
//   POST { action: 'conversation', id }  → transcribe a recorded client conversation in the background,
//        summarize it, post an internal note on the project, notify the person who recorded it.
//   POST { action: 'dictate', path }     → transcribe a short dictation and propose a task, note or time entry
//        (the phone shows it for confirmation; nothing is saved here).
// Secrets: OPENAI_API_KEY (speech-to-text, required). ANTHROPIC_API_KEY optional — if set, Claude writes the
// summaries and reads the dictations; otherwise OpenAI does.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const OPENAI = Deno.env.get('OPENAI_API_KEY') ?? ''
const ANTHROPIC = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const TZ = 'America/Chicago'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()) // YYYY-MM-DD
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

async function transcribe(db: SupabaseClient, path: string, hint: string) {
  const { data: blob, error } = await db.storage.from('recordings').download(path)
  if (error || !blob) throw new Error('Could not read the recording: ' + (error?.message ?? 'missing'))
  if (blob.size > 25 * 1024 * 1024) throw new Error('Recording is over 25 MB (about 2 hours) — too long to transcribe in one piece.')
  const ext = path.split('.').pop() || 'm4a'
  const form = new FormData()
  form.append('file', new File([blob], `audio.${ext}`, { type: blob.type || 'audio/mp4' }))
  form.append('model', 'whisper-1')
  form.append('language', 'en')
  form.append('prompt', hint.slice(0, 800))
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${OPENAI}` }, body: form })
  if (!r.ok) throw new Error(`Transcription failed (${r.status}): ${(await r.text()).slice(0, 300)}`)
  return String((await r.json()).text ?? '').trim()
}

/** One LLM call. json=true → returns parsed JSON. */
async function llm(system: string, user: string, asJson: boolean): Promise<any> {
  let text = ''
  if (ANTHROPIC) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5', max_tokens: 2000, system: system + (asJson ? '\nReply with only the JSON object.' : ''), messages: [{ role: 'user', content: user }] }),
    })
    if (!r.ok) throw new Error(`Claude failed (${r.status}): ${(await r.text()).slice(0, 300)}`)
    text = (await r.json()).content?.map((c: { text?: string }) => c.text ?? '').join('') ?? ''
  } else {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: Deno.env.get('OPENAI_MODEL') ?? 'gpt-4.1-mini', temperature: 0.2, ...(asJson ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    })
    if (!r.ok) throw new Error(`OpenAI failed (${r.status}): ${(await r.text()).slice(0, 300)}`)
    text = (await r.json()).choices?.[0]?.message?.content ?? ''
  }
  if (!asJson) return text.trim()
  const m = text.match(/\{[\s\S]*\}/)
  return JSON.parse(m ? m[0] : text)
}

async function context(db: SupabaseClient) {
  const [{ data: projects }, { data: people }] = await Promise.all([
    db.from('projects').select('id, number, name').in('status', ['active', 'paused']).order('number', { ascending: false }).limit(200),
    db.from('profiles').select('id, full_name').in('role', ['admin', 'staff']),
  ])
  return { projects: (projects ?? []) as { id: string; number: string; name: string }[], people: (people ?? []) as { id: string; full_name: string | null }[] }
}

async function conversation(db: SupabaseClient, id: string) {
  const { data: rec } = await db.from('recordings').select('*').eq('id', id).single()
  if (!rec) return
  await db.from('recordings').update({ status: 'transcribing', error: null }).eq('id', id)
  try {
    const { data: proj } = rec.project_id ? await db.from('projects').select('number, name').eq('id', rec.project_id).single() : { data: null }
    const transcript = await transcribe(db, rec.path, `Architecture project meeting${proj ? ` about ${proj.name}` : ''}. Terms: elevation, schematic design, construction documents, permit, HOA, ARC, MEP, structural engineer.`)
    if (!transcript) throw new Error('No speech was found in the recording.')
    const summary = await llm(
      'You summarize recorded conversations between an architecture firm (Abaya Design & Studio) and its clients or consultants. ' +
      'Write plain text, no markdown symbols. Sections, each on its own line with a heading followed by a colon: Summary (2–4 sentences), Decisions, Action items (who → what, with dates if said), Open questions. ' +
      'Use "None" for an empty section. Be factual; do not invent anything that was not said.',
      `${proj ? `Project: ${proj.number} ${proj.name}\n` : ''}Transcript:\n${transcript}`, false)
    const when = new Date(rec.created_at).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const mins = rec.seconds ? Math.max(1, Math.round(rec.seconds / 60)) : null
    let update_id: string | null = null
    if (rec.project_id) {
      const { data: u } = await db.from('updates').insert({
        project_id: rec.project_id, author: rec.profile_id, kind: 'memo', title: `Conversation · ${when}${mins ? ` · ${mins} min` : ''}`,
        body: `${summary}\n\nTranscript:\n${transcript}`, items: [], photo_paths: [], visible_to_client: false, notify: 'none',
      }).select('id').single()
      update_id = u?.id ?? null
    }
    await db.from('recordings').update({ status: 'done', transcript, summary, update_id }).eq('id', id)
    await db.from('notifications').insert({ profile_id: rec.profile_id, kind: 'recording',
      text: `Conversation summary ready${proj ? ` · ${proj.number} ${proj.name}` : ''}`, href: rec.project_id ? `#/projects/${rec.project_id}` : '#/' })
  } catch (e) {
    await db.from('recordings').update({ status: 'error', error: (e as Error).message.slice(0, 500) }).eq('id', id)
    await db.from('notifications').insert({ profile_id: rec.profile_id, kind: 'recording', text: 'A recording could not be transcribed: ' + (e as Error).message.slice(0, 120), href: '#/' })
  }
}

async function dictate(db: SupabaseClient, path: string, me: { id: string; full_name: string | null }) {
  const ctx = await context(db)
  const transcript = await transcribe(db, path, 'Architecture firm. Projects: ' + ctx.projects.slice(0, 60).map((p) => `${p.number} ${p.name}`).join(', '))
  if (!transcript) return { transcript: '', proposal: null }
  const p = await llm(
    `You turn a short spoken instruction from ${me.full_name ?? 'a staff member'} at an architecture firm into ONE portal record. Today is ${today()} (${TZ}).\n` +
    'Decide the kind:\n- "task": something to do (optionally assigned to someone, with a due date).\n- "note": an observation or information to record on a project (site notes, client said…).\n- "time": the speaker reports time they worked ("two hours on…").\n' +
    'Return JSON: {"kind":"task"|"note"|"time","project_number":string|null,"title":string|null,"notes":string|null,"due_on":"YYYY-MM-DD"|null,"assignee":string|null,' +
    '"body":string|null,"minutes":number|null,"work_date":"YYYY-MM-DD"|null,"activity":string|null}.\n' +
    'title: short imperative task title. body: the note text, cleaned up. minutes: total minutes for time. work_date defaults to today. assignee: a name from the people list or null (null means the speaker). ' +
    'project_number must be one from the list (match by number or name) or null. Resolve relative dates (Friday, tomorrow) to dates.\n' +
    `Projects: ${ctx.projects.map((x) => `${x.number} = ${x.name}`).join('; ')}\nPeople: ${ctx.people.map((x) => x.full_name).filter(Boolean).join(', ')}`,
    transcript, true)
  const project = ctx.projects.find((x) => x.number === p.project_number) ?? null
  const who = p.assignee ? ctx.people.find((x) => (x.full_name ?? '').toLowerCase().includes(String(p.assignee).toLowerCase().split(' ')[0])) : null
  return {
    transcript,
    proposal: {
      kind: ['task', 'note', 'time'].includes(p.kind) ? p.kind : 'note',
      project_id: project?.id ?? null,
      title: p.title ?? null, notes: p.notes ?? null, due_on: p.due_on ?? null, assignee: who?.id ?? me.id,
      body: p.body ?? transcript, minutes: typeof p.minutes === 'number' ? Math.round(p.minutes) : null, work_date: p.work_date ?? today(), activity: p.activity ?? null,
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!OPENAI) return json({ error: 'Voice features need an OpenAI API key (Supabase secret OPENAI_API_KEY).' }, 503)
  const url = Deno.env.get('SUPABASE_URL')!
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user) return json({ error: 'Sign in first.' }, 401)
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: me } = await db.from('profiles').select('id, full_name, role').eq('id', user.id).single()
  if (!me || !['admin', 'staff'].includes(me.role)) return json({ error: 'Staff only.' }, 403)

  let body: { action?: string; id?: string; path?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  if (body.action === 'conversation') {
    // RLS as the caller: only their own recording (or an admin's view)
    const { data: rec } = await asUser.from('recordings').select('id').eq('id', body.id ?? '').maybeSingle()
    if (!rec) return json({ error: 'Recording not found' }, 404)
    EdgeRuntime.waitUntil(conversation(db, rec.id))
    return json({ ok: true, status: 'transcribing' })
  }
  if (body.action === 'dictate') {
    const path = String(body.path ?? '')
    if (!path.startsWith(`${user.id}/`)) return json({ error: 'Not your recording' }, 403)
    try {
      const out = await dictate(db, path, me)
      await db.storage.from('recordings').remove([path]) // dictation audio isn't kept
      return json(out)
    } catch (e) { return json({ error: (e as Error).message }, 502) }
  }
  return json({ error: 'Unknown action' }, 400)
})

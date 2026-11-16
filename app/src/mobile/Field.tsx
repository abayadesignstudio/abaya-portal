import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { must } from '../lib/useQuery'
import { iso, announceTimeChange } from '../lib/time'
import { voice, type FieldApi } from '../lib/field'
import type { TimerApi } from '../components/useTimer'
import Combobox, { sectorColor } from '../components/Combobox'
import { useStaff } from '../staff/HomeCalendars'

const keep = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const remember = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const mmss = (sec: number) => { const s = Math.max(0, Math.floor(sec)); const h = Math.floor(s / 3600); return `${h ? h + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}` }
const time = (t: string) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/** Seconds since an ISO time, ticking. */
export function useSince(since: string | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!since) return; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [since])
  return since ? (now - new Date(since).getTime()) / 1000 : 0
}

const projectOptions = (api: TimerApi, withOverhead = false) => api.projects.filter((p) => withOverhead || p.number !== 'OH')
  .map((p) => p.number === 'OH' ? { value: p.id, label: 'Overhead', search: 'OH overhead' } : { value: p.id, chip: p.number, color: sectorColor(p.sector), label: p.name })

// ---------------------------------------------------------------- pop-up from the running timer
export function TimerPop({ api, field, onEdit, onRecord, onTrip }: { api: TimerApi; field: FieldApi; onEdit: () => void; onRecord: () => void; onTrip: () => void }) {
  const recSec = useSince(field.rec.on && field.rec.purpose === 'conversation' ? field.rec.since : null)
  return <div className="mapp-menu mapp-pop" role="menu" aria-label="Timer options">
    <div className="mapp-add" role="group" aria-label="Add time">
      {[[15, '+15 min'], [30, '+30 min'], [60, '+1 hr']].map(([m, l]) =>
        <button key={m} type="button" disabled={api.busy} onClick={() => api.addTime(m as number)}>{l}</button>)}
    </div>
    <button role="menuitem" onClick={onTrip}>
      <IconCar />{field.gps.on ? <span>Stop trip <small className="muted">· {field.gps.miles.toFixed(1)} mi</small></span> : 'Track trip (GPS)'}
      {field.gps.on && <span className="mapp-live" aria-hidden="true" />}</button>
    <button role="menuitem" onClick={onRecord}>
      <IconRec on={field.rec.on} />{field.rec.on && field.rec.purpose === 'conversation' ? <span>Stop recording <small className="muted">· {mmss(recSec)}</small></span> : 'Record conversation'}</button>
    <button role="menuitem" onClick={onEdit}><IconPen />Edit or switch timer<span className="chev">›</span></button>
    {field.live && !field.live.ok && <p className="err" role="alert" style={{ margin: 0, padding: '10px 20px' }}>{field.live.reason}</p>}
    {(field.gps.error || field.rec.error) && <p className="err" role="alert" style={{ margin: 0, padding: '10px 20px' }}>{field.gps.error || field.rec.error}</p>}
  </div>
}

// ---------------------------------------------------------------- trip result
export function TripSheet({ field, api, me, onDone }: { field: FieldApi; api: TimerApi; me: string; onDone: () => void }) {
  const t = field.trip!
  const [pid, setPid] = useState(api.running?.project_id ?? '')
  const [miles, setMiles] = useState(String(t.miles))
  const [asExpense, setAsExpense] = useState(t.miles >= 0.5)
  const [rate, setRate] = useState(() => remember('abaya.mileRate', '0.70'))
  const [reimb, setReimb] = useState(true)
  const [note, setNote] = useState(t.stops.length > 0)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const mins = Math.round((new Date(t.ended).getTime() - new Date(t.started).getTime()) / 60000)
  const m = Number(miles) || 0, r = Number(rate) || 0
  const where = (s: { address: string; lat: number; lng: number }) => s.address || `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`
  const save = async () => {
    if ((asExpense || note) && !pid) return setErr('Choose the project.')
    setBusy(true); setErr('')
    try {
      let expense_id: string | null = null
      if (asExpense && m > 0) {
        keep('abaya.mileRate', rate)
        const e = must(await supabase.from('expenses').insert({ project_id: pid, created_by: me, spent_on: iso(new Date(t.started)), reimbursable: reimb,
          amount: Math.round(m * r * 100) / 100, description: `Mileage: ${m.toFixed(1)} mi × $${r.toFixed(3).replace(/0$/, '')}${t.stops.length ? ` · ${where(t.stops[t.stops.length - 1])}` : ''}` }).select('id').single()) as { id: string }
        expense_id = e.id
        window.dispatchEvent(new Event('abaya:expense-changed'))
      }
      must(await supabase.from('trips').insert({ profile_id: me, project_id: pid || null, started_at: t.started, ended_at: t.ended, miles: m, stops: t.stops, route: t.route, expense_id }))
      if (note && pid && t.stops.length) {
        must(await supabase.from('updates').insert({ project_id: pid, author: me, kind: 'memo', title: 'Site visit', items: [], photo_paths: [], visible_to_client: false, notify: 'none',
          body: t.stops.map((s) => `${time(s.arrived)}–${time(s.left)} at ${where(s)}`).join('\n') + `\n\n${m.toFixed(1)} miles tracked.` }))
      }
      field.clearTrip(); onDone()
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  return <div className="stack" style={{ gap: 12 }}>
    <h2 className="m-h2">Trip</h2>
    <p className="muted" style={{ margin: 0 }}>{time(t.started)} – {time(t.ended)} · {mins} min</p>
    <label className="sr" htmlFor="tr-m">Miles</label>
    <div className="row" style={{ gap: 8, alignItems: 'baseline' }}><input id="tr-m" className="input num m-big" inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value)} /><span style={{ fontSize: 18 }}>miles</span></div>
    {t.stops.length > 0 ? <div className="m-stops"><strong>Stops</strong>
      {t.stops.map((s, i) => <div key={i} className="m-stop"><span className="num">{time(s.arrived)}–{time(s.left)}</span><span>{where(s)}</span></div>)}</div>
      : <p className="muted" style={{ margin: 0 }}>No stops of 5 minutes or more.</p>}
    <Combobox id="tr-p" label="Project" placeholder="Search projects" value={pid} onChange={setPid} options={projectOptions(api, true)} />
    <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={asExpense} onChange={(e) => setAsExpense(e.target.checked)} style={{ width: 20, height: 20 }} /> Add a mileage expense</label>
    {asExpense && <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <label className="l" htmlFor="tr-r" style={{ margin: 0 }}>Rate $/mi</label>
      <input id="tr-r" className="input num" style={{ width: 100 }} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
      <b className="num">= ${(m * r).toFixed(2)}</b>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={reimb} onChange={(e) => setReimb(e.target.checked)} /> Reimburse me</label>
    </div>}
    {t.stops.length > 0 && <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} style={{ width: 20, height: 20 }} /> Post the site visit to the project notes (team only)</label>}
    {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
    <button type="button" className="btn m-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save trip'}</button>
    <button type="button" className="linkbtn" style={{ alignSelf: 'center', color: 'var(--red)' }} onClick={() => { if (window.confirm('Discard this trip?')) { field.clearTrip(); onDone() } }}>Discard</button>
  </div>
}

// ---------------------------------------------------------------- recording a conversation
export function RecordSheet({ field, api, me, onDone }: { field: FieldApi; api: TimerApi; me: string; onDone: () => void }) {
  const [pid, setPid] = useState(() => api.running?.project_id && api.proj?.number !== 'OH' ? api.running.project_id : '')
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const on = field.rec.on && field.rec.purpose === 'conversation'
  const sec = useSince(on ? field.rec.since : null)
  const pidRef = useRef(pid); pidRef.current = pid
  // once uploaded: file the recording and start transcription
  useEffect(() => {
    const u = field.uploaded
    if (!u || u.purpose !== 'conversation') return
    field.clearUploaded()
    ;(async () => {
      try {
        const r = must(await supabase.from('recordings').insert({ profile_id: me, project_id: pidRef.current || null, path: u.path, seconds: u.seconds, purpose: 'conversation' }).select('id').single()) as { id: string }
        await voice({ action: 'conversation', id: r.id })
        setMsg('Saved. The transcript and summary will be posted to the project notes — you’ll get a notification when it’s ready.')
      } catch (e) { setErr('Saved the audio, but: ' + (e as Error).message) }
    })()
  }, [field.uploaded]) // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => {
    if (!window.confirm('Let everyone in the conversation know it’s being recorded. Start recording?')) return
    setMsg(''); setErr(''); field.startRec('conversation')
  }
  return <div className="stack" style={{ gap: 14 }}>
    <h2 className="m-h2">Record conversation</h2>
    <Combobox id="rc-p" label="Project" placeholder="Search projects" value={pid} onChange={setPid} options={projectOptions(api)} />
    <button type="button" className={'m-mic' + (on ? ' on' : '')} onClick={() => (on ? field.stopRec() : start())} disabled={field.uploading} aria-label={on ? 'Stop recording' : 'Start recording'}>
      {on ? <span className="m-mic-stop" /> : <IconRec on={false} big />}
    </button>
    <p className="m-mic-cap">{field.uploading ? 'Uploading…' : on ? <><b className="num">{mmss(sec)}</b> · tap to stop</> : 'Tap to start'}</p>
    {on && field.native && <p className="muted" style={{ margin: 0, textAlign: 'center' }}>You can lock the phone — recording continues.</p>}
    {!field.native && on && <p className="muted" style={{ margin: 0, textAlign: 'center' }}>Keep this page open while recording.</p>}
    {msg && <p className="m-ok" role="status">{msg}</p>}
    {(err || field.rec.error) && <p className="err" role="alert" style={{ margin: 0 }}>{err || field.rec.error}</p>}
    {msg && <button type="button" className="btn m-primary" onClick={onDone}>Done</button>}
    <p className="muted" style={{ margin: 0, fontSize: 13 }}>Notes are team-only. Audio is kept in the portal’s private storage.</p>
  </div>
}

// ---------------------------------------------------------------- smart mic
type Proposal = { kind: 'task' | 'note' | 'time'; project_id: string | null; title: string | null; notes: string | null; due_on: string | null; assignee: string | null
  body: string | null; minutes: number | null; work_date: string; activity: string | null }

export function VoiceSheet({ field, api, me, autoStart, onDone }: { field: FieldApi; api: TimerApi; me: string; autoStart?: boolean; onDone: () => void }) {
  const staff = useStaff()
  const [stage, setStage] = useState<'idle' | 'thinking' | 'review' | 'saved'>('idle')
  const [heard, setHeard] = useState('')
  const [p, setP] = useState<Proposal | null>(null)
  const [hours, setHours] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const on = field.rec.on && field.rec.purpose === 'dictation'
  const sec = useSince(on ? field.rec.since : null)
  const started = useRef(false)
  useEffect(() => { if (autoStart && !started.current) { started.current = true; field.startRec('dictation') } }, [autoStart]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const u = field.uploaded
    if (!u || u.purpose !== 'dictation') return
    field.clearUploaded(); setStage('thinking')
    ;(async () => {
      try {
        const out = await voice({ action: 'dictate', path: u.path }) as { transcript: string; proposal: Proposal | null }
        setHeard(out.transcript)
        if (!out.proposal) { setErr('I didn’t catch anything. Try again.'); setStage('idle'); return }
        setP(out.proposal); setHours(out.proposal.minutes ? String(Math.round(out.proposal.minutes / 6) / 10) : ''); setStage('review')
      } catch (e) { setErr((e as Error).message); setStage('idle') }
    })()
  }, [field.uploaded]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof Proposal, v: unknown) => setP((o) => o && { ...o, [k]: v })
  const save = async () => {
    if (!p) return
    setBusy(true); setErr('')
    try {
      if (p.kind === 'task') {
        if (!p.title?.trim()) throw new Error('Give the task a title.')
        must(await supabase.from('tasks').insert({ title: p.title.trim(), notes: p.notes || null, assignee: p.assignee || me, created_by: me, due_on: p.due_on || null, project_id: p.project_id || null }))
        window.dispatchEvent(new CustomEvent('abaya:calendar-changed', { detail: 'task' }))
      } else if (p.kind === 'note') {
        if (!p.project_id) throw new Error('Choose the project for the note.')
        if (!p.body?.trim()) throw new Error('The note is empty.')
        must(await supabase.from('updates').insert({ project_id: p.project_id, author: me, kind: 'memo', title: null, body: p.body.trim(), items: [], photo_paths: [], visible_to_client: false, notify: 'none' }))
      } else {
        const minutes = Math.round((Number(hours) || 0) * 60)
        if (!p.project_id) throw new Error('Choose the project for the time.')
        if (!(minutes > 0)) throw new Error('Enter the hours.')
        const role = api.defaultRole(p.project_id) || null
        must(await supabase.from('time_entries').insert({ profile_id: me, project_id: p.project_id, work_date: p.work_date || iso(new Date()), minutes, role_label: role, activity: p.activity || null, note: heard || null }))
        await supabase.from('timesheet_rows').insert({ profile_id: me, project_id: p.project_id, phase_id: null, role_label: role, activity: p.activity || null })
        api.refreshRecent(); announceTimeChange()
      }
      setStage('saved')
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const again = () => { setP(null); setHeard(''); setErr(''); setStage('idle'); field.startRec('dictation') }

  if (stage === 'saved') return <div className="stack" style={{ gap: 14, textAlign: 'center' }}>
    <h2 className="m-h2">Saved</h2>
    <p className="m-ok">{p?.kind === 'task' ? 'Task added.' : p?.kind === 'note' ? 'Note posted to the project (team only).' : 'Time logged.'}</p>
    <button type="button" className="btn m-primary" onClick={again}>Say another</button>
    <button type="button" className="linkbtn" onClick={onDone}>Done</button>
  </div>

  if (stage === 'review' && p) return <div className="stack" style={{ gap: 12 }}>
    <h2 className="m-h2">Check and save</h2>
    <p className="m-heard">“{heard}”</p>
    <div className="m-chips" role="tablist" aria-label="Save as">
      {(['task', 'note', 'time'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={p.kind === k} className={p.kind === k ? 'on' : ''} onClick={() => set('kind', k)}>{k === 'task' ? 'Task' : k === 'note' ? 'Note' : 'Time'}</button>)}
    </div>
    <Combobox id="vc-p" label={p.kind === 'task' ? 'Project (optional)' : 'Project'} placeholder="Search projects" value={p.project_id ?? ''} onChange={(v) => set('project_id', v || null)} options={projectOptions(api, p.kind === 'time')} />
    {p.kind === 'task' && <>
      <div><label className="l" htmlFor="vc-t">Task</label><input id="vc-t" className="input" value={p.title ?? ''} onChange={(e) => set('title', e.target.value)} /></div>
      <div className="row" style={{ gap: 10 }}>
        <div style={{ flex: 1 }}><label className="l" htmlFor="vc-d">Due</label><input id="vc-d" type="date" className="input" value={p.due_on ?? ''} onChange={(e) => set('due_on', e.target.value || null)} /></div>
        <div style={{ flex: 1 }}><label className="l" htmlFor="vc-a">For</label>
          <select id="vc-a" className="input" value={p.assignee ?? me} onChange={(e) => set('assignee', e.target.value)}>
            {(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.id === me ? 'Me' : s.full_name}</option>)}</select></div>
      </div>
      <div><label className="l" htmlFor="vc-n">Details</label><textarea id="vc-n" className="input" rows={2} value={p.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></div>
    </>}
    {p.kind === 'note' && <div><label className="l" htmlFor="vc-b">Note (team only)</label><textarea id="vc-b" className="input" rows={5} value={p.body ?? ''} onChange={(e) => set('body', e.target.value)} /></div>}
    {p.kind === 'time' && <>
      <div className="row" style={{ gap: 10 }}>
        <div style={{ flex: 1 }}><label className="l" htmlFor="vc-h">Hours</label><input id="vc-h" className="input num" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
        <div style={{ flex: 1 }}><label className="l" htmlFor="vc-w">Date</label><input id="vc-w" type="date" className="input" value={p.work_date} onChange={(e) => set('work_date', e.target.value)} /></div>
      </div>
      <div><label className="l" htmlFor="vc-ac">Activity</label><input id="vc-ac" className="input" value={p.activity ?? ''} onChange={(e) => set('activity', e.target.value || null)} /></div>
    </>}
    {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
    <button type="button" className="btn m-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    <button type="button" className="linkbtn" style={{ alignSelf: 'center' }} onClick={again}>Say it again</button>
  </div>

  return <div className="stack" style={{ gap: 14 }}>
    <h2 className="m-h2">Voice</h2>
    <p className="muted" style={{ margin: 0 }}>Say a task, a project note, or time you worked — e.g. “Remind Micah to send the Smith elevations Friday”, “Note on 2411: client wants the porch deeper”, “Two hours on the Lee residence CDs.”</p>
    <button type="button" className={'m-mic' + (on ? ' on' : '')} disabled={field.uploading || stage === 'thinking'} onClick={() => (on ? field.stopRec() : (setErr(''), field.startRec('dictation')))} aria-label={on ? 'Stop and process' : 'Start talking'}>
      {on ? <span className="m-mic-stop" /> : <IconMic />}
    </button>
    <p className="m-mic-cap">{stage === 'thinking' || field.uploading ? 'Working it out…' : on ? <><b className="num">{mmss(sec)}</b> · tap when done</> : 'Tap and talk'}</p>
    {(err || field.rec.error) && <p className="err" role="alert" style={{ margin: 0 }}>{err || field.rec.error}</p>}
  </div>
}

// ---------------------------------------------------------------- icons
const S = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
export function IconMic() { return <svg {...S} width={44} height={44}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3M8 21h8" /></svg> }
export function IconMicSmall() { return <svg {...S}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3M8 21h8" /></svg> }
function IconCar() { return <svg {...S}><path d="M5 16l1.5-5a2 2 0 012-1.4h7a2 2 0 012 1.4L19 16M4 16h16v3H4zM7 19v1.5M17 19v1.5" /><circle cx="7.5" cy="16.5" r=".5" /><circle cx="16.5" cy="16.5" r=".5" /></svg> }
function IconPen() { return <svg {...S} width={20} height={20}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" /></svg> }
function IconRec({ on, big }: { on: boolean; big?: boolean }) {
  const n = big ? 44 : 24
  return <svg width={n} height={n} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r={on ? 4 : 5} fill="#d63c32" /></svg>
}

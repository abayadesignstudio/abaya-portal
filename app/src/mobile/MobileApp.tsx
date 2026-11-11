import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { supabase, money, phaseLabel } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { iso, mondayOf, announceTimeChange, TIME_CHANGED } from '../lib/time'
import { useTimer, type TimerApi, type TodayTask } from '../components/useTimer'
import { TimerPanel, ManualPanel, parseDuration } from '../components/Timer'
import Combobox, { sectorColor } from '../components/Combobox'
import Avatar from '../components/Avatar'
import { MonthCalendar, useStaff } from '../staff/HomeCalendars'
import '../staff/home.css'
import './mobile.css'

type Tab = 'calendar' | 'time' | 'expenses' | 'invoices'
type Sheet = null | 'add' | 'timeMenu' | 'timer' | 'manual' | 'expense' | 'note' | 'me' | { edit: Card } | { expense: Exp }
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const remember = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** Phone app: three tabs (Time, Expenses, Invoices) and a + button. Anything else opens as a page with a back button. */
export default function MobileApp({ onFullSite }: { onFullSite: () => void }) {
  const { profile, signOut } = useAuth()
  const me = profile!.id
  const loc = useLocation(), nav = useNavigate()
  const [tab, setTabRaw] = useState<Tab>(() => remember('abaya.m.tab', 'time') as Tab)
  const setTab = (t: Tab) => { setTabRaw(t); keep('abaya.m.tab', t); if (loc.pathname !== '/') nav('/') }
  const [sheet, setSheet] = useState<Sheet>(null)
  const api = useTimer(me)
  const detail = loc.pathname !== '/'
  useEffect(() => { document.body.style.overflow = sheet ? 'hidden' : ''; return () => { document.body.style.overflow = '' } }, [sheet])
  useEffect(() => { if (!sheet) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(null) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [sheet])
  const title = detail ? '' : tab === 'calendar' ? 'Calendar' : tab === 'time' ? 'Time' : tab === 'expenses' ? 'Expenses' : 'Invoices'
  const ini = profile?.initials || (profile?.full_name || profile?.email || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const full = sheet === 'timer' || sheet === 'manual' || sheet === 'expense' || sheet === 'note' || (typeof sheet === 'object' && sheet !== null)

  return (
    <div className="mapp">
      <header className="mapp-head">
        {detail ? <button type="button" className="mapp-back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}>‹ Back</button>
          : <button type="button" className="mapp-me" onClick={() => setSheet('me')} aria-label="Account"><Avatar url={profile?.avatar_url} initials={ini} size={36} /></button>}
        <h1>{title}</h1>
        <span style={{ width: 44 }} />
      </header>
      <main className="mapp-main">
        {detail ? <div className="mapp-detail"><Outlet /></div>
          : tab === 'calendar' ? <CalendarScreen me={me} admin={profile!.role === 'admin'} />
          : tab === 'time' ? <TimeScreen api={api} me={me} onEdit={(c) => setSheet({ edit: c })} />
          : tab === 'expenses' ? <ExpensesScreen me={me} onOpen={(e) => setSheet({ expense: e })} />
          : <InvoicesScreen me={me} />}
      </main>

      {!full && <nav className="mapp-tabs" aria-label="Sections">
        <div className="mapp-pill">
          {([['calendar', 'Calendar', IconCal], ['time', 'Time', IconClock], ['expenses', 'Expenses', IconReceipt], ['invoices', 'Invoices', IconDollar]] as const).map(([k, l, I]) =>
            <button key={k} type="button" className={!detail && tab === k ? 'on' : ''} aria-current={!detail && tab === k ? 'page' : undefined} onClick={() => setTab(k)}><span className="ic"><I /></span>{l}</button>)}
        </div>
        <button type="button" className="mapp-fab" aria-label={sheet ? 'Close' : 'Add'} aria-expanded={!!sheet} onClick={() => setSheet(sheet ? (sheet === 'timeMenu' ? 'add' : null) : 'add')}>
          {sheet === 'timeMenu' ? <IconBack /> : sheet ? <IconX /> : <IconPlus />}</button>
      </nav>}

      {(sheet === 'add' || sheet === 'timeMenu' || sheet === 'me') && <div className="mapp-scrim" onClick={() => setSheet(null)} />}
      {sheet === 'add' && <div className="mapp-menu" role="menu">
        <button role="menuitem" onClick={() => setSheet('timeMenu')}><IconClock />Time entry<span className="chev">›</span></button>
        <button role="menuitem" onClick={() => setSheet('expense')}><IconReceipt />Expense entry<span className="chev">›</span></button>
        <button role="menuitem" onClick={() => setSheet('note')}><IconNote />Add note<span className="chev">›</span></button>
      </div>}
      {sheet === 'timeMenu' && <div className="mapp-menu" role="menu">
        <button role="menuitem" onClick={() => setSheet('timer')}><IconTimer />{api.running ? 'Running timer' : 'Start timer'}</button>
        <button role="menuitem" onClick={() => setSheet('manual')}><IconPen />Manual entry</button>
      </div>}
      {sheet === 'me' && <div className="mapp-menu mapp-menu-top" role="menu">
        <div className="mapp-who"><strong>{profile?.full_name}</strong><span>{profile?.email}</span></div>
        <button role="menuitem" onClick={() => { setSheet(null); nav('/settings') }}>Settings</button>
        <button role="menuitem" onClick={() => { setSheet(null); onFullSite() }}>Full portal</button>
        <button role="menuitem" onClick={signOut}>Sign out</button>
      </div>}

      {full && <div className="mapp-sheet" role="dialog" aria-modal="true">
        <div className="mapp-sheet-head"><button type="button" className="mapp-back" onClick={() => setSheet(sheet === 'timer' || sheet === 'manual' ? 'timeMenu' : null)}>‹ {sheet === 'timer' || sheet === 'manual' ? 'Time' : 'Close'}</button></div>
        <div className="mapp-sheet-body">
          {sheet === 'timer' && <TimerPanel api={api} idPrefix="mt-" onDone={() => { setSheet(null); setTab('time') }} onCancel={() => setSheet(null)} />}
          {sheet === 'manual' && <ManualPanel api={api} me={me} idPrefix="mm-" onDone={() => { setSheet(null); setTab('time') }} onCancel={() => setSheet(null)} />}
          {sheet === 'expense' && <ExpenseForm me={me} api={api} onDone={() => { setSheet(null); setTab('expenses') }} />}
          {typeof sheet === 'object' && sheet && 'expense' in sheet && <ExpenseForm me={me} api={api} edit={sheet.expense} onDone={() => setSheet(null)} />}
          {sheet === 'note' && <NoteForm me={me} api={api} onDone={() => setSheet(null)} />}
          {typeof sheet === 'object' && sheet && 'edit' in sheet && <EditDay me={me} card={sheet.edit} onDone={() => setSheet(null)} />}
        </div>
      </div>}
    </div>
  )
}

// ---------------------------------------------------------------- Time
type Entry = { id: string; project_id: string; phase_id: string | null; role_label: string | null; activity: string | null; minutes: number; work_date: string; note: string | null
  projects: { number: string; name: string; sector: string | null } | null; phases: { code: string; name: string | null } | null }
type Card = { key: string; project_id: string; phase_id: string | null; role_label: string | null; activity: string | null; minutes: number; day: string
  projects: Entry['projects']; phases: Entry['phases'] }
const keyOf = (x: { project_id: string; phase_id: string | null; role_label: string | null; activity: string | null }) => `${x.project_id}|${x.phase_id}|${x.role_label}|${x.activity}`

function TimeScreen({ api, me, onEdit }: { api: TimerApi; me: string; onEdit: (c: Card) => void }) {
  const [day, setDay] = useState(iso(new Date()))
  const mon = mondayOf(new Date(day + 'T12:00:00'))
  const days = [...Array(7)].map((_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return iso(d) })
  const week = useLoad(async () => {
    const entries = must(await supabase.from('time_entries').select('id, project_id, phase_id, role_label, activity, minutes, work_date, note, projects(number, name, sector), phases(code, name)')
      .eq('profile_id', me).gte('work_date', days[0]).lte('work_date', days[6])) as unknown as Entry[]
    const rows = must(await supabase.from('timesheet_rows').select('project_id, phase_id, role_label, activity, projects(number, name, sector, status), phases(code, name)').eq('profile_id', me).order('created_at')) as unknown as (Omit<Card, 'key' | 'minutes' | 'day'> & { projects: { status: string } | null })[]
    return { entries, rows }
  }, [me, days[0]])
  useEffect(() => { const f = () => week.reload(); window.addEventListener(TIME_CHANGED, f); return () => window.removeEventListener(TIME_CHANGED, f) }, [week.reload]) // eslint-disable-line react-hooks/exhaustive-deps
  const perDay = (d: string) => (week.data?.entries ?? []).filter((e) => e.work_date === d).reduce((a, e) => a + e.minutes, 0)
  const weekMin = days.reduce((a, d) => a + perDay(d), 0)
  const cards = useMemo(() => {
    const m = new Map<string, Card>()
    for (const r of week.data?.rows ?? []) if (r.projects?.status !== 'complete') m.set(keyOf(r), { ...r, key: keyOf(r), minutes: 0, day })
    for (const e of (week.data?.entries ?? []).filter((x) => x.work_date === day)) {
      const k = keyOf(e); const c = m.get(k) ?? { key: k, project_id: e.project_id, phase_id: e.phase_id, role_label: e.role_label, activity: e.activity, minutes: 0, day, projects: e.projects, phases: e.phases }
      c.minutes += e.minutes; m.set(k, c)
    }
    return [...m.values()].sort((a, b) => b.minutes - a.minutes)
  }, [week.data, day])
  const r = api.running
  const isRunning = (c: Card) => !!r && keyOf({ project_id: r.project_id, phase_id: r.phase_id, role_label: r.role_label, activity: r.activity }) === c.key
  const today = iso(new Date())
  const shift = (n: number) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); setDay(iso(d)) }
  const label = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const play = async (c: Card) => {
    if (isRunning(c)) { await api.stop(); return }
    await api.pickUp({ ...c, last: '' } as TodayTask)
  }
  return <>
    <div className="m-daybar">
      <strong>{day === today ? `Today, ${label}` : new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
      <span className="row" style={{ gap: 4 }}>
        <label className="m-cal" aria-label="Pick a date"><IconCal /><input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
        <button type="button" className="m-ico" aria-label="Previous week" onClick={() => shift(-7)}>‹</button>
        <button type="button" className="m-ico" aria-label="Next week" onClick={() => shift(7)}>›</button>
      </span>
    </div>
    <div className="m-week" role="tablist" aria-label="Days">
      {days.map((d) => { const dt = new Date(d + 'T12:00:00'), m = perDay(d)
        return <button key={d} type="button" role="tab" aria-selected={d === day} className={d === day ? 'on' : ''} onClick={() => setDay(d)}>
          <span>{dt.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)}</span><b>{dt.getDate()}</b><small>{m ? `${(m / 60).toFixed(2).replace(/\.?0+$/, '')}h` : '–'}</small></button> })}
    </div>
    <p className="m-total">Hours this week: <b className="num">{hm(weekMin)}</b></p>
    {api.err && <p className="err" role="alert" style={{ margin: '0 16px' }}>{api.err}</p>}
    <div className="m-list">
      {cards.map((c) => { const on = isRunning(c), oh = c.projects?.number === 'OH'
        return <article key={c.key} className={'m-card' + (on ? ' run' : '')}>
          <div className="m-card-top">
            <span className="m-chip" style={{ background: oh ? '#6b7280' : sectorColor(c.projects?.sector) }}>{oh ? 'OH' : c.projects?.number}</span>
            <strong className="m-name">{oh ? 'Overhead' : c.projects?.name}</strong>
            {day === today && <button type="button" className={'m-play' + (on ? ' stop' : '')} disabled={api.busy} aria-label={on ? 'Stop and log' : `Start a timer on ${c.projects?.name}`} onClick={() => play(c)}>
              {on ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" rx="2" fill="currentColor" /></svg>
                : <svg width="12" height="13" viewBox="0 0 12 13" aria-hidden="true"><path d="M2 1l9 5.5L2 12z" fill="currentColor" /></svg>}</button>}
          </div>
          <div className="m-sub">{oh ? c.activity || 'Overhead' : [c.phases ? phaseLabel(c.phases) : null, c.activity].filter(Boolean).join(' · ') || '—'}</div>
          <div className="m-card-bot"><span className="muted">{c.role_label ?? ''}</span>
            <span className="row" style={{ gap: 10 }}><b className="num m-time">{on ? api.clock.slice(0, 5) : hm(c.minutes)}</b>
              <button type="button" className="m-ico m-edit" aria-label="Edit time" onClick={() => onEdit({ ...c, day })}><IconPen /></button></span></div>
        </article> })}
      {week.data && cards.length === 0 && <p className="muted m-empty">No time on this day. Tap + to add an entry.</p>}
    </div>
  </>
}

/** The entries behind one card on one day: change hours or notes, delete, or add more. */
function EditDay({ me, card, onDone }: { me: string; card: Card; onDone: () => void }) {
  const list = useLoad(async () => {
    let q = supabase.from('time_entries').select('id, minutes, note').eq('profile_id', me).eq('project_id', card.project_id).eq('work_date', card.day)
    q = card.phase_id ? q.eq('phase_id', card.phase_id) : q.is('phase_id', null)
    q = card.role_label ? q.eq('role_label', card.role_label) : q.is('role_label', null)
    q = card.activity ? q.eq('activity', card.activity) : q.is('activity', null)
    return must(await q.order('created_at')) as { id: string; minutes: number; note: string | null }[]
  }, [card.key, card.day])
  const [rows, setRows] = useState<{ id?: string; h: string; note: string; del?: boolean }[]>([])
  useEffect(() => { if (list.data) setRows(list.data.length ? list.data.map((x) => ({ id: x.id, h: (x.minutes / 60).toFixed(2).replace(/\.?0+$/, ''), note: x.note ?? '' })) : [{ h: '', note: '' }]) }, [list.data])
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const save = async () => {
    setErr(''); setBusy(true)
    try {
      for (const r of rows) {
        const min = parseDuration(r.h)
        if (r.id && (r.del || min === 0)) { must(await supabase.from('time_entries').delete().eq('id', r.id)); continue }
        if (r.del || min === 0) continue
        if (min > 24 * 60) throw new Error('An entry can’t be more than 24 hours.')
        if (r.id) must(await supabase.from('time_entries').update({ minutes: min, note: r.note.trim() || null }).eq('id', r.id))
        else must(await supabase.from('time_entries').insert({ profile_id: me, project_id: card.project_id, phase_id: card.phase_id, role_label: card.role_label, activity: card.activity, work_date: card.day, minutes: min, note: r.note.trim() || null }))
      }
      announceTimeChange(); onDone()
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const oh = card.projects?.number === 'OH'
  return <div className="stack" style={{ gap: 12 }}>
    <h2 className="m-h2">{oh ? 'Overhead' : `${card.projects?.number} · ${card.projects?.name}`}</h2>
    <p className="muted" style={{ margin: 0 }}>{[card.phases ? phaseLabel(card.phases) : null, card.activity, card.role_label].filter(Boolean).join(' · ')} · {new Date(card.day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
    {rows.map((r, i) => !r.del && <div key={r.id ?? 'n' + i} className="m-entry">
      <div className="row" style={{ gap: 8 }}>
        <label className="sr" htmlFor={`ed-h${i}`}>Hours</label>
        <input id={`ed-h${i}`} className="input num" inputMode="decimal" placeholder="Hours, e.g. 1.5" value={r.h} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, h: e.target.value } : x)))} style={{ flex: 1 }} />
        {r.id && <button type="button" className="btn small secondary" onClick={() => { if (window.confirm('Delete this entry? This can’t be undone once you save.')) setRows(rows.map((x, j) => (j === i ? { ...x, del: true } : x))) }}>Delete</button>}
      </div>
      <label className="sr" htmlFor={`ed-n${i}`}>Note</label>
      <input id={`ed-n${i}`} className="input" placeholder="Note (optional)" value={r.note} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
    </div>)}
    <button type="button" className="btn secondary" onClick={() => setRows([...rows, { h: '', note: '' }])}>+ Add time</button>
    {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
    <button type="button" className="btn m-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
  </div>
}

// ---------------------------------------------------------------- Expenses
type Exp = { id: string; project_id: string; description: string; amount: number; spent_on: string; reimbursable: boolean; receipt_path: string | null; invoice_id: string | null
  projects: { number: string; name: string; sector: string | null } | null }

function ExpensesScreen({ me, onOpen }: { me: string; onOpen: (e: Exp) => void }) {
  const d = useLoad(async () => must(await supabase.from('expenses').select('id, project_id, description, amount, spent_on, reimbursable, receipt_path, invoice_id, projects(number, name, sector)')
    .eq('created_by', me).or('planned.is.null,planned.eq.false').order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(150)) as unknown as Exp[], [me])
  useEffect(() => { const f = () => d.reload(); window.addEventListener('abaya:expense-changed', f); return () => window.removeEventListener('abaya:expense-changed', f) }, [d.reload]) // eslint-disable-line react-hooks/exhaustive-deps
  const groups = new Map<string, Exp[]>()
  for (const e of d.data ?? []) groups.set(e.spent_on, [...(groups.get(e.spent_on) ?? []), e])
  return <div className="m-list" style={{ paddingTop: 8 }}>
    {[...groups].map(([day, list]) => <section key={day}>
      <h2 className="m-date">{new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(day.slice(0, 4) !== String(new Date().getFullYear()) ? { year: 'numeric' } : {}) })}</h2>
      {list.map((e) => { const oh = e.projects?.number === 'OH'
        return <button key={e.id} type="button" className="m-card m-exp" onClick={() => onOpen(e)}>
          <span className="m-exp-l">
            {!oh && e.projects && <span className="m-card-top"><span className="m-chip" style={{ background: sectorColor(e.projects.sector) }}>{e.projects.number}</span><strong className="m-name">{e.projects.name}</strong></span>}
            <span className={oh ? 'm-name' : 'm-sub'} style={oh ? { fontWeight: 700 } : undefined}>{e.description}{e.receipt_path && <span aria-label="has receipt"> <IconClip /></span>}</span>
            <span className="muted" style={{ fontSize: 14 }}>{[e.reimbursable && 'Reimbursable', e.invoice_id && 'Billed'].filter(Boolean).join(' · ')}</span>
          </span>
          <b className="num m-amt">{money(e.amount)}</b>
        </button> })}
    </section>)}
    {d.data && d.data.length === 0 && <p className="muted m-empty">No expenses yet. Tap + to add one.</p>}
  </div>
}

function ExpenseForm({ me, api, edit, onDone }: { me: string; api: TimerApi; edit?: Exp; onDone: () => void }) {
  const [f, setF] = useState({ project_id: edit?.project_id ?? '', description: edit?.description ?? '', amount: edit ? String(edit.amount) : '', spent_on: edit?.spent_on ?? iso(new Date()), reimbursable: edit?.reimbursable ?? false })
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const locked = !!edit?.invoice_id
  const save = async () => {
    const amount = Number(f.amount.replace(/[$,\s]/g, ''))
    if (!f.project_id) return setErr('Choose a project (or Overhead).')
    if (!(amount > 0)) return setErr('Enter the amount.')
    if (!f.description.trim()) return setErr('Say what it was for.')
    setBusy(true); setErr('')
    try {
      let receipt_path: string | undefined
      if (file) {
        receipt_path = `${f.project_id}/${crypto.randomUUID()}.${(file.name.split('.').pop() || 'jpg').toLowerCase()}`
        must(await supabase.storage.from('receipts').upload(receipt_path, file, { contentType: file.type || undefined }))
      }
      const row = { project_id: f.project_id, description: f.description.trim(), amount, spent_on: f.spent_on, reimbursable: f.reimbursable, ...(receipt_path ? { receipt_path } : {}) }
      if (edit) must(await supabase.from('expenses').update(row).eq('id', edit.id))
      else must(await supabase.from('expenses').insert({ ...row, created_by: me }))
      window.dispatchEvent(new Event('abaya:expense-changed')); onDone()
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const del = async () => {
    if (!edit || !window.confirm('Delete this expense? This can’t be undone.')) return
    if (edit.receipt_path) await supabase.storage.from('receipts').remove([edit.receipt_path])
    const { error } = await supabase.from('expenses').delete().eq('id', edit.id)
    if (error) return setErr(error.message)
    window.dispatchEvent(new Event('abaya:expense-changed')); onDone()
  }
  const viewReceipt = async () => { if (!edit?.receipt_path) return; const { data } = await supabase.storage.from('receipts').createSignedUrl(edit.receipt_path, 300); if (data) window.open(data.signedUrl, '_blank') }
  return <div className="stack" style={{ gap: 12 }}>
    <h2 className="m-h2">{edit ? 'Expense' : 'New expense'}</h2>
    {locked && <p className="muted" style={{ margin: 0 }}>Already billed on an invoice, so it can’t be changed here.</p>}
    <label className="sr" htmlFor="me-a">Amount</label>
    <input id="me-a" className="input num m-big" inputMode="decimal" placeholder="$0.00" value={f.amount} disabled={locked} onChange={(e) => setF({ ...f, amount: e.target.value })} />
    <div><label className="l" htmlFor="me-d">Date</label><input id="me-d" type="date" className="input" value={f.spent_on} disabled={locked} onChange={(e) => setF({ ...f, spent_on: e.target.value })} /></div>
    <Combobox id="me-p" label="Project/overhead" placeholder="Search projects" value={f.project_id} disabled={locked} onChange={(x) => setF({ ...f, project_id: x })}
      options={api.projects.map((p) => p.number === 'OH' ? { value: p.id, label: 'Overhead', search: 'OH overhead' } : { value: p.id, chip: p.number, color: sectorColor(p.sector), label: p.name })} />
    <div><label className="l" htmlFor="me-s">What for</label><input id="me-s" className="input" placeholder="e.g. Meals & entertainment, prints, permit fee" value={f.description} disabled={locked} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
    <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={f.reimbursable} disabled={locked} onChange={(e) => setF({ ...f, reimbursable: e.target.checked })} style={{ width: 20, height: 20 }} /> I paid — reimburse me</label>
    {!locked && <label className="m-photo"><IconCamera /> {file ? file.name : edit?.receipt_path ? 'Replace receipt photo' : 'Add receipt photo'}
      <input type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>}
    {edit?.receipt_path && <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={viewReceipt}>View receipt</button>}
    {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
    {!locked && <button type="button" className="btn m-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}
    {edit && !locked && <button type="button" className="linkbtn" style={{ color: 'var(--red)', alignSelf: 'center' }} onClick={del}>Delete expense</button>}
  </div>
}

// ---------------------------------------------------------------- Invoices
type Inv = { id: string; number: string; status: string; issue_date: string | null; due_date: string | null; total: number; amount_paid: number; sent_at: string | null; reminders_sent: number
  project_id: string | null; projects: { number: string; name: string; sector: string | null } | null }
const FILTERS = [['open', 'Open'], ['late', 'Past due'], ['mine', 'My projects'], ['draft', 'Drafts'], ['paid', 'Paid']] as const

function InvoicesScreen({ me }: { me: string }) {
  const nav = useNavigate()
  const [f, setF] = useState<string>(() => remember('abaya.m.inv', 'open'))
  const d = useLoad(async () => {
    const inv = must(await supabase.from('invoices').select('id, number, status, issue_date, due_date, total, amount_paid, sent_at, reminders_sent, project_id, projects(number, name, sector)')
      .neq('status', 'void').order('issue_date', { ascending: false, nullsFirst: true }).limit(300)) as unknown as Inv[]
    const mine = must(await supabase.from('project_members').select('project_id').eq('profile_id', me)) as { project_id: string }[]
    return { inv, mine: new Set(mine.map((x) => x.project_id)) }
  }, [me])
  const today = iso(new Date())
  const late = (i: Inv) => i.status === 'open' && !!i.due_date && i.due_date < today
  const list = (d.data?.inv ?? []).filter((i) => f === 'open' ? i.status === 'open' : f === 'late' ? late(i) : f === 'mine' ? !!i.project_id && d.data!.mine.has(i.project_id) && i.status !== 'paid'
    : f === 'draft' ? i.status === 'draft' : i.status === 'paid')
  const sum = list.reduce((a, i) => a + (i.status === 'paid' ? i.total : i.total - i.amount_paid), 0)
  return <>
    <div className="m-chips" role="tablist" aria-label="Filter invoices">
      {FILTERS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={f === k} className={f === k ? 'on' : ''} onClick={() => { setF(k); keep('abaya.m.inv', k) }}>{l}</button>)}
    </div>
    {d.data && <p className="m-total">{list.length} invoice{list.length === 1 ? '' : 's'} · <b className="num">{money(sum)}</b>{f !== 'paid' && f !== 'draft' ? ' due' : ''}</p>}
    <div className="m-list">
      {list.map((i) => <button key={i.id} type="button" className="m-card m-inv" onClick={() => nav(`/invoices/${i.id}`)}>
        {i.projects && <span className="m-card-top"><span className="m-chip" style={{ background: sectorColor(i.projects.sector) }}>{i.projects.number}</span><strong className="m-name">{i.projects.name}</strong></span>}
        <span className="m-sub">Invoice #{i.number}</span>
        <span style={{ fontSize: 15 }}>{late(i) ? <span style={{ color: 'var(--red, #b42318)' }}>Past due</span> : <span>{i.status === 'open' ? 'Open' : i.status === 'paid' ? 'Paid' : i.status === 'draft' ? 'Draft' : i.status}</span>}
          {i.status !== 'draft' && i.status !== 'paid' && <span className="muted"> · {i.reminders_sent ? 'Reminder sent' : i.sent_at ? 'Invoice sent' : 'Not sent'}</span>}</span>
        {i.issue_date && <span className="muted" style={{ fontSize: 14 }}>Issued: {new Date(i.issue_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
        <b className="num m-amt" style={{ alignSelf: 'flex-end' }}>{money(i.status === 'paid' ? i.total : i.total - i.amount_paid)}</b>
      </button>)}
      {d.data && list.length === 0 && <p className="muted m-empty">Nothing here.</p>}
    </div>
  </>
}

// ---------------------------------------------------------------- Notes
function NoteForm({ me, api, onDone }: { me: string; api: TimerApi; onDone: () => void }) {
  const [pid, setPid] = useState(''); const [aud, setAud] = useState<'team' | 'client'>('team'); const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const projects = api.projects.filter((p) => p.number !== 'OH')
  const save = async () => {
    if (!pid) return setErr('Choose a project.')
    if (!body.trim() && !files.length) return setErr('Write a note or attach a photo.')
    setBusy(true); setErr('')
    try {
      const paths: string[] = []
      for (const file of files) {
        const path = `${pid}/${crypto.randomUUID()}.${(file.name.split('.').pop() || 'jpg').toLowerCase()}`
        must(await supabase.storage.from('photos').upload(path, file, { contentType: file.type || undefined })); paths.push(path)
      }
      must(await supabase.from('updates').insert({ project_id: pid, author: me, kind: !body.trim() && paths.length ? 'photos' : 'memo', title: null, body: body.trim() || null,
        items: [], photo_paths: paths, visible_to_client: aud === 'client', notify: 'none' }))
      onDone()
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  return <div className="stack" style={{ gap: 12 }}>
    <h2 className="m-h2">Project note</h2>
    <Combobox id="mn-p" label="Project" placeholder="Search projects" value={pid} onChange={setPid}
      options={projects.map((p) => ({ value: p.id, chip: p.number, color: sectorColor(p.sector), label: p.name }))} />
    <div><label className="l" htmlFor="mn-a">Audience</label>
      <select id="mn-a" className="input" value={aud} onChange={(e) => setAud(e.target.value as 'team' | 'client')}><option value="team">Internal team only</option><option value="client">Team and client (shows in the client portal)</option></select></div>
    <label className="sr" htmlFor="mn-b">Note</label>
    <textarea id="mn-b" className="input" rows={6} placeholder="Add note" value={body} onChange={(e) => setBody(e.target.value)} />
    <label className="m-photo"><IconCamera /> {files.length ? `${files.length} photo${files.length === 1 ? '' : 's'} attached` : 'Attach photos'}
      <input type="file" accept="image/*" multiple hidden onChange={(e) => setFiles([...(e.target.files ?? [])])} /></label>
    {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
    <button type="button" className="btn m-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save to project'}</button>
  </div>
}

// ---------------------------------------------------------------- calendar
/** Calendar: my days as stacked cards (meetings, tasks, milestones, deliverables), same data and filters as Home. */
function CalendarScreen({ me, admin }: { me: string; admin: boolean }) {
  const staff = useStaff()
  const projects = useLoad(async () => must(await supabase.from('projects').select('id, number, name, sector').in('status', ['active', 'paused']).order('number', { ascending: false })) as { id: string; number: string; name: string; sector: string | null }[])
  return <div className="mapp-cal"><MonthCalendar me={me} admin={admin} people={staff.data ?? []} projects={projects.data ?? []} phone /></div>
}

// ---------------------------------------------------------------- icons
const S = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
function IconClock() { return <svg {...S}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg> }
function IconTimer() { return <svg {...S}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M10 2h4" /></svg> }
function IconReceipt() { return <svg {...S}><path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" /><path d="M9 8h6M9 12h6M9 16h4" /></svg> }
function IconDollar() { return <svg {...S}><circle cx="12" cy="12" r="9" /><path d="M14.5 9c-.4-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.2-.6-2.6-1.6M12 6v1.5M12 16.5V18" /></svg> }
function IconNote() { return <svg {...S}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg> }
function IconPen() { return <svg {...S} width={20} height={20}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" /></svg> }
function IconPlus() { return <svg {...S} width={30} height={30} strokeWidth={2.2}><path d="M12 4v16M4 12h16" /></svg> }
function IconX() { return <svg {...S} width={28} height={28} strokeWidth={2.2}><path d="M6 6l12 12M18 6L6 18" /></svg> }
function IconBack() { return <svg {...S} width={28} height={28} strokeWidth={2.2}><path d="M19 12H5M11 6l-6 6 6 6" /></svg> }
function IconCal() { return <svg {...S}><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg> }
function IconClip() { return <svg {...S} width={16} height={16} style={{ verticalAlign: '-2px' }}><path d="M20 11l-8 8a5 5 0 01-7-7l8-8a3.5 3.5 0 015 5l-8 8a2 2 0 01-3-3l7-7" /></svg> }
function IconCamera() { return <svg {...S} width={20} height={20}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg> }

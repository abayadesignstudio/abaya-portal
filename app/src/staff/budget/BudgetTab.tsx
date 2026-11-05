import { useEffect, useMemo, useState } from 'react'
import { supabase, money, PHASE_NAME } from '../../lib/supabase'
import { useLoad, must } from '../../lib/useQuery'
import { sortPhases, fmtDate } from '../../lib/projectContent'
import RowMenu from '../../components/RowMenu'

type Phase = { id: string; code: string; fee: number; status: string; start_date: string | null; end_date: string | null }
export type Person = { id: string; full_name: string | null; email: string; initials: string | null; title: string | null; bill_rate: number | null }
export type Member = { profile_id: string; role_label: string | null; bill_rate: number | null }
export type Alloc = { phase_id: string; profile_id: string; hours: number }
export type Logged = { phase_id: string | null; profile_id: string; minutes: number }
type Consultant = { id: string; phase_id: string | null; name: string; discipline: string | null; fee: number; billed: number; markup_pct: number }
type Expense = { id: string; phase_id: string | null; description: string; amount: number; spent_on: string; reimbursable: boolean; planned: boolean; invoice_id: string | null }

export const ROLE_OPTIONS = ['Principal', 'Project Architect', 'Designer', 'Drafter', 'Intern']
const STATUS_DOT: Record<string, [string, string, string]> = {
  complete: ['#d0d5dd', '#d0d5dd', 'Complete'], in_progress: ['#039855', '#039855', 'In progress'],
  paused: ['#d92d20', '#d92d20', 'Paused'], not_started: ['#ffffff', '#98a2b3', 'Not started'],
}
const num = (v: string) => { const n = parseFloat(v.replace(/[$,%\s]/g, '')); return isFinite(n) ? n : 0 }
const round2 = (n: number) => Math.round(n * 100) / 100
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const nameOf = (p?: Person) => p?.full_name || p?.email || 'Someone'
const initialsOf = (p?: Person) => p?.initials || nameOf(p).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

export default function BudgetTab({ projectId, focus }: { projectId: string; focus?: string }) {
  const [sub, setSub] = useState<'firm' | 'consultants' | 'expenses'>('firm')
  const [only, setOnly] = useState(focus || 'all') // opened from a phase's "Assign team" on the Overview
  const [err, setErr] = useState('')
  const { data, error, reload } = useLoad(async () => {
    const phases = sortPhases(must(await supabase.from('phases').select('id, code, fee, status, start_date, end_date').eq('project_id', projectId)) as Phase[])
    const ids = phases.map((p) => p.id)
    const people = must(await supabase.from('profiles').select('id, full_name, email, initials, title, bill_rate').in('role', ['admin', 'staff']).order('full_name')) as Person[]
    const members = must(await supabase.from('project_members').select('profile_id, role_label, bill_rate').eq('project_id', projectId)) as Member[]
    const allocs = ids.length ? must(await supabase.from('phase_allocations').select('phase_id, profile_id, hours').in('phase_id', ids)) as Alloc[] : []
    const logged = must(await supabase.from('time_entries').select('phase_id, profile_id, minutes').eq('project_id', projectId)) as Logged[]
    const consultants = must(await supabase.from('project_consultants').select('id, phase_id, name, discipline, fee, billed, markup_pct').eq('project_id', projectId).order('created_at')) as Consultant[]
    const expenses = must(await supabase.from('expenses').select('id, phase_id, description, amount, spent_on, reimbursable, planned, invoice_id').eq('project_id', projectId).order('spent_on', { ascending: false })) as Expense[]
    return { phases, people, members, allocs, logged, consultants, expenses }
  }, [projectId])

  if (error) return <p className="err">{error}</p>
  if (!data) return <p>Loading budget…</p>
  const { phases, people, members, allocs, logged, consultants, expenses } = data
  const pById = Object.fromEntries(people.map((p) => [p.id, p]))
  const mById = Object.fromEntries(members.map((m) => [m.profile_id, m]))
  const rateOf = (pid: string) => Number(mById[pid]?.bill_rate ?? pById[pid]?.bill_rate ?? 0)
  const roleOf = (pid: string) => mById[pid]?.role_label ?? pById[pid]?.title ?? ''

  const serviceFees = phases.reduce((a, p) => a + Number(p.fee), 0)
  const consultantFees = consultants.reduce((a, c) => a + Number(c.fee) * (1 + Number(c.markup_pct) / 100), 0)
  const expenseTotal = expenses.filter((e) => e.reimbursable).reduce((a, e) => a + Number(e.amount), 0)
  const allocated = allocs.reduce((a, x) => a + Number(x.hours) * rateOf(x.profile_id), 0)
  const hoursBudgeted = allocs.reduce((a, x) => a + Number(x.hours), 0)
  const diff = serviceFees - allocated
  const pct = serviceFees ? Math.round(allocated / serviceFees * 100) : 0
  const overPhases = phases.filter((ph) => allocs.filter((a) => a.phase_id === ph.id).reduce((s, a) => s + Number(a.hours) * rateOf(a.profile_id), 0) > Number(ph.fee) + 0.5)

  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setErr(''); reload() } catch (e) { setErr(errText(e)) } }

  return (
    <div className="stack">
      <section className="card pb-stats" aria-label="Budget summary">
        <div><div className="muted" style={{ fontSize: 14 }}>Total project fees</div><div className="v num">{money(serviceFees + consultantFees + expenseTotal)}</div><div className="muted" style={{ fontSize: 12 }}><em>Services + consultants + expenses</em></div></div>
        <div><div className="muted" style={{ fontSize: 14 }}>Service fees</div><div className="v num">{money(serviceFees)}</div></div>
        <div><div className="muted" style={{ fontSize: 14 }}>{diff < -0.5 ? 'Over allocated' : diff > 0.5 ? 'Unallocated' : 'Fully allocated'}</div>
          <div className="v num" style={{ color: diff < -0.5 ? 'var(--red)' : diff > 0.5 ? 'var(--amber)' : 'var(--green)' }}>{money(Math.abs(diff))}</div></div>
        <div><div className="muted" style={{ fontSize: 14 }}>Allocated</div><div className="v num">{pct}%</div></div>
        <div><div className="muted" style={{ fontSize: 14 }}>Hours budgeted</div><div className="v num">{round2(hoursBudgeted)}</div>
          <div className="muted" style={{ fontSize: 12 }}><em>{round2(logged.reduce((a, l) => a + l.minutes / 60, 0))} logged so far</em></div></div>
      </section>

      <div className="pb-subtabs" role="tablist" aria-label="Budget sections">
        {([['firm', 'Firm services'], ['consultants', 'Consultant fees'], ['expenses', 'Direct expenses']] as const).map(([k, l]) =>
          <button key={k} role="tab" type="button" aria-selected={sub === k} onClick={() => setSub(k)}>{l}</button>)}
      </div>
      {err && <p className="err" role="alert">{err}</p>}

      {sub === 'firm' && (phases.length === 0 ? (
        <p className="card pad muted" style={{ textAlign: 'center' }}><em>No phases yet. Add phases and fees on the Overview tab, then assign the team here.</em></p>
      ) : (
        <div className="pb-body">
          <div className="stack" style={{ gap: 12 }}>
            <div><label className="l" htmlFor="pb-only">Show phase</label>
              <select id="pb-only" className="input" value={only} onChange={(e) => setOnly(e.target.value)}>
                <option value="all">All phases</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.code} · {PHASE_NAME[p.code]}</option>)}</select></div>
            <nav className="pb-phases" aria-label="Phases">
              <p style={{ margin: '4px 0 6px', fontWeight: 700 }}>Phases</p>
              <ul style={{ listStyle: 'none', margin: '0 0 0 7px', padding: 0, borderLeft: '2px dotted #c9c4b8' }}>
                {[{ id: 'all', code: '', name: 'All phases', dot: ['#02253d', '#02253d', ''] as [string, string, string] },
                  ...phases.map((p) => ({ id: p.id, code: p.code, name: PHASE_NAME[p.code], dot: STATUS_DOT[p.status] ?? STATUS_DOT.not_started }))].map((x) => (
                  <li key={x.id}><button type="button" aria-pressed={only === x.id} onClick={() => setOnly(x.id)} style={{ marginLeft: -8 }}>
                    <span className="pb-dot" aria-hidden="true" style={{ background: x.dot[0], border: `2px solid ${x.dot[1]}` }} />{x.name}
                    {x.dot[2] && <span className="sr"> ({x.dot[2]})</span>}</button></li>))}
              </ul>
              <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}><em>Gray = complete · green = in progress · red = paused · open = not started</em></p>
            </nav>
          </div>
          <div className="stack" style={{ minWidth: 0 }}>
            {overPhases.length > 0 && <div className="err" role="alert"><strong>Over budget.</strong> {overPhases.map((p) => p.code).join(', ')} {overPhases.length === 1 ? 'is' : 'are'} assigned more than the phase fee. Lower hours, move them to another phase, or raise the fee.</div>}
            {phases.filter((p) => only === 'all' || only === p.id).map((ph) => (
              <PhaseCard key={ph.id} phase={ph} people={people} allocs={allocs.filter((a) => a.phase_id === ph.id)} logged={logged.filter((l) => l.phase_id === ph.id)}
                rateOf={rateOf} roleOf={roleOf} pById={pById} projectId={projectId} hasMember={(pid) => !!mById[pid]} run={run} />))}
          </div>
        </div>))}

      {sub === 'consultants' && <ConsultantsPanel projectId={projectId} phases={phases} rows={consultants} run={run} />}
      {sub === 'expenses' && <ExpensesPanel projectId={projectId} phases={phases} rows={expenses} run={run} />}
    </div>
  )
}

/* ---------- one phase card with its assigned team ---------- */
function PhaseCard({ phase, people, allocs, logged, rateOf, roleOf, projectId, hasMember, run }: {
  phase: Phase; people: Person[]; allocs: Alloc[]; logged: Logged[]; rateOf: (id: string) => number; roleOf: (id: string) => string
  pById?: Record<string, Person>; projectId: string; hasMember: (id: string) => boolean; run: (fn: () => Promise<unknown>) => void
}) {
  const [open, setOpen] = useState(true)
  const fee = Number(phase.fee)
  const totalBudget = allocs.reduce((a, x) => a + Number(x.hours) * rateOf(x.profile_id), 0)
  const diff = fee - totalBudget
  const dot = STATUS_DOT[phase.status] ?? STATUS_DOT.not_started

  return (
    <section className="card pad stack" aria-label={`${phase.code} ${PHASE_NAME[phase.code]}`}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3 className="row" style={{ margin: 0, gap: 10, fontSize: 19 }}>
            <span className="tag" style={{ background: dot[0] === '#ffffff' ? '#fff' : dot[0], color: phase.status === 'in_progress' || phase.status === 'paused' ? '#fff' : '#344054', border: `1px solid ${dot[1]}` }}>{phase.code}</span>
            {PHASE_NAME[phase.code]}</h3>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>{phase.start_date ? fmtDate(phase.start_date) : 'No start date'} — {phase.end_date ? fmtDate(phase.end_date) : 'no end date'} · Fixed fee · <em>{dot[2]}</em></p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="num" style={{ fontSize: 19, fontWeight: 700 }}>{money(fee)}</div>
          <div className="num" style={{ fontSize: 14, fontWeight: 700, color: diff < -0.5 ? 'var(--red)' : diff > 0.5 ? 'var(--amber)' : 'var(--green)' }}>
            {diff < -0.5 ? `Over by ${money(-diff)}` : diff > 0.5 ? `${money(diff)} unassigned` : 'Fully assigned'}</div>
          <div className="muted num" style={{ fontSize: 13 }}>{fee ? Math.round(totalBudget / fee * 100) : 0}% of fee</div>
        </div>
      </div>
      <div><button type="button" className="linkbtn pb-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{allocs.length === 0 && <span className="pb-warn" aria-hidden="true">!</span>}{open ? 'Hide' : 'Show'} assigned team ({allocs.length}) <span aria-hidden="true">{open ? '⌃' : '⌄'}</span></button></div>
      {open && <TeamTable phase={phase} projectId={projectId} people={people} allocs={allocs} logged={logged} rateOf={rateOf} roleOf={roleOf} hasMember={hasMember} run={run} />}
    </section>
  )
}

/* ---------- a phase's team (shared by the Budget tab and the project Overview) ---------- */
const shortName = (p?: Person) => { const n = (p?.full_name || p?.email || 'Someone').trim().split(/\s+/); return n.length > 1 ? `${n[0]} ${n[n.length - 1][0]}.` : n[0] }
export function TeamTable({ phase, projectId, people, allocs, logged = [], rateOf, roleOf, hasMember, run }: {
  phase: { id: string; code: string; fee: number }; projectId: string; people: Person[]; allocs: Alloc[]; logged?: Logged[]
  rateOf: (id: string) => number; roleOf: (id: string) => string; hasMember: (id: string) => boolean; run: (fn: () => Promise<unknown>) => void
}) {
  const [editing, setEditing] = useState<string | null>(null) // whose role & rate is being edited
  const fee = Number(phase.fee)
  const pById = Object.fromEntries(people.map((p) => [p.id, p]))
  const totalBudget = allocs.reduce((a, x) => a + Number(x.hours) * rateOf(x.profile_id), 0)
  const totalHours = allocs.reduce((a, x) => a + Number(x.hours), 0)
  const available = people.filter((p) => !allocs.some((a) => a.profile_id === p.id))
  const loggedHrs = (pid: string) => round2(logged.filter((l) => l.profile_id === pid).reduce((a, l) => a + l.minutes / 60, 0))
  const ensureMember = async (pid: string) => {
    if (hasMember(pid)) return
    const p = pById[pid]
    must(await supabase.from('project_members').insert({ project_id: projectId, profile_id: pid, role_label: p?.title ?? null, bill_rate: p?.bill_rate ?? null }))
  }
  const setHours = (pid: string, hours: number) => run(async () => { must(await supabase.from('phase_allocations').upsert({ phase_id: phase.id, profile_id: pid, hours: Math.max(0, round2(hours)) })) })
  const assign = (pid: string) => { if (pid) run(async () => { await ensureMember(pid); must(await supabase.from('phase_allocations').upsert({ phase_id: phase.id, profile_id: pid, hours: 0 })) }) }
  const remove = (pid: string) => run(async () => { must(await supabase.from('phase_allocations').delete().eq('phase_id', phase.id).eq('profile_id', pid)) })
  const setMember = (pid: string, patch: Partial<Member>) => run(async () => {
    await ensureMember(pid)
    must(await supabase.from('project_members').update(patch).eq('project_id', projectId).eq('profile_id', pid))
  })
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="tt">
        <div className="tt-row head"><span>Team member</span><span>Role &amp; billable rate</span><span className="tt-pair plain"><span className="tt-r">Hours</span><span className="tt-r">Percent</span></span><span className="tt-r">Budget</span><span /></div>
        {allocs.length === 0 && <div className="tt-row"><span className="muted" style={{ gridColumn: '1 / -1' }}><em>No one assigned yet. Choose a team member below.</em></span></div>}
        {allocs.map((a) => {
          const rate = rateOf(a.profile_id); const hrs = Number(a.hours); const budget = hrs * rate
          const p = pById[a.profile_id]; const lg = loggedHrs(a.profile_id); const role = roleOf(a.profile_id)
          return (
            <div key={a.profile_id} className="tt-row">
              <span className="tt-who"><span className="pb-avatar tt-av" aria-hidden="true">{initialsOf(p)}</span>
                <span><span className="tt-name" title={nameOf(p)}>{shortName(p)}</span>{lg > 0 && <span className="tt-logged" style={{ color: hrs && lg > hrs ? 'var(--red)' : undefined }}>{lg} hrs logged</span>}</span></span>
              {editing === a.profile_id
                ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <label className="sr" htmlFor={`role-${phase.id}-${a.profile_id}`}>Role for {nameOf(p)}</label>
                    <select id={`role-${phase.id}-${a.profile_id}`} className="input" style={{ minHeight: 36, padding: '4px 8px' }} value={role} onChange={(e) => setMember(a.profile_id, { role_label: e.target.value || null })}>
                      <option value="">Role…</option>{Array.from(new Set([...ROLE_OPTIONS, role].filter(Boolean))).map((r) => <option key={r}>{r}</option>)}</select>
                    <NumIn label={`Billable rate for ${nameOf(p)}`} prefix="$" value={rate} width={92} onCommit={(v) => setMember(a.profile_id, { bill_rate: v })} />
                    <button type="button" className="linkbtn" onClick={() => setEditing(null)}>Done</button></span>
                : <span className="tt-role"><span className="tt-coin" aria-hidden="true">$</span>{role || 'No role'} – {money(rate)}
                    <button type="button" className="tt-edit" aria-label={`Edit role and rate for ${nameOf(p)}`} onClick={() => setEditing(a.profile_id)}>✎</button></span>}
              <span className="tt-pair">
                <NumIn label={`Hours for ${nameOf(p)} on ${phase.code}`} value={round2(hrs)} onCommit={(v) => setHours(a.profile_id, v)} />
                <NumIn label={`Percent of ${phase.code} fee for ${nameOf(p)}`} suffix="%" value={fee ? Math.round(budget / fee * 1000) / 10 : 0} disabled={!rate || !fee}
                  onCommit={(v) => { if (rate && fee) setHours(a.profile_id, v / 100 * fee / rate) }} />
              </span>
              <span className="num tt-r" style={{ fontWeight: 700 }}>{money(budget)}</span>
              <RowMenu label={`Options for ${nameOf(p)} on ${phase.code}`} items={[
                { label: 'Edit role & rate', onSelect: () => setEditing(a.profile_id) },
                'divider',
                { label: `Remove from ${phase.code}`, danger: true, onSelect: () => remove(a.profile_id) },
              ]} />
            </div>)
        })}
        <div className="tt-row total"><span>Total</span><span /><span className="tt-pair plain"><span className="num tt-r">{round2(totalHours)}</span><span className="num tt-r">{fee ? Math.round(totalBudget / fee * 100) : 0}%</span></span>
          <span className="num tt-r">{money(totalBudget)}</span><span /></div>
      </div>
      <div>
        <label className="sr" htmlFor={`assign-${phase.id}`}>Assign team member to {phase.code}</label>
        <select id={`assign-${phase.id}`} className="input" style={{ width: 260 }} value="" onChange={(e) => assign(e.target.value)} disabled={available.length === 0}>
          <option value="">{available.length ? 'Assign team member' : 'Everyone is assigned'}</option>{available.map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}</select>
      </div>
    </div>
  )
}

/* ---------- number input that commits on blur / Enter ---------- */
function NumIn({ value, onCommit, label, prefix, suffix, width, disabled }: { value: number; onCommit: (v: number) => void; label: string; prefix?: string; suffix?: string; width?: number; disabled?: boolean }) {
  const [t, setT] = useState(String(value))
  useEffect(() => setT(String(value)), [value])
  return (
    <span style={{ position: 'relative', display: 'block', width }}>
      {prefix && <span aria-hidden="true" style={{ position: 'absolute', left: 9, top: 10, color: 'var(--muted)' }}>{prefix}</span>}
      <input aria-label={label} className="pb-in" inputMode="decimal" disabled={disabled} value={t}
        style={{ paddingLeft: prefix ? 20 : undefined, paddingRight: suffix ? 24 : undefined }}
        onChange={(e) => setT(e.target.value)} onFocus={(e) => e.target.select()}
        onBlur={() => { const v = num(t); if (round2(v) !== round2(value)) onCommit(v); else setT(String(value)) }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      {suffix && <span aria-hidden="true" style={{ position: 'absolute', right: 9, top: 10, color: 'var(--muted)' }}>{suffix}</span>}
    </span>)
}

/* ---------- consultants ---------- */
function ConsultantsPanel({ projectId, phases, rows, run }: { projectId: string; phases: Phase[]; rows: Consultant[]; run: (fn: () => Promise<unknown>) => void }) {
  const [f, setF] = useState({ name: '', discipline: '', phase_id: '', fee: '', markup_pct: '0' })
  const total = rows.reduce((a, c) => a + Number(c.fee), 0)
  const withMarkup = rows.reduce((a, c) => a + Number(c.fee) * (1 + Number(c.markup_pct) / 100), 0)
  const billed = rows.reduce((a, c) => a + Number(c.billed), 0)
  const add = () => { if (!f.name.trim()) return; run(async () => {
    must(await supabase.from('project_consultants').insert({ project_id: projectId, name: f.name.trim(), discipline: f.discipline || null, phase_id: f.phase_id || null, fee: num(f.fee), markup_pct: num(f.markup_pct) }))
    setF({ name: '', discipline: '', phase_id: '', fee: '', markup_pct: '0' }) }) }
  const upd = (id: string, patch: Partial<Consultant>) => run(async () => { must(await supabase.from('project_consultants').update(patch).eq('id', id)) })
  return (
    <section className="card pad stack">
      <div className="row between"><h3 style={{ margin: 0 }}>Consultant fees</h3><strong className="num">{money(withMarkup)}</strong></div>
      <div style={{ overflowX: 'auto' }}><table className="table" style={{ minWidth: 820 }}>
        <thead><tr><th>Consultant</th><th>Discipline</th><th>Phase</th><th className="r">Fee</th><th className="r">Markup</th><th className="r">Billed to client</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="muted"><em>No consultants on this project.</em></td></tr>}
          {rows.map((c) => <tr key={c.id}>
            <td><strong>{c.name}</strong></td><td>{c.discipline ?? '—'}</td>
            <td><label className="sr" htmlFor={`cph-${c.id}`}>Phase</label><select id={`cph-${c.id}`} className="input" value={c.phase_id ?? ''} onChange={(e) => upd(c.id, { phase_id: e.target.value || null })}><option value="">—</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></td>
            <td className="r"><NumIn label={`Fee for ${c.name}`} prefix="$" width={120} value={Number(c.fee)} onCommit={(v) => upd(c.id, { fee: v })} /></td>
            <td className="r"><NumIn label={`Markup for ${c.name}`} suffix="%" width={80} value={Number(c.markup_pct)} onCommit={(v) => upd(c.id, { markup_pct: v })} /></td>
            <td className="r"><NumIn label={`Billed for ${c.name}`} prefix="$" width={120} value={Number(c.billed)} onCommit={(v) => upd(c.id, { billed: v })} /></td>
            <td><button type="button" className="linkbtn" style={{ color: 'var(--muted)', fontSize: 20 }} aria-label={`Remove ${c.name}`} onClick={() => run(async () => { must(await supabase.from('project_consultants').delete().eq('id', c.id)) })}>×</button></td>
          </tr>)}
          {rows.length > 0 && <tr style={{ fontWeight: 700 }}><td colSpan={3}>Total</td><td className="r num">{money(total)}</td><td className="r num">{money(withMarkup - total)}</td><td className="r num">{money(billed)}</td><td /></tr>}
        </tbody></table></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px,1.4fr) minmax(140px,1fr) 120px 130px 100px auto', gap: 8, alignItems: 'end' }}>
        <div><label className="l" htmlFor="cn-n">Consultant</label><input id="cn-n" className="input" placeholder="e.g. MEP engineer" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="l" htmlFor="cn-d">Discipline</label><input id="cn-d" className="input" value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value })} /></div>
        <div><label className="l" htmlFor="cn-p">Phase</label><select id="cn-p" className="input" value={f.phase_id} onChange={(e) => setF({ ...f, phase_id: e.target.value })}><option value="">—</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></div>
        <div><label className="l" htmlFor="cn-f">Fee ($)</label><input id="cn-f" className="input num" inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /></div>
        <div><label className="l" htmlFor="cn-m">Markup %</label><input id="cn-m" className="input num" inputMode="decimal" value={f.markup_pct} onChange={(e) => setF({ ...f, markup_pct: e.target.value })} /></div>
        <button type="button" className="btn" onClick={add} disabled={!f.name.trim()}>Add</button>
      </div>
    </section>)
}

/* ---------- direct expenses ---------- */
function ExpensesPanel({ projectId, phases, rows, run }: { projectId: string; phases: Phase[]; rows: Expense[]; run: (fn: () => Promise<unknown>) => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ description: '', phase_id: '', amount: '', spent_on: today, reimbursable: true, planned: false })
  const planned = useMemo(() => rows.filter((r) => r.planned), [rows])
  const actual = useMemo(() => rows.filter((r) => !r.planned), [rows])
  const sum = (xs: Expense[]) => xs.reduce((a, e) => a + Number(e.amount), 0)
  const add = () => { if (!f.description.trim() || !num(f.amount)) return; run(async () => {
    must(await supabase.from('expenses').insert({ project_id: projectId, description: f.description.trim(), phase_id: f.phase_id || null, amount: num(f.amount), spent_on: f.spent_on || today, reimbursable: f.reimbursable, planned: f.planned }))
    setF({ ...f, description: '', amount: '' }) }) }
  const list = (title: string, xs: Expense[]) => (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row between"><h4 style={{ margin: 0 }}>{title}</h4><strong className="num">{money(sum(xs))}</strong></div>
      <div style={{ overflowX: 'auto' }}><table className="table" style={{ minWidth: 720 }}>
        <thead><tr><th>Description</th><th>Phase</th><th>Date</th><th>Reimbursable</th><th>Invoiced</th><th className="r">Amount</th><th /></tr></thead>
        <tbody>
          {xs.length === 0 && <tr><td colSpan={7} className="muted"><em>None.</em></td></tr>}
          {xs.map((e) => <tr key={e.id}>
            <td>{e.description}</td><td>{phases.find((p) => p.id === e.phase_id)?.code ?? '—'}</td><td className="num">{fmtDate(e.spent_on)}</td>
            <td><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={e.reimbursable} onChange={(x) => run(async () => { must(await supabase.from('expenses').update({ reimbursable: x.target.checked }).eq('id', e.id)) })} style={{ width: 18, height: 18 }} /><span className="sr">Reimbursable</span>{e.reimbursable ? 'Yes' : 'No'}</label></td>
            <td>{e.invoice_id ? 'Yes' : '—'}</td>
            <td className="r num" style={{ fontWeight: 700 }}>{money(e.amount)}</td>
            <td>{!e.invoice_id && <button type="button" className="linkbtn" style={{ color: 'var(--muted)', fontSize: 20 }} aria-label={`Remove ${e.description}`} onClick={() => run(async () => { must(await supabase.from('expenses').delete().eq('id', e.id)) })}>×</button>}</td>
          </tr>)}
        </tbody></table></div>
    </div>)
  return (
    <section className="card pad stack">
      <h3 style={{ margin: 0 }}>Direct expenses</h3>
      {list('Budgeted (planned)', planned)}
      {list('Incurred', actual)}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,2fr) 110px 150px 120px auto auto auto', gap: 8, alignItems: 'end' }}>
        <div><label className="l" htmlFor="ex-d">Description</label><input id="ex-d" className="input" placeholder="e.g. Printing — 24×36, 12 sheets" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div><label className="l" htmlFor="ex-p">Phase</label><select id="ex-p" className="input" value={f.phase_id} onChange={(e) => setF({ ...f, phase_id: e.target.value })}><option value="">—</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></div>
        <div><label className="l" htmlFor="ex-dt">Date</label><input id="ex-dt" type="date" className="input" value={f.spent_on} onChange={(e) => setF({ ...f, spent_on: e.target.value })} /></div>
        <div><label className="l" htmlFor="ex-a">Amount ($)</label><input id="ex-a" className="input num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <label className="row" style={{ gap: 6, minHeight: 44 }}><input type="checkbox" checked={f.reimbursable} onChange={(e) => setF({ ...f, reimbursable: e.target.checked })} style={{ width: 18, height: 18 }} />Reimbursable</label>
        <label className="row" style={{ gap: 6, minHeight: 44 }}><input type="checkbox" checked={f.planned} onChange={(e) => setF({ ...f, planned: e.target.checked })} style={{ width: 18, height: 18 }} />Budget only</label>
        <button type="button" className="btn" onClick={add} disabled={!f.description.trim() || !num(f.amount)}>Add</button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}><em>Reimbursable expenses count toward the total project fees and appear in the invoice builder with the 10% service fee (Agreement §8.2). “Budget only” lines are estimates and are never invoiced.</em></p>
    </section>)
}

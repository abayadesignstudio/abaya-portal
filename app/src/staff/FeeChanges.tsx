import ConsultantFee from '../components/ConsultantFee'
import { useEffect, useState } from 'react'
import { supabase, money, PHASE_NAME } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import RowMenu from '../components/RowMenu'

/** Fee changes (amendments). Once the agreement is signed, a project's fees only change through one of these:
 *  staff draft it step by step, send it, and it takes effect when the client signs it in the portal. */

export type FcPhase = { id: string; code: string; name: string | null; fee: number; billing: string | null; parent_phase_id: string | null }
export type FcLine = { phase_id: string | null; code: string; name: string | null; parent_phase_id: string | null; billing: 'fixed' | 'hourly'; from: number; to: number }
type FeeChange = { id: string; number: number; title: string; reason: string; lines: FcLine[]; total_from: number; total_to: number; status: 'draft' | 'sent' | 'signed' | 'void'; sent_at: string | null; signed_at: string | null; created_at: string }
type Sig = { fee_change_id: string; signer_name: string; signer_title: string | null; signed_at: string; signature: string; ip: string | null }

export const lineLabel = (l: { code: string; name: string | null }) => l.code === 'AS' ? `Additional service: ${l.name ?? ''}` : l.code === 'CU' ? (l.name ?? 'Custom phase') : `${l.code} · ${PHASE_NAME[l.code] ?? l.code}`
const STATUS: Record<FeeChange['status'], string> = { draft: 'Draft', sent: 'Waiting for client', signed: 'Signed', void: 'Void' }
const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export default function FeeChanges({ projectId, phases, signed, onChanged }: { projectId: string; phases: FcPhase[]; signed: boolean; onChanged: () => void }) {
  const list = useLoad(async () => must(await supabase.from('fee_changes').select('id, number, title, reason, lines, total_from, total_to, status, sent_at, signed_at, created_at')
    .eq('project_id', projectId).order('number', { ascending: false })) as FeeChange[], [projectId])
  const sigs = useLoad(async () => {
    const ids = (list.data ?? []).filter((f) => f.status === 'signed').map((f) => f.id)
    return ids.length ? must(await supabase.from('fee_change_signatures').select('fee_change_id, signer_name, signer_title, signed_at, signature, ip').in('fee_change_id', ids)) as Sig[] : []
  }, [list.data])
  const [edit, setEdit] = useState<FeeChange | 'new' | null>(null)
  const [err, setErr] = useState(''); const [note, setNote] = useState('')
  const reload = () => { list.reload(); onChanged() }
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>, done: string) => { const { error } = await fn(); if (error) { setErr(error.message); setNote('') } else { setErr(''); setNote(done); reload() } }
  const items = list.data ?? []
  if (!signed && items.length === 0) return null
  return <section className="card pad stack" aria-labelledby="fc-h" style={{ gap: 10 }}>
    <div className="row between">
      <h2 id="fc-h" style={{ fontSize: 17 }}>Fee changes</h2>
      {signed && <button type="button" className="btn small" onClick={() => setEdit('new')}>Change fee…</button>}
    </div>
    <p className="muted" style={{ margin: 0, fontSize: 13 }}>The signed agreement locks this project’s fees. To change a phase fee, an hourly not-to-exceed or add an additional service, draft a fee change and send it: it takes effect only when the client signs it in their portal.</p>
    {note && <p className="ok" role="status" style={{ margin: 0 }}>{note}</p>}
    {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
    {items.length > 0 && <ul className="fc-list">{items.map((f) => {
      const sig = sigs.data?.find((x) => x.fee_change_id === f.id)
      const delta = (f.lines ?? []).reduce((a, l) => a + Number(l.to) - Number(l.from), 0)
      return <li key={f.id} className="fc-item">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <strong>{f.title}</strong> <span className={'pill fc-' + f.status}>{STATUS[f.status]}</span>
            <div className="muted" style={{ fontSize: 13 }}>{f.status === 'signed' ? `Signed ${fmt(f.signed_at)}${sig ? ` by ${sig.signer_name}${sig.signer_title ? `, ${sig.signer_title}` : ''}` : ''}` : f.status === 'sent' ? `Sent ${fmt(f.sent_at)}` : `Drafted ${fmt(f.created_at)}`}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <strong className="num" style={{ color: delta < 0 ? '#b42318' : undefined }}>{delta >= 0 ? '+' : '−'}{money(Math.abs(delta))}</strong>
            {(f.status === 'draft' || f.status === 'sent') && <RowMenu label={`${f.title} actions`} items={[
              ...(f.status === 'draft' ? [
                { label: 'Edit…', onSelect: () => setEdit(f) },
                { label: 'Send to client for signature', onSelect: () => act(() => supabase.rpc('publish_fee_change', { p_id: f.id, p_notify: true }), `${f.title} sent. The client can sign it in their portal.`) },
                { label: 'Send without notifying', onSelect: () => act(() => supabase.rpc('publish_fee_change', { p_id: f.id, p_notify: false }), `${f.title} is in the client’s portal (no notice sent).`) },
                'divider' as const,
                { label: 'Delete draft…', danger: true, onSelect: () => { if (window.confirm(`Delete ${f.title}?`)) act(() => supabase.from('fee_changes').delete().eq('id', f.id), 'Deleted.') } },
              ] : []),
              ...(f.status === 'sent' ? [{ label: 'Withdraw (back to draft)', onSelect: () => act(() => supabase.rpc('unpublish_fee_change', { p_id: f.id }), `${f.title} withdrawn. It’s a draft again.`) }] : []),
            ]} />}
          </div>
        </div>
        {f.reason && <p style={{ margin: '4px 0 0', fontSize: 14, whiteSpace: 'pre-line' }}>{f.reason}</p>}
        <table className="table fc-lines"><tbody>{(f.lines ?? []).map((l, i) => <tr key={i}>
          <td>{lineLabel(l)}{l.billing === 'hourly' && <span className="muted"> · hourly, not to exceed</span>}</td>
          <td className="r num muted">{l.phase_id ? money(l.from) : 'new'}</td><td className="r" aria-hidden="true">→</td><td className="r num"><strong>{money(l.to)}</strong></td></tr>)}</tbody></table>
        {sig && <div className="fc-sig"><img src={sig.signature} alt={`Signature of ${sig.signer_name}`} /><span className="muted" style={{ fontSize: 12 }}>{new Date(sig.signed_at).toLocaleString('en-US')}{sig.ip ? ` · IP ${sig.ip}` : ''}</span></div>}
      </li>
    })}</ul>}
    {edit && <FeeChangeWizard projectId={projectId} phases={phases} existing={edit === 'new' ? null : edit} nextNumber={(items[0]?.number ?? 0) + 1}
      onClose={() => setEdit(null)} onSaved={(msg) => { setEdit(null); setErr(''); setNote(msg); reload() }} />}
  </section>
}

type Row = { cons?: boolean; key: string; phase_id: string | null; code: string; name: string; parent_phase_id: string | null; billing: 'fixed' | 'hourly'; from: number; to: string }

/** Step by step: 1 what changes · 2 why · 3 review and send. */
function FeeChangeWizard({ projectId, phases, existing, nextNumber, onClose, onSaved }: { projectId: string; phases: FcPhase[]; existing: FeeChange | null; nextNumber: number; onClose: () => void; onSaved: (msg: string) => void }) {
  const [step, setStep] = useState(1)
  const start = (): Row[] => {
    const rows: Row[] = phases.map((p) => { const l = existing?.lines.find((x) => x.phase_id === p.id)
      return { key: p.id, phase_id: p.id, code: p.code, name: p.name ?? '', parent_phase_id: p.parent_phase_id, billing: (l?.billing ?? p.billing ?? 'fixed') as 'fixed' | 'hourly', from: Number(p.fee), to: l ? String(l.to) : String(Number(p.fee)) } })
    for (const l of existing?.lines.filter((x) => !x.phase_id) ?? []) rows.push({ key: Math.random().toString(36).slice(2), phase_id: null, code: l.code, name: l.name ?? '', parent_phase_id: l.parent_phase_id, billing: l.billing, from: 0, to: String(l.to) })
    return rows
  }
  const [rows, setRows] = useState<Row[]>(start)
  const [title, setTitle] = useState(existing?.title ?? `Fee change ${nextNumber}`)
  const [reason, setReason] = useState(existing?.reason ?? '')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const num = (s: string) => { const n = parseFloat(String(s).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN }
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const mains = phases.filter((p) => p.code !== 'AS')
  const changed = rows.filter((r) => !r.phase_id ? num(r.to) > 0 || r.name.trim() : Math.abs(num(r.to) - r.from) >= 0.005 || r.billing !== (phases.find((p) => p.id === r.phase_id)?.billing ?? 'fixed'))
  const lines: FcLine[] = changed.map((r) => ({ phase_id: r.phase_id, code: r.code, name: r.code === 'AS' || r.code === 'CU' ? r.name.trim() || null : null, parent_phase_id: r.parent_phase_id, billing: r.billing, from: r.from, to: num(r.to) }))
  const from = phases.reduce((a, p) => a + Number(p.fee), 0)
  const to = from + lines.reduce((a, l) => a + (Number.isFinite(l.to) ? l.to : 0) - l.from, 0)
  const check1 = () => {
    if (rows.some((r) => !Number.isFinite(num(r.to)) || num(r.to) < 0)) return 'Every fee must be a number, 0 or more.'
    if (rows.some((r) => !r.phase_id && !r.name.trim() && num(r.to) > 0)) return 'Name each new additional service.'
    if (!lines.length) return 'Change at least one fee, or add an additional service.'
    return ''
  }
  const next = () => { const e = step === 1 ? check1() : step === 2 && !reason.trim() ? 'Say why the fee is changing; the client sees this.' : ''; setErr(e); if (!e) setStep(step + 1) }
  const save = async (send: boolean) => {
    setBusy(true); setErr('')
    const row = { project_id: projectId, title: title.trim() || `Fee change ${nextNumber}`, reason: reason.trim(), lines, total_from: from, total_to: to }
    let id = existing?.id
    if (id) { const { error } = await supabase.from('fee_changes').update(row).eq('id', id); if (error) { setBusy(false); return setErr(error.message) } }
    else { const { data, error } = await supabase.from('fee_changes').insert({ ...row, number: nextNumber }).select('id').single(); if (error) { setBusy(false); return setErr(error.message) } id = (data as { id: string }).id }
    if (send) { const { error } = await supabase.rpc('publish_fee_change', { p_id: id, p_notify: true }); if (error) { setBusy(false); return setErr(`Saved as a draft, but not sent: ${error.message}`) } }
    setBusy(false)
    onSaved(send ? `${row.title} sent. It takes effect when the client signs it in their portal.` : `${row.title} saved as a draft.`)
  }
  return <div className="fc-modal" role="dialog" aria-modal="true" aria-labelledby="fcw-h" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className="card pad stack fc-box">
      <div className="row between"><h2 id="fcw-h" style={{ fontSize: 19 }}>{existing ? 'Edit fee change' : 'Change fee'}</h2>
        <button type="button" className="linkbtn" onClick={onClose}>Close</button></div>
      <ol className="fc-steps" aria-label="Steps">{['What changes', 'Why', 'Review & send'].map((s, i) =>
        <li key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}><span>{i + 1}</span>{s}</li>)}</ol>

      {step === 1 && <>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Type the new fee for each phase that changes. Hourly phases: the fee is the not-to-exceed amount. Leave the rest as they are.</p>
        <div style={{ overflowX: 'auto' }}><table className="table fc-edit">
          <thead><tr><th>Phase</th><th>Billing</th><th className="r">Current</th><th className="r">New fee</th><th className="r">Difference</th><th /></tr></thead>
          <tbody>{rows.map((r) => { const d = (Number.isFinite(num(r.to)) ? num(r.to) : 0) - r.from
            return <tr key={r.key} className={Math.abs(d) >= 0.005 || !r.phase_id ? 'fc-changed' : undefined}>
              <td>{r.phase_id ? (r.code === 'AS' ? <><span className="muted">↳ AS</span> {r.name || 'Additional service'}</> : r.code === 'CU' ? r.name : <><strong>{r.code}</strong> <span className="muted">{PHASE_NAME[r.code]}</span></>)
                : <div className="row" style={{ gap: 6 }}>
                    <label className="sr" htmlFor={'fn' + r.key}>Additional service name</label>
                    <input id={'fn' + r.key} className="input" style={{ width: 200 }} placeholder="Additional service, e.g. Extra site visits" value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} />
                    <label className="sr" htmlFor={'fp' + r.key}>Under phase</label>
                    <select id={'fp' + r.key} className="input" style={{ width: 130 }} value={r.parent_phase_id ?? ''} onChange={(e) => set(r.key, { parent_phase_id: e.target.value || null })}>
                      <option value="">Under phase…</option>{mains.map((m) => <option key={m.id} value={m.id}>{m.code === 'CU' ? m.name : m.code}</option>)}</select>
                    <label className="row" style={{ gap: 5, fontSize: 13, flexBasis: '100%' }}><input type="checkbox" checked={!!r.cons} onChange={(e) => set(r.key, { cons: e.target.checked, ...(e.target.checked ? { billing: 'fixed' as const } : {}) })} style={{ width: 15, height: 15 }} /> Consultant’s service</label>
                    {r.cons && <div style={{ flexBasis: '100%' }}><ConsultantFee id={'fc-cons' + r.key} onFee={(q) => set(r.key, { to: q })} /></div>}</div>}</td>
              <td><label className="sr" htmlFor={'fb' + r.key}>Billing</label><select id={'fb' + r.key} className="input" style={{ width: 120 }} value={r.billing} onChange={(e) => set(r.key, { billing: e.target.value as 'fixed' | 'hourly' })}>
                <option value="fixed">Fixed fee</option><option value="hourly">Hourly (NTE)</option></select></td>
              <td className="r num muted">{r.phase_id ? money(r.from) : '—'}</td>
              <td className="r"><label className="sr" htmlFor={'ft' + r.key}>New fee</label><input id={'ft' + r.key} className="input num r" style={{ width: 130 }} inputMode="decimal" value={r.to} onChange={(e) => set(r.key, { to: e.target.value })} /></td>
              <td className="r num" style={{ color: d < -0.004 ? '#b42318' : d > 0.004 ? '#027a48' : 'var(--muted)' }}>{Math.abs(d) < 0.005 ? '—' : `${d > 0 ? '+' : '−'}${money(Math.abs(d))}`}</td>
              <td>{!r.phase_id && <button type="button" className="linkbtn" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove this additional service">Remove</button>}</td></tr> })}</tbody>
          <tfoot><tr><td colSpan={2}><strong>Total</strong></td><td className="r num muted">{money(from)}</td><td className="r num"><strong>{money(to)}</strong></td>
            <td className="r num"><strong>{Math.abs(to - from) < 0.005 ? '—' : `${to > from ? '+' : '−'}${money(Math.abs(to - from))}`}</strong></td><td /></tr></tfoot>
        </table></div>
        <div><button type="button" className="btn small secondary" onClick={() => setRows((rs) => [...rs, { key: Math.random().toString(36).slice(2), phase_id: null, code: 'AS', name: '', parent_phase_id: mains[0]?.id ?? null, billing: 'fixed', from: 0, to: '' }])}>+ Add additional service</button></div>
      </>}

      {step === 2 && <>
        <div><label className="l" htmlFor="fcw-t">Name</label><input id="fcw-t" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><label className="l" htmlFor="fcw-r">Why the fee is changing <span className="muted">(the client reads this)</span></label>
          <textarea id="fcw-r" className="input" rows={5} value={reason} placeholder="e.g. The owner added a second-floor mezzanine after schematic design was approved, which adds design and documentation work in DD and CD." onChange={(e) => setReason(e.target.value)} /></div>
      </>}

      {step === 3 && <>
        <p style={{ margin: 0 }}><strong>{title}</strong></p>
        <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{reason}</p>
        <table className="table fc-lines"><thead><tr><th>Item</th><th className="r">Current</th><th className="r">New</th><th className="r">Difference</th></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={i}><td>{lineLabel(l)}{l.billing === 'hourly' && <span className="muted"> · hourly, not to exceed</span>}</td>
            <td className="r num muted">{l.phase_id ? money(l.from) : 'new'}</td><td className="r num"><strong>{money(l.to)}</strong></td>
            <td className="r num">{`${l.to - l.from >= 0 ? '+' : '−'}${money(Math.abs(l.to - l.from))}`}</td></tr>)}</tbody>
          <tfoot><tr><td><strong>Project fee</strong></td><td className="r num muted">{money(from)}</td><td className="r num"><strong>{money(to)}</strong></td>
            <td className="r num"><strong>{`${to - from >= 0 ? '+' : '−'}${money(Math.abs(to - from))}`}</strong></td></tr></tfoot></table>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nothing changes on the project until the client signs this in their portal. While it waits you can withdraw it, edit it and send it again.</p>
      </>}

      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className="row between">
        <span>{step > 1 && <button type="button" className="btn secondary" onClick={() => { setErr(''); setStep(step - 1) }}>‹ Back</button>}</span>
        <span className="row" style={{ gap: 8 }}>
          {step < 3 ? <button type="button" className="btn" onClick={next}>Next ›</button> : <>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => save(false)}>Save draft</button>
            <button type="button" className="btn" disabled={busy} onClick={() => save(true)}>{busy ? 'Sending…' : 'Send to client for signature'}</button></>}
        </span>
      </div>
    </div>
  </div>
}

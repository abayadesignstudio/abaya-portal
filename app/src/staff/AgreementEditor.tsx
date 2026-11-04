import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { STANDARD, PHN, newDoc, type DocState, type Clause } from '../lib/agreementTemplate'
import './agreement.css'

// ---------- helpers
const W = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const words = (n: number | string) => { const k = Math.round(+n || 0); return (W[k] || String(k)) + ' (' + k + ')' }
const money = (n: number | string) => '$ ' + (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const autoName = (d: DocState) => (d.v.projName ? `${d.v.projName} — Proposal` : 'Untitled proposal')
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const longDateOf = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); if (!m) return ''; const d = new Date(+m[1], +m[2] - 1, +m[3]); return `${DAYS[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` }
const lines = (t: string) => (t || '').split('\n').map((x) => x.trim()).filter(Boolean)
const TYPES: Record<string, string> = { S: 'Shell', FO: 'Interior Finish-Out', CON: 'Consultation' }
const RED = '#c4161c', BLUE = '#0b4f8a'

type Run = { t: string; k: 'same' | 'add' | 'del' }
const tok = (t: string) => t.split(/(\n|\s+)/).filter((x) => x !== '')
function diff(a: string, b: string): Run[] {
  const A = tok(a), B = tok(b), n = A.length, m = B.length
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: Run[] = []
  const push = (t: string, k: Run['k']) => { const last = out[out.length - 1]; if (last && last.k === k && t !== '\n' && last.t !== '\n') last.t += t; else out.push({ t, k }) }
  let i = 0, j = 0
  while (i < n && j < m) { if (A[i] === B[j]) { push(A[i], 'same'); i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) push(A[i++], 'del'); else push(B[j++], 'add') }
  while (i < n) push(A[i++], 'del'); while (j < m) push(B[j++], 'add')
  return out
}

type UI = { mode: 'draft' | 'final'; changesIn: 'text' | 'report'; check: boolean; openSec: number; openCl: string; editing: string; draft: string; addFor: string; nTitle: string; nBody: string; newSecTitle: string; exNew: string }
const UI0: UI = { mode: 'draft', changesIn: 'text', check: false, openSec: 0, openCl: '', editing: '', draft: '', addFor: '', nTitle: '', nBody: '', newSecTitle: '', exNew: '' }

type CView = Clause & { num: string; sec: number; cur: string; added: boolean; customIdx?: number; off: boolean; modified: boolean; missing: string[] }
type SView = { n: number; title: string; initial?: boolean; clauses: CView[] }

/** Builds the document model (sections with current text, issues, report) from the saved state. */
function build(doc: DocState) {
  const v = doc.v
  const onCount = PHN.filter(([ab]) => doc.ph[ab]?.on).length
  const fee = +v.fee || 0
  const FP: Record<string, [string | null, string]> = {
    'Project name': ['projName', v.projName], 'Project address': ['projAddr', v.projAddr], 'Consultants': ['consultants', v.consultants],
    'Number of phases': [null, onCount ? words(onCount) + (onCount === 1 ? ' phase' : ' phases') : ''],
    'Days fee is valid': ['validity', v.validity ? words(v.validity) : ''], 'Total fee': [null, fee ? money(fee) : ''],
  }
  const secs: SView[] = STANDARD.map((s) => ({ n: s.n, title: s.title, initial: s.initial, clauses: [] as CView[] }))
  const missingIn = (txt: string) => (txt.match(/\{[^}]+\}/g) || []).map((x) => x.slice(1, -1)).filter((l) => FP[l] && !FP[l][1])
  STANDARD.forEach((s, si) => s.clauses.forEach((c) => {
    const off = !!doc.off[c.id]
    const cur = doc.edits[c.id] !== undefined ? doc.edits[c.id] : c.std
    secs[si].clauses.push({ ...c, num: c.id, sec: s.n, cur, added: false, off, modified: doc.edits[c.id] !== undefined && doc.edits[c.id] !== c.std, missing: off ? [] : missingIn(c.title + ' ' + cur) })
  }))
  doc.custom.forEach((c, i) => {
    let sec = secs.find((x) => String(x.n) === String(c.sec))
    if (!sec) { sec = { n: secs.length + 1, title: (c.secTitle || c.title).toUpperCase(), clauses: [] }; secs.push(sec) }
    const top = sec.clauses.filter((x) => !x.sub).length
    const id = 'x' + i
    const off = !!doc.off[id]
    sec.clauses.push({ id, title: c.title.replace(/\.?$/, '.'), std: '', kind: 'text', sub: false, num: `${sec.n}.${top + 1}`, sec: sec.n, cur: c.body, added: true, customIdx: i, off, modified: false, missing: off ? [] : missingIn(c.body) })
  })
  const pctSum = doc.pay.reduce((a, p) => a + (+p.pct || 0), 0)
  const issues: { t: string; sec: number; cl: string }[] = []
  if (!longDateOf(v.date)) issues.push({ t: 'Cover — agreement date', sec: 0, cl: '' })
  if (!v.ownerName) issues.push({ t: 'Cover — Owner name', sec: 0, cl: '' })
  secs.forEach((s) => s.clauses.forEach((c) => c.missing.forEach((l) => issues.push({ t: `${c.num} — fill in “${l}”`, sec: s.n, cl: c.id }))))
  if (!onCount) issues.push({ t: '2.11 — no phase selected', sec: 2, cl: '2.11' })
  if (pctSum !== 100) issues.push({ t: `6.2 — payments add up to ${pctSum}%, not 100%`, sec: 6, cl: '6.2' })
  if (!fee) issues.push({ t: '6.2 — total fee is $0', sec: 6, cl: '6.2' })
  const changes = secs.flatMap((s) => s.clauses).filter((c) => c.off || c.modified || c.added)
  return { secs, FP, fee, pctSum, issues, changes, onCount }
}

export default function AgreementEditor() {
  const { id } = useParams()
  const nav = useNavigate()
  const { profile, session } = useAuth()
  const autoTitle = useRef(true)
  const [row, setRow] = useState<{ id: string; title: string; status: string; project_id: string | null; client_id: string | null } | null>(null)
  const [doc, setDoc] = useState<DocState | null>(null)
  const [ui, setUi] = useState<UI>(UI0)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const loaded = useRef(false)
  const patchUi = (p: Partial<UI>) => setUi((u) => ({ ...u, ...p }))

  // load, or create when the route is /proposals/new
  useEffect(() => {
    let live = true
    loaded.current = false
    ;(async () => {
      if (id === 'new') {
        const d = newDoc()
        const { data, error } = await supabase.from('agreements').insert({ title: 'Untitled proposal', doc: d, total_fee: 0, created_by: profile?.id }).select('id').single()
        if (error) return setErr(error.message)
        nav('/proposals/' + (data as { id: string }).id, { replace: true }); return
      }
      const { data, error } = await supabase.from('agreements').select('id, title, status, project_id, client_id, doc').eq('id', id!).single()
      if (!live) return
      if (error) return setErr(error.message)
      const r = data as { id: string; title: string; status: string; project_id: string | null; client_id: string | null; doc: DocState }
      const d = r.doc && r.doc.v ? r.doc : newDoc()
      // The name follows the project name only while nobody has set it by hand (Rename, Duplicate).
      autoTitle.current = r.title === autoName(d) || r.title === 'Untitled proposal'
      setRow(r); setDoc(d); setTimeout(() => { loaded.current = true })
    })()
    return () => { live = false }
  }, [id, nav, profile?.id])

  const model = useMemo(() => (doc ? build(doc) : null), [doc])

  // autosave: debounced while typing, flushed immediately when leaving the page or closing the tab
  const pending = useRef<{ id: string; values: Record<string, unknown> } | null>(null)
  const token = useRef<string | undefined>(undefined)
  token.current = session?.access_token
  const payload = (d: DocState, current: string) => {
    const title = autoTitle.current ? autoName(d) : current
    return { doc: d, title, total_fee: +d.v.fee || 0, updated_at: new Date().toISOString() }
  }
  const flushNow = async () => {
    const p = pending.current; if (!p) return
    pending.current = null; setSaved('saving')
    const { error } = await supabase.from('agreements').update(p.values).eq('id', p.id)
    if (error) { setErr(error.message); setSaved('unsaved'); if (!pending.current) pending.current = p; return }
    if (!pending.current) setSaved('saved')
    setRow((r) => (r && r.id === p.id ? { ...r, title: p.values.title as string } : r))
  }
  // Page is going away: the request must outlive it, so use fetch keepalive (body limit ~64 KB).
  const flushOnExit = () => {
    const p = pending.current; if (!p || !token.current) return false
    const body = JSON.stringify(p.values)
    if (body.length > 60000) return false
    pending.current = null
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/agreements?id=eq.${p.id}`, {
      method: 'PATCH', keepalive: true, body,
      headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token.current}`, Prefer: 'return=minimal' },
    }).catch(() => {})
    return true
  }
  useEffect(() => {
    if (!doc || !row || !loaded.current) return
    pending.current = { id: row.id, values: payload(doc, row.title) }
    setSaved('unsaved')
    const t = setTimeout(flushNow, 900)
    return () => clearTimeout(t)
  }, [doc, row?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushOnExit() }
    const onUnload = (e: BeforeUnloadEvent) => {
      // Saved on the way out when possible; otherwise ask the browser to warn before leaving.
      if (pending.current && !flushOnExit()) { e.preventDefault(); e.returnValue = '' }
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onUnload)
      flushNow() // leaving the editor inside the portal (sidebar link, back button)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !doc) return <p className="err">{err}</p>
  if (!doc || !model || !row) return <p>Loading…</p>

  const up = (f: (d: DocState) => void) => setDoc((d) => { const c: DocState = JSON.parse(JSON.stringify(d)); f(c); return c })
  const setV = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { const val = e.target.value; up((d) => { d.v[k] = val }) }
  const draft = ui.mode === 'draft'
  const showMarks = draft || ui.changesIn === 'text'
  const openClause = (sec: number, cl: string) => patchUi({ openSec: sec, openCl: cl, check: false })

  const send = async () => {
    if (model.issues.length && !window.confirm(`There are ${model.issues.length} open issues (empty fill points or payment totals). Mark as sent anyway?`)) return
    const { error } = await supabase.from('agreements').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', row.id)
    if (error) setErr(error.message); else setRow({ ...row, status: 'sent' })
  }
  const printPdf = () => {
    const prev = ui.mode
    patchUi({ mode: 'final' })
    const restore = () => { patchUi({ mode: prev }); window.removeEventListener('afterprint', restore) }
    window.addEventListener('afterprint', restore)
    setTimeout(() => window.print(), 150)
  }

  return (
    <div className="stack" style={{ gap: 0 }}>
      <div className="ag-toolbar no-print">
        <div>
          <Link to="/proposals" style={{ fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>‹ Proposals</Link>
          <h1 style={{ fontSize: 21, marginTop: 4 }}>{row.title}</h1>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>
            <span className="status" style={{ background: row.status === 'draft' ? '#fff' : row.status === 'sent' ? '#eef2f6' : '#e7f6ec' }}>{row.status[0].toUpperCase() + row.status.slice(1)}</span>{' '}
            <span aria-live="polite">{saved === 'saved' ? 'All changes saved' : saved === 'saving' ? 'Saving…' : 'Unsaved changes'}</span>
          </p>
        </div>
        <div className="row">
          <div className="ag-seg" role="group" aria-label="View">
            <button type="button" aria-pressed={draft} onClick={() => patchUi({ mode: 'draft' })}>Draft</button>
            <button type="button" aria-pressed={!draft} onClick={() => patchUi({ mode: 'final' })}>Final</button>
          </div>
          {!draft && <div className="row" style={{ gap: 6, fontSize: 13 }} role="group" aria-label="Show changes"><span className="muted">Changes:</span>
            <div className="ag-seg"><button type="button" aria-pressed={ui.changesIn === 'text'} onClick={() => patchUi({ changesIn: 'text' })}>In the text</button>
              <button type="button" aria-pressed={ui.changesIn === 'report'} onClick={() => patchUi({ changesIn: 'report' })}>Report only</button></div></div>}
          <button type="button" className="btn secondary" onClick={() => patchUi({ check: !ui.check })}>{model.issues.length ? `Check document (${model.issues.length})` : 'Check document ✓'}</button>
          <button type="button" className="btn secondary" onClick={printPdf}>Download PDF</button>
          <button type="button" className="btn" onClick={send} disabled={row.status !== 'draft'}>{row.status === 'draft' ? 'Send to client' : 'Sent'}</button>
        </div>
      </div>
      {row.status === 'sent' && <p className="ok no-print" style={{ margin: '12px 0 0' }}>Marked as sent. Emailing the agreement and e-signature aren’t connected yet — download the PDF and send it yourself for now.</p>}
      {err && <p className="err no-print" role="alert" style={{ margin: '12px 0 0' }}>{err}</p>}
      <div className="ag-wrap">
        <Outline doc={doc} model={model} ui={ui} patchUi={patchUi} up={up} setV={setV} />
        <main className="ag-main">
          {ui.check && (
            <div role="region" aria-label="Document check" className="card pad no-print" style={{ maxWidth: 816, margin: '0 auto 16px' }}>
              {model.issues.length ? <>
                <p style={{ margin: '0 0 8px', fontWeight: 700, color: '#8a4b00' }}>Fix these before sending</p>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {model.issues.map((i, k) => <li key={k}><button type="button" className="linkbtn" style={{ textDecoration: 'underline' }} onClick={() => openClause(i.sec, i.cl)}>{i.t}</button></li>)}</ul>
              </> : <p style={{ margin: 0, fontWeight: 700, color: 'var(--green)' }}>All fill points are complete and the payments add up to 100%.</p>}
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>{model.changes.length} change(s) to the standard text will be listed in the Modifications Report.</p>
            </div>)}
          <Document doc={doc} model={model} draft={draft} showMarks={showMarks} changesIn={ui.changesIn} onOpen={openClause} />
        </main>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- outline (sidebar)
type OutlineProps = { doc: DocState; model: ReturnType<typeof build>; ui: UI; patchUi: (p: Partial<UI>) => void; up: (f: (d: DocState) => void) => void
  setV: (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void }

function Field({ id, label, children, hint }: { id: string; label: string; children: ReactNode; hint?: string }) {
  return <div><label className="l" htmlFor={id}>{label}</label>{children}{hint && <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}><em>{hint}</em></p>}</div>
}

function Outline({ doc, model, ui, patchUi, up, setV }: OutlineProps) {
  const v = doc.v
  const inp = (k: string, label: string, type = 'text') => <Field id={'ag-' + k} label={label}><input id={'ag-' + k} type={type} className="input" value={v[k] ?? ''} onChange={setV(k)} /></Field>
  const ta = (k: string, label: string, rows = 3, hint?: string) => <Field id={'ag-' + k} label={label} hint={hint}><textarea id={'ag-' + k} className="input" rows={rows} value={v[k] ?? ''} onChange={setV(k)} /></Field>
  const chipsOf = (c: CView) => [c.off ? ['Omitted', RED, '#fdecea'] : null, c.modified ? ['Modified', BLUE, '#e8f1fb'] : null, c.added ? ['Added', BLUE, '#e8f1fb'] : null, c.missing.length ? ['Needs info', '#8a4b00', '#fdf1dc'] : null].filter(Boolean) as string[][]
  const label = (c: CView) => `${c.num} ${c.title.replace(/\{[^}]+\}/g, (x) => model.FP[x.slice(1, -1)]?.[1] || '…')}`

  return (
    <aside className="ag-out no-print" aria-label="Agreement outline">
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', background: '#f6f5f2' }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Standard form · <strong style={{ color: 'var(--text)' }}>Owner–Architect Agreement</strong></p>
        <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.4 }}>Grey text in the agreement is a <strong>fill point</strong>; orange still needs filling in. Click any clause to open it here. Standard text is locked until you choose <em>Edit wording</em>, and every change is tracked.</p>
      </div>
      <div style={{ borderBottom: '1px solid #ece9e3' }}>
        <button type="button" className="ag-row" style={{ padding: '13px 16px', fontWeight: 700 }} aria-expanded={ui.openSec === 0} onClick={() => patchUi({ openSec: ui.openSec === 0 ? -1 : 0 })}>{ui.openSec === 0 ? '▾' : '▸'} Cover · Parties &amp; Project</button>
        {ui.openSec === 0 && <div className="ag-f" style={{ padding: '4px 16px 16px', background: '#fbfaf8' }}>
          {inp('date', 'Agreement date', 'date')}
          {inp('ownerName', 'Owner name')}
          {ta('ownerAddr', 'Owner business address')}
          {inp('ownerPhone', 'Owner telephone', 'tel')}
          {ta('ownerEmail', 'Owner email(s)', 2, 'One per line.')}
          {ta('archContacts', 'Architect contacts', 4)}
          {inp('projName', 'Project name')}
          {inp('projAddr', 'Project address')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {inp('projSize', 'Size')}
            <Field id="ag-pt" label="Type"><select id="ag-pt" className="input" value={v.projType} onChange={setV('projType')}><option value="S">Shell (S)</option><option value="FO">Interior Finish-Out (FO)</option><option value="CON">Consultation (CON)</option></select></Field>
          </div>
          {inp('signer', 'Architect signature line')}
        </div>}
      </div>
      {model.secs.map((s) => {
        const open = ui.openSec === s.n
        const nOff = s.clauses.filter((c) => c.off).length, nMod = s.clauses.filter((c) => c.modified || c.added).length, nMiss = s.clauses.filter((c) => c.missing.length).length
        const nextNum = `${s.n}.${s.clauses.filter((c) => !c.sub).length + 1}`
        return (
          <div key={s.n} style={{ borderBottom: '1px solid #ece9e3' }}>
            <button type="button" className="ag-row" style={{ padding: '12px 16px' }} aria-expanded={open} onClick={() => patchUi({ openSec: open ? -1 : s.n })}>
              <span style={{ fontWeight: 700 }}>{open ? '▾' : '▸'} {s.n}. {s.title.charAt(0) + s.title.slice(1).toLowerCase()}</span>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 2, paddingLeft: 16 }}>{[nMiss ? `${nMiss} need info` : '', nMod ? `${nMod} changed` : '', nOff ? `${nOff} omitted` : ''].filter(Boolean).join(' · ')}</span>
            </button>
            {open && <>
              <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 10px' }}>
                {s.clauses.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="ag-row" style={{ padding: '8px 16px 8px 36px', fontSize: 14, background: ui.openCl === c.id ? '#eef2f6' : undefined }} aria-expanded={ui.openCl === c.id}
                      onClick={() => patchUi({ openCl: ui.openCl === c.id ? '' : c.id, editing: '' })}>
                      <span style={{ display: 'block' }}>{label(c)}</span>
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>{chipsOf(c).map(([t, fg, bg]) => <span key={t} className="ag-chip" style={{ color: fg, background: bg }}>{t}</span>)}</span>
                    </button>
                    {ui.openCl === c.id && <ClausePanel c={c} doc={doc} model={model} ui={ui} patchUi={patchUi} up={up} setV={setV} />}
                  </li>))}
              </ul>
              <div style={{ padding: '0 16px 14px 36px' }}>
                {ui.addFor !== String(s.n)
                  ? <button type="button" className="btn small secondary" onClick={() => patchUi({ addFor: String(s.n), nTitle: '', nBody: '' })}>+ Add subsection {nextNum}</button>
                  : <div className="ag-panel" style={{ margin: 0 }}>
                      <Field id="ag-nt" label={`Title of ${nextNum}`}><input id="ag-nt" className="input" value={ui.nTitle} onChange={(e) => patchUi({ nTitle: e.target.value })} /></Field>
                      <Field id="ag-nb" label="Text" hint="Each line becomes a paragraph. It shows as an addition to the standard form."><textarea id="ag-nb" className="input" rows={5} value={ui.nBody} onChange={(e) => patchUi({ nBody: e.target.value })} /></Field>
                      <div className="row"><button type="button" className="btn small" onClick={() => { if (!ui.nTitle.trim()) return; const idx = doc.custom.length; up((d) => { d.custom.push({ sec: ui.addFor, title: ui.nTitle.trim(), body: ui.nBody }) }); patchUi({ addFor: '', openCl: 'x' + idx }) }}>Add</button>
                        <button type="button" className="btn small secondary" onClick={() => patchUi({ addFor: '' })}>Cancel</button></div>
                    </div>}
              </div>
            </>}
          </div>)
      })}
      <div className="ag-f" style={{ padding: '14px 16px 24px' }}>
        <Field id="ag-nsec" label="Add a new section at the end"><input id="ag-nsec" className="input" placeholder="e.g. Exhibits" value={ui.newSecTitle} onChange={(e) => patchUi({ newSecTitle: e.target.value })} /></Field>
        <div><button type="button" className="btn small secondary" onClick={() => {
          if (!ui.newSecTitle.trim()) return
          const n = model.secs.length + 1, idx = doc.custom.length
          up((d) => { d.custom.push({ sec: String(n), secTitle: ui.newSecTitle.trim(), title: ui.newSecTitle.trim(), body: '' }) })
          patchUi({ newSecTitle: '', openSec: n, openCl: 'x' + idx })
        }}>+ Add section</button></div>
      </div>
    </aside>
  )
}

function ClausePanel({ c, doc, model, ui, patchUi, up, setV }: OutlineProps & { c: CView }) {
  const v = doc.v
  const tokens = Array.from(new Set((c.title + ' ' + c.cur).match(/\{[^}]+\}/g) || [])).map((x) => x.slice(1, -1)).filter((l) => model.FP[l])
  const setOff = (off: boolean) => up((d) => { if (off) d.off[c.id] = true; else delete d.off[c.id] })
  const saveEdit = () => up((d) => {
    if (c.added && c.customIdx !== undefined) d.custom[c.customIdx].body = ui.draft
    else if (ui.draft === c.std) delete d.edits[c.id]; else d.edits[c.id] = ui.draft
  })
  return (
    <div className="ag-panel">
      <div className="ag-seg" role="group" aria-label="Use this clause" style={{ alignSelf: 'flex-start' }}>
        <button type="button" aria-pressed={!c.off} onClick={() => setOff(false)}>Use</button>
        <button type="button" aria-pressed={c.off} onClick={() => setOff(true)} style={c.off ? { background: RED, color: '#fff' } : { color: RED }}>Omit</button>
      </div>
      {tokens.map((l) => {
        const key = model.FP[l][0]
        return key
          ? <Field key={l} id={`fp-${c.id}-${key}`} label={l}><input id={`fp-${c.id}-${key}`} className="input" style={{ background: '#f1f1f1' }} value={v[key] ?? ''} onChange={setV(key)} /></Field>
          : <p key={l} style={{ margin: 0, fontSize: 13 }}><strong>{l}:</strong> {model.FP[l][1] || '—'} <em className="muted">— set automatically</em></p>
      })}
      <KindEditor c={c} doc={doc} ui={ui} patchUi={patchUi} up={up} setV={setV} />
      {(c.cur.trim() || c.added) && (ui.editing !== c.id ? (
        <div className="row">
          <button type="button" className="btn small secondary" onClick={() => patchUi({ editing: c.id, draft: c.cur })}>Edit wording</button>
          {c.modified && <button type="button" className="btn small secondary" onClick={() => up((d) => { delete d.edits[c.id] })}>Revert to standard</button>}
          {c.added && <button type="button" className="btn small danger" onClick={() => { up((d) => { d.custom.splice(c.customIdx!, 1) }); patchUi({ openCl: '' }) }}>Delete</button>}
        </div>
      ) : (<>
        <Field id={'ed-' + c.id} label="Wording" hint="Words in curly braces are fill points — keep them as they are. Changes show as underlined additions and struck deletions, and go in the Modifications Report.">
          <textarea id={'ed-' + c.id} className="input" rows={9} value={ui.draft} onChange={(e) => patchUi({ draft: e.target.value })} /></Field>
        <div className="row"><button type="button" className="btn small" onClick={() => { saveEdit(); patchUi({ editing: '' }) }}>Save wording</button>
          <button type="button" className="btn small secondary" onClick={() => patchUi({ editing: '' })}>Cancel</button></div>
      </>))}
    </div>
  )
}

function KindEditor({ c, doc, ui, patchUi, up, setV }: Omit<OutlineProps, 'model'> & { c: CView }) {
  const v = doc.v
  if (c.kind === 'program') return <>
    <Field id="ag-pgt" label="Program heading"><input id="ag-pgt" className="input" value={v.progTitle} onChange={setV('progTitle')} /></Field>
    <Field id="ag-pgi" label="Program description" hint="Each line becomes a paragraph."><textarea id="ag-pgi" className="input" rows={4} value={v.progIntro} onChange={setV('progIntro')} /></Field>
    <Field id="ag-pgl" label="“The project shall include”" hint="One per line. Text before a colon is set in bold."><textarea id="ag-pgl" className="input" rows={5} value={v.progItems} onChange={setV('progItems')} /></Field>
  </>
  if (c.kind === 'phases') return <>
    <p className="muted" style={{ margin: 0, fontSize: 12 }}><em>[meetings] and [revisions] are written out as words and numerals — “three (3)”. Phases you untick become “Intentionally omitted” in the final.</em></p>
    {PHN.map(([ab, name]) => { const p = doc.ph[ab]; const set = (k: string, val: string | boolean) => up((d) => { (d.ph[ab] as unknown as Record<string, unknown>)[k] = val })
      return (
        <div key={ab} style={{ border: '1px solid #e4e0d8', borderRadius: 8, padding: '8px 10px', background: '#fff' }}>
          <label className="row" style={{ gap: 8, fontWeight: 700, fontSize: 14 }}><input type="checkbox" checked={p.on} onChange={(e) => set('on', e.target.checked)} style={{ width: 18, height: 18 }} />{ab} · {name}</label>
          {p.on && <div className="ag-f" style={{ marginTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Field id={'phm-' + ab} label="Meetings / visits"><input id={'phm-' + ab} type="number" min={0} className="input" value={p.meet} onChange={(e) => set('meet', e.target.value)} /></Field>
              <Field id={'phr-' + ab} label="Revision rounds"><input id={'phr-' + ab} type="number" min={0} className="input" value={p.rev} onChange={(e) => set('rev', e.target.value)} /></Field>
            </div>
            <Field id={'phs-' + ab} label="Scope (one per line)"><textarea id={'phs-' + ab} className="input" rows={6} value={p.scope} onChange={(e) => set('scope', e.target.value)} /></Field>
            <Field id={'phd-' + ab} label="Deliverables (one per line)"><textarea id={'phd-' + ab} className="input" rows={4} value={p.deliv} onChange={(e) => set('deliv', e.target.value)} /></Field>
          </div>}
        </div>) })}
  </>
  if (c.kind === 'excluded') return <>
    {doc.ex.map((x, i) => (
      <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 8, flexWrap: 'nowrap' }}>
        <input id={'ex-' + i} type="checkbox" checked={x.on} onChange={(e) => up((d) => { d.ex[i].on = e.target.checked })} style={{ marginTop: 2, width: 18, height: 18, flex: 'none' }} />
        <label htmlFor={'ex-' + i} style={{ flex: 1, fontSize: 14 }}>{x.t}</label>
        <button type="button" className="linkbtn" aria-label={`Remove ${x.t}`} style={{ color: 'var(--muted)', fontSize: 18 }} onClick={() => up((d) => { d.ex.splice(i, 1) })}>×</button>
      </div>))}
    <div className="row" style={{ flexWrap: 'nowrap' }}><label className="sr" htmlFor="ag-exn">New excluded service</label>
      <input id="ag-exn" className="input" placeholder="Add an excluded service" value={ui.exNew} onChange={(e) => patchUi({ exNew: e.target.value })} />
      <button type="button" className="btn small secondary" onClick={() => { if (ui.exNew.trim()) { const t = ui.exNew.trim(); up((d) => { d.ex.push({ t, on: true }) }); patchUi({ exNew: '' }) } }}>Add</button></div>
  </>
  if (c.kind === 'fees') {
    const fee = +v.fee || 0
    return <>
      <Field id="ag-fee" label="Total fee ($)"><input id="ag-fee" type="number" min={0} step={50} className="input" value={v.fee} onChange={setV('fee')} /></Field>
      {doc.pay.map((p, i) => { const set = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement>) => { const val = e.target.value; up((d) => { d.pay[i][k] = val }) }
        return (
          <div key={i} className="ag-f" style={{ border: '1px solid #e4e0d8', borderRadius: 8, padding: '8px 10px', background: '#fff' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 70px', gap: 8 }}>
              <Field id={'pl-' + i} label="Payment"><input id={'pl-' + i} className="input" value={p.label} onChange={set('label')} /></Field>
              <Field id={'pc-' + i} label="%"><input id={'pc-' + i} type="number" min={0} max={100} className="input" value={p.pct} onChange={set('pct')} /></Field>
            </div>
            <Field id={'pd-' + i} label="When due"><input id={'pd-' + i} className="input" value={p.due} onChange={set('due')} /></Field>
            <Field id={'pp-' + i} label="Phases covered"><input id={'pp-' + i} className="input" value={p.phase} onChange={set('phase')} /></Field>
            <div className="row between"><strong className="num" style={{ fontSize: 14 }}>{money(fee * (+p.pct || 0) / 100)}</strong>
              <button type="button" className="btn small danger" onClick={() => up((d) => { d.pay.splice(i, 1) })}>Remove</button></div>
          </div>) })}
      <div><button type="button" className="btn small secondary" onClick={() => up((d) => { d.pay.push({ label: `Payment ${d.pay.length + 1}`, due: 'Due ', phase: '', pct: '0' }) })}>+ Add payment</button></div>
    </>
  }
  if (c.kind === 'rates') return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
    {([['rP', 'Principal'], ['rPA', 'Proj. Arch.'], ['rD', 'Designer']] as const).map(([k, l]) => <Field key={k} id={'ag-' + k} label={l + ' $/hr'}><input id={'ag-' + k} type="number" className="input" value={v[k]} onChange={setV(k)} /></Field>)}
  </div>
  if (c.kind === 'dispute') return <Field id="ag-dis" label="After mediation"><select id="ag-dis" className="input" value={v.dispute} onChange={setV('dispute')}><option value="a">(a) Arbitration</option><option value="b">(b) Litigation</option></select></Field>
  return null
}

// ---------------------------------------------------------------- document
type Seg = { t: string; k: Run['k']; fp?: string }
function Document({ doc, model, draft, showMarks, changesIn, onOpen }: { doc: DocState; model: ReturnType<typeof build>; draft: boolean; showMarks: boolean; changesIn: string; onOpen: (sec: number, cl: string) => void }) {
  const v = doc.v
  const FP = model.FP
  const longDate = longDateOf(v.date)

  const toParas = (runs: Run[], force = false) => {
    const sm = force || showMarks
    const paras: Seg[][] = [[]]
    runs.forEach((r) => {
      if (r.t === '\n') { if (!(r.k === 'del' && !sm)) paras.push([]); return }
      if (r.k === 'del' && !sm) return
      r.t.split(/(\{[^}]+\})/).filter((x) => x !== '').forEach((piece) => {
        const m = /^\{([^}]+)\}$/.exec(piece)
        paras[paras.length - 1].push(m && FP[m[1]] ? { t: piece, k: r.k, fp: m[1] } : { t: piece, k: r.k })
      })
    })
    return paras.filter((p) => p.length)
  }
  const Segs = ({ segs, force = false, onClick }: { segs: Seg[]; force?: boolean; onClick?: () => void }) => <>{segs.map((s, i) => {
    const sm = force || showMarks
    const deco = s.k === 'add' ? (sm ? 'underline' : 'none') : s.k === 'del' ? 'line-through' : 'none'
    const color = s.k === 'add' && draft ? BLUE : s.k === 'del' && draft ? '#6b7280' : undefined
    if (s.fp) {
      const val = FP[s.fp][1]
      return <span key={i} className="ag-fp" onClick={onClick} style={{ background: draft ? (val ? '#e4e4e4' : '#fde7c4') : 'transparent', textDecoration: deco, color: val ? color : (draft ? '#8a4b00' : RED), fontStyle: val ? 'normal' : 'italic' }}>{val || `[${s.fp}]`}</span>
    }
    return <span key={i} onClick={onClick} style={{ textDecoration: deco, color, cursor: draft && onClick ? 'pointer' : undefined }}>{s.t}</span>
  })}</>
  const runsOf = (c: CView): Run[] => c.added ? tok(c.cur).map((t) => ({ t, k: 'add' as const })) : c.modified ? diff(c.std, c.cur) : tok(c.cur).map((t) => ({ t, k: 'same' as const }))
  const pad = (segs: Seg[]) => /^\([a-z]\)/.test(segs.map((s) => s.t).join('').trim()) ? 28 : 0
  const fee = model.fee
  const struck = (on: boolean) => (on ? {} : { color: RED, textDecoration: 'line-through', textDecorationColor: RED })

  const Initial = () => <p style={{ margin: '14px 0 18px', textAlign: 'right' }}>Initial: <span style={{ display: 'inline-block', width: 120, borderBottom: '1px solid #000' }}>&nbsp;</span></p>

  const special = (c: CView) => {
    if (c.kind === 'program') return (
      <div style={{ margin: '8px 0 8px 28px' }}>
        {v.progTitle && <p style={{ fontWeight: 700 }}>{v.progTitle}</p>}
        {lines(v.progIntro).map((t, i) => <p key={i}>{t}</p>)}
        {lines(v.progItems).length > 0 && <><p>The project shall include:</p>
          <ul>{lines(v.progItems).map((x, i) => { const k = x.indexOf(':'); return <li key={i}>{k > 0 ? <><strong>{x.slice(0, k + 1)}</strong>{x.slice(k + 1)}</> : x}</li> })}</ul></>}
      </div>)
    if (c.kind === 'phases') return PHN.map(([ab, name], i) => {
      const p = doc.ph[ab]
      const rep = (x: string) => x.replace(/\[meetings\]/g, words(p.meet)).replace(/\[revisions\]/g, words(p.rev))
      return (
        <div key={ab} style={{ margin: '10px 0 0 24px', ...(p.on || !draft ? {} : struck(false)) }}>
          <p style={{ fontWeight: 700 }}>2.11.{i + 1} {name.toUpperCase()} ({ab}){!p.on && (draft ? ' — not included' : <span style={{ fontWeight: 400 }}> Intentionally omitted.</span>)}</p>
          {p.on && <div style={{ display: 'grid', gridTemplateColumns: '2.1fr 1fr', border: '1px solid #000', marginBottom: 10 }}>
            <div style={{ padding: '4px 8px', borderRight: '1px solid #000', borderBottom: '1px solid #000', textAlign: 'center', fontWeight: 700 }}>SCOPE</div>
            <div style={{ padding: '4px 8px', borderBottom: '1px solid #000', textAlign: 'center', fontWeight: 700 }}>DELIVERABLES</div>
            <ul style={{ margin: 0, padding: '8px 10px 8px 26px', borderRight: '1px solid #000' }}>{lines(p.scope).map((x, k) => <li key={k}>{rep(x)}</li>)}</ul>
            <ul style={{ margin: 0, padding: '8px 10px 8px 26px' }}>{lines(p.deliv).map((x, k) => <li key={k}>{x}</li>)}</ul>
          </div>}
        </div>)
    })
    if (c.kind === 'excluded') return <ul>{doc.ex.filter((x) => x.on || draft).map((x, i) => <li key={i} style={struck(x.on)}>{x.t}</li>)}</ul>
    if (c.kind === 'fees') return (
      <div style={{ margin: '6px 0 10px', border: '1px solid #000', borderBottom: 0 }}>
        {doc.pay.map((p, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 60px 110px', borderBottom: '1px solid #000' }}>
            <div style={{ padding: '5px 8px' }}><strong>{p.label}{p.due && <> - <em>{p.due}</em></>}</strong>{p.phase && <><br />Phase: {p.phase}</>}</div>
            <div className="num" style={{ padding: '5px 8px', borderLeft: '1px solid #000', textAlign: 'right', fontWeight: 700 }}>{+p.pct || 0}%</div>
            <div className="num" style={{ padding: '5px 8px', borderLeft: '1px solid #000', textAlign: 'right' }}>{money(fee * (+p.pct || 0) / 100)}</div>
          </div>))}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 60px 110px', borderBottom: '1px solid #000', fontWeight: 700 }}>
          <div style={{ padding: '5px 8px', textAlign: 'right' }}>Total Fee:</div>
          <div className="num" style={{ padding: '5px 8px', borderLeft: '1px solid #000', textAlign: 'right', color: model.pctSum === 100 ? undefined : RED }}>{model.pctSum}%</div>
          <div className="num" style={{ padding: '5px 8px', borderLeft: '1px solid #000', textAlign: 'right' }}>{money(fee)}</div>
        </div>
      </div>)
    if (c.kind === 'dispute') return <>
      {(v.dispute === 'a' || draft) && <p style={{ paddingLeft: 28, ...struck(v.dispute === 'a') }}>{v.dispute === 'a' ? '☒' : '☐'} (a) Arbitration: by binding arbitration administered by the AAA in accordance with the AAA Construction Industry Arbitration Rules in effect on the date of the request for arbitration; or</p>}
      {(v.dispute === 'b' || draft) && <p style={{ paddingLeft: 28, ...struck(v.dispute === 'b') }}>{v.dispute === 'b' ? '☒' : '☐'} (b) Litigation: in a court of competent jurisdiction.</p>}
    </>
    if (c.kind === 'rates') return (
      <div style={{ width: 340, margin: '4px auto 10px', display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 3 }}>
        {[['Principal', v.rP], ['Project Architect', v.rPA], ['Designer', v.rD]].flatMap(([r, x]) => [<span key={r} style={{ textAlign: 'center' }}>{r}</span>, <span key={r + 'v'} className="num">{money(x)}/hr</span>])}
      </div>)
    if (c.kind === 'prints') return <>
      <table style={{ width: 420, margin: '4px auto 10px', textAlign: 'center' }}><tbody>
        <tr style={{ fontWeight: 700 }}><td>Size</td><td>Color</td><td>Black &amp; White</td></tr>
        {[['11” x 17”', 2, 1], ['18” x 24”', 5, 2], ['24” x 36”', 10, 5], ['36” x 48”', 20, 10]].map(([s, c1, c2]) => <tr key={s as string}><td>{s}</td><td>${c1} / per sheet</td><td>${c2} / per sheet</td></tr>)}
      </tbody></table>
      <p>No expense beyond the compensation mentioned above (<span className="ag-fp" style={{ background: draft ? '#e4e4e4' : 'transparent' }}>{money(fee)}</span>) will be incurred by the Owner unless the Owner approves a written proposal for additional services from the Architect. No additional services will be performed by the Architect without such written consent.</p>
    </>
    return null
  }

  const report = model.changes
  const notice = report.length
    ? `This agreement is based on the Abaya Design Studio standard form. ${report.length} ${report.length === 1 ? 'change was' : 'changes were'} made to the standard text${changesIn === 'text' ? '; additions are underlined and deletions are struck through, and every change is also listed' : '; every change is listed'} in the Modifications Report at the end of this document.`
    : 'This agreement uses the Abaya Design Studio standard form without changes to its text.'
  const fpStyle = (val: string) => ({ background: draft ? (val ? '#e4e4e4' : '#fde7c4') : 'transparent', fontStyle: val ? 'normal' : 'italic', color: val ? undefined : (draft ? '#8a4b00' : RED) })

  return (
    <article className="ag-doc" aria-label="Agreement">
      <header style={{ display: 'flex', alignItems: 'center', gap: 22, paddingBottom: 18, borderBottom: '1px solid #000' }}>
        <div style={{ width: 170, height: 74, background: '#02253d', color: '#ede6d6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'EB Garamond', Georgia, serif" }}>
          <span style={{ fontSize: 26, letterSpacing: '.18em' }}>ABAYA</span><span style={{ fontSize: 9, letterSpacing: '.32em' }}>DESIGN STUDIO</span></div>
        <div style={{ fontSize: 12, lineHeight: 1.35 }}><strong>Abaya Design Studio, LLC.</strong><br />215 S Denton Tap Road, Suite 215<br />Coppell, Texas 75019<br />info@abayadesignstudio.com<br />Abayadesignstudio.com</div>
      </header>
      <div style={{ margin: '14px 0 0', padding: '8px 10px', border: '1px solid #000', fontSize: 11, lineHeight: 1.35 }}><strong>MODIFICATIONS:</strong> {notice}</div>
      <h1 style={{ margin: '18px 0 0', fontSize: 19 }}>Standard Agreement between Owner and Architect</h1>
      <p style={{ margin: '2px 0 16px', fontStyle: 'italic', fontSize: 15 }}>This agreement is made <span className="ag-fp" style={fpStyle(longDate)}>{longDate || '[Agreement date]'}</span> between…</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 24, fontSize: 12.5 }}>
        <div><p style={{ margin: '0 0 4px', fontWeight: 700 }}>Owner:</p>
          <table className="ag-box"><tbody>
            <tr><td className="k">Name</td><td>{v.ownerName || <em style={fpStyle('')}>[Owner name]</em>}</td></tr>
            <tr><td className="k">Business Address:</td><td>{lines(v.ownerAddr).map((t, i) => <div key={i}>{t}</div>)}</td></tr>
            <tr><td className="k">Telephone</td><td>{v.ownerPhone}</td></tr>
            <tr><td className="k">Email</td><td>{lines(v.ownerEmail).map((t, i) => <div key={i}>{t}</div>)}</td></tr>
          </tbody></table></div>
        <div><p style={{ margin: '0 0 4px', fontWeight: 700 }}>Architect:</p>
          <p style={{ margin: 0 }}><u>Name:</u> Abaya Design Studio, LLC.<br /><u>Business Address:</u> 215 S Denton Tap Rd, Suite 215, Coppell, Texas 75019</p>
          {lines(v.archContacts).map((t, i) => <div key={i}>{t}</div>)}</div>
      </div>
      <p style={{ margin: '16px 0 6px', fontStyle: 'italic', fontWeight: 700 }}>For the project…</p>
      <p style={{ margin: '0 0 4px', fontWeight: 700 }}>Project:</p>
      <table className="ag-box" style={{ fontSize: 12.5, maxWidth: 520 }}><tbody>
        <tr><td className="k">Name:</td><td>{v.projName}</td></tr><tr><td className="k">Address:</td><td>{v.projAddr}</td></tr>
        <tr><td className="k">Size:</td><td>{v.projSize}</td></tr><tr><td className="k">Type:</td><td>{TYPES[v.projType] || ''}</td></tr>
      </tbody></table>

      <h2 style={{ margin: '30px 0 8px', paddingTop: 14, borderTop: '1px solid #000', textAlign: 'center', fontSize: 13 }}>TABLE OF CONTENTS</h2>
      <ol style={{ listStyle: 'none', margin: '0 0 10px', padding: 0, fontSize: 12 }}>
        {model.secs.map((s) => { const all = s.clauses.length > 0 && s.clauses.every((c) => c.off); return <li key={s.n} style={all && draft ? struck(false) : undefined}>SECTION {s.n} - {s.title}</li> })}
      </ol>

      {model.secs.map((s) => {
        const all = s.clauses.length > 0 && s.clauses.every((c) => c.off)
        return (
          <section key={s.n} style={{ marginTop: 24 }}>
            <h2 style={{ margin: '0 0 10px', textAlign: 'center', fontSize: 14.5, ...(all && draft ? struck(false) : {}) }}>SECTION {s.n} - {s.title}</h2>
            {s.clauses.map((c) => {
              const omittedFinal = c.off && !draft
              const bar = draft && (c.modified || c.added || c.off) ? (c.off ? RED : BLUE) : 'transparent'
              const open = () => onOpen(s.n, c.id)
              const titleSegs = toParas(tok(c.title).map((t) => ({ t, k: c.added ? 'add' as const : 'same' as const })))[0] || []
              return (
                <div key={c.id} className="ag-clause" style={{ marginLeft: c.sub ? 9 : -13, borderLeftColor: bar, ...(c.off && draft ? struck(false) : {}) }}>
                  <p style={{ margin: '0 0 2px', fontWeight: 700 }}><span onClick={open} style={{ cursor: 'pointer' }}>{c.num}</span> <Segs segs={titleSegs} onClick={open} />{omittedFinal && <span style={{ fontWeight: 400 }}> Intentionally omitted.</span>}</p>
                  {!omittedFinal && <>
                    {toParas(runsOf(c)).map((segs, i) => <p key={i} style={{ paddingLeft: pad(segs) }}><Segs segs={segs} onClick={open} /></p>)}
                    {special(c)}
                  </>}
                </div>)
            })}
            {s.initial && <Initial />}
          </section>)
      })}

      <div style={{ marginTop: 26, paddingTop: 16, borderTop: '1px solid #000', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30 }}>
        <div><p>Date: {longDate}</p><div style={{ height: 64 }} /><p style={{ margin: 0, borderTop: '1px solid #000', paddingTop: 4, width: 230 }}>{v.signer}</p></div>
        <div><p>Date: {longDate}</p><div style={{ height: 64 }} /><p style={{ margin: '0 0 30px', borderTop: '1px solid #000', paddingTop: 4 }}>Owner (Signature)</p><p style={{ margin: 0, borderTop: '1px solid #000', paddingTop: 4 }}>Owner (Print)</p></div>
      </div>
      <p style={{ margin: '18px 0 0', textAlign: 'center', fontStyle: 'italic' }}>If you have any further questions, please do not hesitate to contact us!</p>
      <p style={{ margin: '6px 0 0', paddingTop: 6, borderTop: '1px solid #000', textAlign: 'center', fontWeight: 700 }}>END OF DOCUMENT</p>

      {!draft && report.length > 0 && (
        <section aria-label="Modifications report" style={{ marginTop: 36, paddingTop: 18, borderTop: '2px solid #000', breakBefore: 'page' }}>
          <h2 style={{ margin: '0 0 4px', textAlign: 'center', fontSize: 14.5 }}>MODIFICATIONS REPORT</h2>
          <p style={{ textAlign: 'center', fontSize: 12 }}><em>Changes to the Abaya Design Studio standard form text. Additions are underlined; deletions are struck through.</em></p>
          {report.map((c) => (
            <div key={c.id} style={{ margin: '0 0 12px' }}>
              <p style={{ margin: '0 0 2px', fontWeight: 700 }}>{c.num} {c.title.replace(/\{[^}]+\}/g, '…')}</p>
              <p style={{ margin: '0 0 4px', fontStyle: 'italic' }}>{c.off ? 'Deleted in full (intentionally omitted).' : c.added ? 'Added (not part of the standard form):' : 'Standard text revised:'}</p>
              {!c.off && toParas(runsOf(c), true).map((segs, i) => <p key={i} style={{ paddingLeft: 18 }}><Segs segs={segs} force /></p>)}
            </div>))}
        </section>)}
    </article>
  )
}

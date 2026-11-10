import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { type DocState } from '../lib/agreementTemplate'
import { Document, build, type SignView } from '../staff/AgreementEditor'
import { cleanSignature } from '../staff/SignatureField'
import { buildPrintPages, removePrintPages, sectionStartPages, sourceDoc } from '../staff/printPages'
import '@fontsource/great-vibes/400.css'
import '@fontsource/dancing-script/600.css'
import '@fontsource/homemade-apple/400.css'
import '../staff/agreement.css'

type Row = { id: string; title: string; status: string; doc: DocState; doc_hash: string | null; published_logo: string | null; initial_sections: number[]; sent_at: string | null; project_id: string | null }
type Sig = { signer_name: string; signer_title: string | null; signer_email: string; signature: string; initials_img: string; initials: Record<string, string>; signed_at: string; ip: string | null; user_agent: string | null; doc_hash: string; method: string }
type Adopted = { name: string; title: string; method: 'style' | 'draw' | 'upload'; sig: string; init: string }

const STYLES = [
  { font: "'Great Vibes', cursive", label: 'Style 1', size: 1 },
  { font: "'Dancing Script', cursive", label: 'Style 2', size: 0.86 },
  { font: "'Homemade Apple', cursive", label: 'Style 3', size: 0.7 },
]
const initialsOf = (name: string) => name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join('').slice(0, 4)
const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('Couldn’t read the drawing.'))), 'image/png'))

/** Typed name → signature image in a handwriting font. */
async function renderStyled(text: string, font: string, scale: number) {
  await document.fonts.load(`80px ${font}`)
  const c = document.createElement('canvas'); c.width = 1400; c.height = 300
  const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height)
  let px = 150 * scale
  x.font = `${px}px ${font}`
  while (x.measureText(text).width > c.width - 80 && px > 30) { px -= 6; x.font = `${px}px ${font}` }
  x.fillStyle = '#10213a'; x.textBaseline = 'middle'; x.fillText(text, 40, c.height / 2)
  return cleanSignature(await toBlob(c))
}

/** Client: review the published agreement, initial each section, sign. */
export default function ClientAgreement() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [row, setRow] = useState<Row | null>(null)
  const [sig, setSig] = useState<Sig | null>(null)
  const [err, setErr] = useState('')
  const [adopted, setAdopted] = useState<Adopted | null>(null)
  const [initials, setInitials] = useState<Record<string, string>>({})
  const [signedHere, setSignedHere] = useState(false)
  const [adopt, setAdopt] = useState<null | { then: (a: Adopted) => void }>(null)
  const [finish, setFinish] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data, error } = await supabase.from('agreements').select('id, title, status, doc, doc_hash, published_logo, initial_sections, sent_at, project_id').eq('id', id!).maybeSingle()
    if (error || !data) return setErr(error?.message ?? 'This agreement isn’t available.')
    setRow(data as Row)
    if (data.status === 'signed') { const { data: s } = await supabase.from('agreement_signatures').select('*').eq('agreement_id', id!).maybeSingle(); setSig(s as Sig | null) }
  }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const doc = row?.doc?.v ? row.doc : null
  const model = useMemo(() => (doc ? build(doc) : null), [doc])
  // table of contents page numbers, and our own print layout (same as the staff Download PDF)
  const [toc, setToc] = useState<Record<number, number>>({})
  useEffect(() => { if (!doc) return; const t = setTimeout(() => document.fonts.ready.then(() => { const s = sourceDoc(); if (s) setToc(sectionStartPages(s)) }), 400); return () => clearTimeout(t) }, [doc, sig])
  useEffect(() => {
    const before = () => buildPrintPages(sourceDoc())
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', removePrintPages)
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', removePrintPages); removePrintPages() }
  }, [])

  if (err && !row) return <p className="err">{err}</p>
  if (!row || !doc || !model) return <p>Loading…</p>
  if (row.status !== 'sent' && row.status !== 'signed') return <p className="card pad">This agreement isn’t open for signing.</p>

  const need = row.initial_sections
  const done = need.filter((n) => initials[String(n)]).length
  const ready = done === need.length && signedHere
  const withAdopted = (f: (a: Adopted) => void) => (adopted ? f(adopted) : setAdopt({ then: (a) => { setAdopted(a); setAdopt(null); f(a) } }))
  const nextSpot = () => {
    const el = [...document.querySelectorAll<HTMLButtonElement>('.ag-sign-btn')][0]
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus({ preventScroll: true })
  }
  const submit = async () => {
    if (!adopted) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('sign_agreement', { p_id: row.id, p_hash: row.doc_hash, p_name: adopted.name, p_title: adopted.title, p_method: adopted.method,
      p_signature: adopted.sig, p_initials_img: adopted.init, p_initials: initials })
    setBusy(false)
    if (error) return setErr(error.message)
    setFinish(false); await load(); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const signed = row.status === 'signed' && sig
  const view: SignView = signed
    ? { initials: sig.initials, initImg: sig.initials_img, sigImg: sig.signature, name: sig.signer_name, title: sig.signer_title, date: sig.signed_at,
        cert: { email: sig.signer_email, signedAt: sig.signed_at, ip: sig.ip, ua: sig.user_agent, hash: sig.doc_hash, method: sig.method, publishedAt: row.sent_at } }
    : { initials, initImg: adopted?.init ?? null, sigImg: signedHere ? adopted?.sig ?? null : null, name: adopted?.name ?? '', title: adopted?.title, date: signedHere ? new Date().toISOString() : null,
        onInitial: (n) => withAdopted(() => setInitials((m) => ({ ...m, [String(n)]: new Date().toISOString() }))),
        onSign: () => { if (done < need.length) { setErr(`Initial every section first (${done} of ${need.length} done).`); nextSpot(); return } withAdopted(() => { setErr(''); setSignedHere(true) }) } }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="no-print">
        {row.project_id && <Link to={`/projects/${row.project_id}`} style={{ fontWeight: 700, textDecoration: 'none' }}>‹ Back to project</Link>}
        <h1 style={{ marginTop: 6 }}>{row.title}</h1>
      </div>
      {signed
        ? <div className="card pad row between no-print" style={{ borderLeft: '6px solid var(--green)' }}>
            <span><strong>Signed</strong> by {sig.signer_name} on {new Date(sig.signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Thank you.</span>
            <button type="button" className="btn secondary" onClick={() => window.print()}>Download PDF</button></div>
        : <div className="card pad stack no-print cs-bar">
            <div className="row between" style={{ gap: 10 }}>
              <span><strong>Review and sign.</strong> Initial each section ({done} of {need.length}), then sign at the end.</span>
              <div className="row" style={{ gap: 8 }}>
                {adopted && <button type="button" className="btn small secondary" onClick={() => setAdopt({ then: (a) => { setAdopted(a); setAdopt(null) } })}>Change signature</button>}
                {!ready && <button type="button" className="btn small" onClick={nextSpot}>{done === 0 && !adopted ? 'Start' : 'Next'}</button>}
                {ready && <button type="button" className="btn" onClick={() => setFinish(true)}>Finish &amp; sign</button>}
              </div>
            </div>
            <div className="cs-prog" aria-hidden="true"><span style={{ width: `${((done + (signedHere ? 1 : 0)) / (need.length + 1)) * 100}%` }} /></div>
            {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
          </div>}
      <div className="cs-doc">
        <Document tocPages={toc} logo={doc.v.logo || row.published_logo || ''} doc={doc} model={model} draft={false} showMarks changesIn="text"
          onOpen={() => {}} breaks={doc.pb ?? []} onToggleBreak={() => {}} sign={view} />
      </div>
      {adopt && <AdoptDialog defaultName={adopted?.name ?? profile?.full_name ?? ''} defaultTitle={adopted?.title ?? ''} onCancel={() => setAdopt(null)} onAdopt={adopt.then} />}
      {finish && adopted && <div className="cs-modal" role="dialog" aria-modal="true" aria-labelledby="cs-fin-h">
        <div className="card pad stack cs-modal-box">
          <h2 id="cs-fin-h">Sign the agreement</h2>
          <p style={{ margin: 0 }}>You initialed all {need.length} sections and placed your signature as <strong>{adopted.name}</strong>{adopted.title ? `, ${adopted.title}` : ''}.</p>
          <ConsentAndSign busy={busy} err={err} onCancel={() => setFinish(false)} onSign={submit} />
        </div></div>}
    </div>
  )
}

function ConsentAndSign({ busy, err, onCancel, onSign }: { busy: boolean; err: string; onCancel: () => void; onSign: () => void }) {
  const [ok, setOk] = useState(false)
  return <>
    <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, flex: 'none' }} />
      <span>I agree to sign this agreement electronically. My electronic signature and initials are legally binding, the same as signing by hand, and I have read the agreement.</span></label>
    {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
    <div className="row" style={{ gap: 8 }}><button type="button" className="btn" disabled={!ok || busy} onClick={onSign}>{busy ? 'Signing…' : 'Sign agreement'}</button>
      <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button></div>
  </>
}

/** Choose how to sign: a style for your typed name, draw it, or upload an image. Makes both the signature and the initials. */
function AdoptDialog({ defaultName, defaultTitle, onAdopt, onCancel }: { defaultName: string; defaultTitle: string; onAdopt: (a: Adopted) => void; onCancel: () => void }) {
  const [tab, setTab] = useState<'style' | 'draw' | 'upload'>('style')
  const [name, setName] = useState(defaultName)
  const [title, setTitle] = useState(defaultTitle)
  const [ini, setIni] = useState(initialsOf(defaultName))
  const iniTouched = useRef(false)
  const [style, setStyle] = useState(0)
  const sigPad = useRef<HTMLCanvasElement>(null), iniPad = useRef<HTMLCanvasElement>(null)
  const [drawn, setDrawn] = useState({ sig: false, ini: false })
  const [files, setFiles] = useState<{ sig: string | null; ini: string | null }>({ sig: null, ini: null })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onCancel])

  const pick = async (which: 'sig' | 'ini', f?: File | null) => {
    if (!f) return
    setErr('')
    try {
      if (!f.type.startsWith('image/')) throw new Error('Use a PNG or JPG image.')
      if (f.size > 15 * 1024 * 1024) throw new Error('The image must be under 15 MB.')
      const url = await cleanSignature(f); setFiles((x) => ({ ...x, [which]: url }))
    } catch (e) { setErr((e as Error).message) }
  }
  const go = async () => {
    setErr('')
    if (!name.trim()) return setErr('Type your full name.')
    setBusy(true)
    try {
      let sig = '', init = ''
      if (tab === 'style') {
        if (!ini.trim()) throw new Error('Type your initials.')
        sig = await renderStyled(name.trim(), STYLES[style].font, STYLES[style].size)
        init = await renderStyled(ini.trim(), STYLES[style].font, STYLES[style].size)
      } else if (tab === 'draw') {
        if (!drawn.sig || !drawn.ini) throw new Error('Draw both your signature and your initials.')
        sig = await cleanSignature(await toBlob(sigPad.current!)); init = await cleanSignature(await toBlob(iniPad.current!))
      } else {
        if (!files.sig || !files.ini) throw new Error('Upload both a signature and an initials image.')
        sig = files.sig; init = files.ini
      }
      onAdopt({ name: name.trim(), title: title.trim(), method: tab, sig, init })
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }

  return (
    <div className="cs-modal" role="dialog" aria-modal="true" aria-labelledby="cs-ad-h" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="card pad stack cs-modal-box" style={{ maxWidth: 640 }}>
        <h2 id="cs-ad-h">Adopt your signature</h2>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ flex: '2 1 200px' }}><label className="l" htmlFor="cs-n">Full name</label>
            <input id="cs-n" className="input" value={name} autoComplete="name" onChange={(e) => { setName(e.target.value); if (!iniTouched.current) setIni(initialsOf(e.target.value)) }} /></div>
          <div style={{ flex: '0 1 90px' }}><label className="l" htmlFor="cs-i">Initials</label>
            <input id="cs-i" className="input" value={ini} maxLength={4} onChange={(e) => { iniTouched.current = true; setIni(e.target.value.toUpperCase()) }} /></div>
          <div style={{ flex: '1 1 150px' }}><label className="l" htmlFor="cs-t">Title <span className="muted">(optional)</span></label>
            <input id="cs-t" className="input" value={title} placeholder="e.g. Owner, President" onChange={(e) => setTitle(e.target.value)} /></div>
        </div>
        <div className="cv-seg cs-tabs" role="tablist" aria-label="How to sign">
          {([['style', 'Choose a style'], ['draw', 'Draw'], ['upload', 'Upload']] as const).map(([k, l]) =>
            <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {tab === 'style' && <div className="stack" role="radiogroup" aria-label="Signature style" style={{ gap: 8 }}>
          {STYLES.map((s, i) => <label key={i} className={'cs-style' + (style === i ? ' on' : '')}>
            <input type="radio" name="cs-style" checked={style === i} onChange={() => setStyle(i)} />
            <span className="cs-style-sig" style={{ fontFamily: s.font, fontSize: 34 * s.size }}>{name.trim() || 'Your name'}</span>
            <span className="cs-style-ini" style={{ fontFamily: s.font, fontSize: 30 * s.size }}>{ini.trim() || 'YN'}</span>
          </label>)}
        </div>}
        {tab === 'draw' && <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <Pad label="Signature" canvas={sigPad} width={380} onInk={(v) => setDrawn((d) => ({ ...d, sig: v }))} />
          <Pad label="Initials" canvas={iniPad} width={150} onInk={(v) => setDrawn((d) => ({ ...d, ini: v }))} />
        </div>}
        {tab === 'upload' && <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          {(['sig', 'ini'] as const).map((k) => <div key={k} style={{ flex: k === 'sig' ? '2 1 240px' : '1 1 140px' }}>
            <span className="l">{k === 'sig' ? 'Signature image' : 'Initials image'}</span>
            <label className="cs-up">{files[k] ? <img src={files[k]!} alt="" style={{ maxWidth: '100%', maxHeight: 70 }} /> : <span className="muted">Choose a photo or scan</span>}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { pick(k, e.target.files?.[0]); e.target.value = '' }} /></label>
          </div>)}
          <p className="muted" style={{ margin: 0, fontSize: 12.5, flexBasis: '100%' }}>Dark ink on white paper works best; the paper is made transparent automatically.</p>
        </div>}
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>By selecting Adopt, you agree that this signature and these initials are the electronic representation of your signature on this agreement.</p>
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div className="row" style={{ gap: 8 }}><button type="button" className="btn" disabled={busy} onClick={go}>{busy ? 'Preparing…' : 'Adopt'}</button>
          <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button></div>
      </div>
    </div>
  )
}

/** Finger / mouse / pen drawing pad. */
function Pad({ label, canvas, width, onInk }: { label: string; canvas: React.RefObject<HTMLCanvasElement | null>; width: number; onInk: (v: boolean) => void }) {
  const H = 130
  const last = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const c = canvas.current!; const r = window.devicePixelRatio || 1
    c.width = width * r; c.height = H * r
    const x = c.getContext('2d')!; x.scale(r, r); x.fillStyle = '#fff'; x.fillRect(0, 0, width, H)
    x.lineWidth = 2.6; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#10213a'
  }, [canvas, width])
  const pt = (e: React.PointerEvent) => { const b = canvas.current!.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top } }
  const clear = () => { const c = canvas.current!, x = c.getContext('2d')!; x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.restore(); onInk(false) }
  return <div>
    <span className="l">{label}</span>
    <canvas ref={canvas} className="cs-pad" style={{ width, height: H }} aria-label={`Draw your ${label.toLowerCase()} here`}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = pt(e) }}
      onPointerMove={(e) => { if (!last.current) return; const p = pt(e), x = canvas.current!.getContext('2d')!
        x.beginPath(); x.moveTo(last.current.x, last.current.y); x.lineTo(p.x, p.y); x.stroke(); last.current = p; onInk(true) }}
      onPointerUp={() => { last.current = null }} onPointerCancel={() => { last.current = null }} />
    <button type="button" className="linkish" style={{ fontSize: 12.5 }} onClick={clear}>Clear</button>
  </div>
}


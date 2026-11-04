import { useRef, useState } from 'react'
import { LayoutMismatch, makeFillable, type Layout } from './fillablePdf'

/** Drop the PDF from Download PDF; get it back with Owner initial, signature and print-name fields. */
export default function FillablePanel({ measure, onClose }: { measure: () => Promise<Layout | null>; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const take = async (f?: File | null) => {
    if (!f) return
    if (f.type && f.type !== 'application/pdf') return setMsg({ ok: false, t: 'Drop a PDF file.' })
    setBusy(true); setMsg(null)
    try {
      const layout = await measure()
      if (!layout) throw new Error('The agreement isn’t ready yet. Try again in a moment.')
      const out = await makeFillable(await f.arrayBuffer(), layout)
      const name = f.name.replace(/\.pdf$/i, '') + ' (fillable).pdf'
      const url = URL.createObjectURL(new Blob([out as BlobPart], { type: 'application/pdf' }))
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
      const n = layout.spots.filter((s) => s.kind === 'initial').length
      setMsg({ ok: true, t: `Saved “${name}” with ${n} initial field${n === 1 ? '' : 's'}, Owner Signature and Owner Printed Name.` })
    } catch (e) {
      setMsg({ ok: false, t: e instanceof LayoutMismatch ? e.message : `Couldn’t make it fillable: ${(e as Error).message}` })
    }
    setBusy(false)
  }

  return (
    <section className="no-print stack" aria-labelledby="fp-h" style={{ gap: 8, paddingTop: 4 }}>
      <div className="row between"><h2 id="fp-h" style={{ margin: 0, fontSize: 15 }}>Make a fillable PDF</h2>
        <button type="button" className="linkbtn" style={{ fontSize: 13, textDecoration: 'underline' }} onClick={onClose}>Close</button></div>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.45 }}>
        <li>Click <strong>Download PDF</strong> and save it. Keep paper <em>Letter</em>, margins <em>Default</em>, scale <em>100%</em>.</li>
        <li>Drop that file below. You get a copy with fields for the Owner’s initials on each page, signature and printed name.</li>
      </ol>
      <div role="button" tabIndex={0} aria-label="Drop the exported agreement PDF here, or choose it"
        className={'ag-drop' + (over ? ' over' : '')} style={{ minHeight: 90 }}
        onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]) }}>
        <strong style={{ fontSize: 14 }}>{busy ? 'Adding fields…' : 'Drop the exported PDF here'}</strong>
        <span className="ag-drop-h">or click to choose it. The file stays on your computer.</span>
      </div>
      <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = '' }} />
      {msg && <p className={msg.ok ? 'ok' : 'err'} role={msg.ok ? 'status' : 'alert'} style={{ margin: 0 }}>{msg.t}</p>}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}><em>The fields are typed text fields, so they work in Adobe Acrobat, Preview and browser PDF viewers. The Owner can also draw a signature over the signature field with Acrobat’s Fill &amp; Sign.</em></p>
    </section>
  )
}

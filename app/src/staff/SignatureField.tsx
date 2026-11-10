import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// The Architect's signature image on the agreement's signature line.
// Stored per proposal as a small PNG data URL (doc.v.archSig), so it travels with that proposal only.
// "Save as my signature" keeps a private copy in the staff-only "drawings" bucket under signatures/<user id>.png.
const BUCKET = 'drawings'
const pathFor = (uid: string) => `signatures/${uid}.png`
const MAX_W = 600, MAX_H = 180, MAX_CHARS = 45000 // keep it small: the whole proposal autosaves in one request

/** Trim blank margins, turn near-white paper transparent, scale down; returns a PNG data URL. */
export async function cleanSignature(blob: Blob): Promise<string> {
  const img = await createImageBitmap(blob)
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  const x = c.getContext('2d')!; x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height), px = d.data
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    if (px[i + 3] < 20 || lum > 225) { px[i + 3] = 0; continue } // paper → transparent
    if (lum > 160) px[i + 3] = Math.round(px[i + 3] * (225 - lum) / 65) // soften the anti-aliased edge
    const p = i / 4, X = p % c.width, Y = (p / c.width) | 0
    if (X < minX) minX = X; if (X > maxX) maxX = X; if (Y < minY) minY = Y; if (Y > maxY) maxY = Y
  }
  if (maxX < 0) throw new Error('No signature found in that image. Use a dark signature on light paper.')
  x.putImageData(d, 0, 0)
  const pad = 4, w = maxX - minX + 1 + pad * 2, h = maxY - minY + 1 + pad * 2
  let scale = Math.min(1, MAX_W / w, MAX_H / h), out = ''
  for (let tries = 0; tries < 5; tries++) {
    const o = document.createElement('canvas'); o.width = Math.max(1, Math.round(w * scale)); o.height = Math.max(1, Math.round(h * scale))
    const ox = o.getContext('2d')!; ox.imageSmoothingQuality = 'high'
    ox.drawImage(c, minX - pad, minY - pad, w, h, 0, 0, o.width, o.height)
    out = o.toDataURL('image/png')
    if (out.length <= MAX_CHARS) return out
    scale *= 0.75
  }
  return out
}

export default function SignatureField({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const { profile } = useAuth()
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const run = async (f: () => Promise<string | void>) => {
    setBusy(true); setMsg(null)
    try { const t = await f(); if (t) setMsg({ ok: true, t }) } catch (e) { setMsg({ ok: false, t: (e as Error).message }) }
    setBusy(false)
  }

  const take = (f?: File | null) => f && run(async () => {
    if (!f.type.startsWith('image/')) throw new Error('Use a PNG or JPG image of your signature.')
    if (f.size > 15 * 1024 * 1024) throw new Error('The image must be under 15 MB.')
    onChange(await cleanSignature(f))
    return 'Signature placed on the Architect line. It’s saved with this proposal only.'
  })
  const saveMine = () => run(async () => {
    if (!profile || !value) return
    const blob = await (await fetch(value)).blob()
    const { error } = await supabase.storage.from(BUCKET).upload(pathFor(profile.id), blob, { contentType: 'image/png', upsert: true })
    if (error) throw new Error(error.message)
    return 'Saved as your signature. Use “Use my saved signature” on any proposal.'
  })
  const useMine = () => run(async () => {
    if (!profile) return
    const { data, error } = await supabase.storage.from(BUCKET).download(pathFor(profile.id))
    if (error || !data) throw new Error('You haven’t saved a signature yet. Drop one in, then click “Save as my signature”.')
    if (!data.type.startsWith('image/')) throw new Error('Your saved signature couldn’t be read. Drop it in again and save it.')
    onChange(await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(data) }))
    return 'Your saved signature was placed on the Architect line.'
  })

  return (
    <div>
      <span className="l" id="ag-sig-l">Architect signature</span>
      <div role="button" tabIndex={0} aria-labelledby="ag-sig-l" className={'ag-drop' + (over ? ' over' : '')} style={{ minHeight: 90 }}
        onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]) }}>
        {value ? <img src={value} alt="Architect signature" style={{ maxWidth: 230, maxHeight: 60 }} /> : <span className="muted">Not signed</span>}
        <span className="ag-drop-h">{busy ? 'Working…' : 'Drop a signature image here, or click to choose'}</span>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = '' }} />
      <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}><em>Dark ink on white paper works best; the paper is made transparent automatically.</em></p>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <button type="button" className="btn small secondary" disabled={busy} onClick={useMine}>Use my saved signature</button>
        {value && <button type="button" className="btn small secondary" disabled={busy} onClick={saveMine}>Save as my signature</button>}
        {value && <button type="button" className="btn small secondary" disabled={busy} onClick={() => { onChange(''); setMsg(null) }}>Remove</button>}
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'err'} role={msg.ok ? 'status' : 'alert'} style={{ margin: '6px 0 0', fontSize: 13 }}>{msg.t}</p>}
    </div>
  )
}

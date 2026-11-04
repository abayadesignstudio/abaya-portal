import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Agreement header logo. Files go to the public "site" bucket (staff-write) under agreement-logos/.
// The firm default is one file at a fixed path, so it needs no database column; a proposal can override it (doc.v.logo).
const BUCKET = 'site', DIR = 'agreement-logos', DEFAULT = 'firm-default'
const MAX = 5 * 1024 * 1024

/** Public URL of the firm default logo (with a version stamp so a replaced file isn't served stale), or '' if none. */
export async function loadFirmLogo(): Promise<string> {
  const { data } = await supabase.storage.from(BUCKET).list(DIR, { search: DEFAULT, limit: 1 })
  const f = data?.find((x) => x.name === DEFAULT)
  if (!f) return ''
  return supabase.storage.from(BUCKET).getPublicUrl(`${DIR}/${DEFAULT}`).data.publicUrl + `?v=${encodeURIComponent(f.updated_at ?? f.created_at ?? '')}`
}

async function upload(file: File, path: string, upsert = false) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '3600', upsert })
  if (error) throw new Error(error.message)
}

export default function LogoField({ value, firmLogo, onChange, onFirmLogo }: {
  value: string; firmLogo: string; onChange: (url: string) => void; onFirmLogo: (url: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const shown = value || firmLogo
  useEffect(() => { if (msg?.ok) { const t = setTimeout(() => setMsg(null), 3500); return () => clearTimeout(t) } }, [msg])

  const take = async (f?: File | null) => {
    if (!f) return
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(f.type)) return setMsg({ ok: false, t: 'Use a PNG, JPG, SVG, WebP or GIF image.' })
    if (f.size > MAX) return setMsg({ ok: false, t: 'The image must be under 5 MB.' })
    setBusy(true); setMsg(null)
    try {
      const ext = (f.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
      const path = `${DIR}/${crypto.randomUUID()}.${ext}`
      await upload(f, path)
      onChange(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
      setMsg({ ok: true, t: firmLogo ? 'Logo added to this proposal.' : 'Logo added. Use “Make firm default” to use it on every proposal.' })
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }) }
    setBusy(false)
  }

  const makeDefault = async () => {
    if (!value) return
    setBusy(true); setMsg(null)
    try {
      const blob = await (await fetch(value)).blob()
      await upload(new File([blob], DEFAULT, { type: blob.type }), `${DIR}/${DEFAULT}`, true)
      onFirmLogo(await loadFirmLogo())
      onChange('') // this proposal now just follows the firm default
      setMsg({ ok: true, t: 'Firm default saved. Proposals without their own logo use it.' })
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }) }
    setBusy(false)
  }

  return (
    <div>
      <span className="l" id="ag-logo-l">Header logo</span>
      <div role="button" tabIndex={0} aria-labelledby="ag-logo-l" aria-describedby="ag-logo-h"
        className={'ag-drop' + (over ? ' over' : '')}
        onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]) }}>
        {shown ? <img src={shown} alt="" /> : <span className="muted">No logo yet</span>}
        <span id="ag-logo-h" className="ag-drop-h">{busy ? 'Uploading…' : 'Drop an image here, or click to choose'}</span>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = '' }} />
      <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}><em>{value ? 'This proposal uses its own logo.' : firmLogo ? 'Using the firm default logo.' : 'No logo set: the header shows the Abaya wordmark.'} Wide logos work best; it prints up to 260 px wide and 74 px tall.</em></p>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        {value && <button type="button" className="btn small secondary" disabled={busy} onClick={makeDefault}>Make firm default</button>}
        {value && <button type="button" className="btn small secondary" disabled={busy} onClick={() => onChange('')}>{firmLogo ? 'Use firm default' : 'Remove'}</button>}
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'err'} role={msg.ok ? 'status' : 'alert'} style={{ margin: '6px 0 0', fontSize: 13 }}>{msg.t}</p>}
    </div>
  )
}

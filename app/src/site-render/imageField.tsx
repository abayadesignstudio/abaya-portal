import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { resolveUrl } from './chrome'

/** Puck custom field: upload to the public "site" bucket, or paste a URL. */
export function ImageInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const upload = async (f: File) => {
    if (!f.type.startsWith('image/')) return setErr('Choose an image file.')
    if (f.size > 20 * 1024 * 1024) return setErr('Images must be under 20 MB.')
    setBusy(true); setErr('')
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('site').upload(path, f, { cacheControl: '31536000', contentType: f.type })
    setBusy(false)
    if (error) return setErr(error.message)
    onChange(supabase.storage.from('site').getPublicUrl(path).data.publicUrl)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {value && <img src={resolveUrl('../', value)} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 4, background: '#eee' }} />}
      <input id={id} type="file" accept="image/*" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }} />
      <input type="text" placeholder="…or paste an image URL" value={value || ''} onChange={(e) => onChange(e.target.value)}
        style={{ font: '13px Arial', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4 }} />
      {busy && <span style={{ font: '12px Arial' }}>Uploading…</span>}
      {err && <span role="alert" style={{ font: '12px Arial', color: '#b42318' }}>{err}</span>}
      {value && <button type="button" onClick={() => onChange('')} style={{ alignSelf: 'flex-start', font: '12px Arial', background: 'none', border: 0, color: '#b42318', cursor: 'pointer', padding: 0 }}>Remove image</button>}
    </div>
  )
}

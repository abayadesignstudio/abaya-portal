import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { bigUpload } from '../lib/bigUpload'
import RowMenu from '../components/RowMenu'

/** Project page → Files: renderings shown in the client's "Renderings" tab (models/{project}/renderings/). */
const MAX = 3200
async function toWebp(f: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(f)
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k)
    const c = new OffscreenCanvas(w, h); c.getContext('2d')!.drawImage(bmp, 0, 0, w, h); bmp.close()
    const b = await c.convertToBlob({ type: 'image/webp', quality: 0.88 })
    if (b.type !== 'image/webp' || b.size >= f.size) return f
    return new File([b], f.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' })
  } catch { return f }
}
const slug = (s: string) => s.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-')

export default function RenderingsUpload({ projectId }: { projectId: string }) {
  const dir = `${projectId}/renderings`
  const files = useLoad(async () => ((await supabase.storage.from('models').list(dir, { sortBy: { column: 'name', order: 'asc' } })).data ?? []).filter((f) => f.id && !f.name.startsWith('.')), [dir])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const names = (files.data ?? []).map((f) => f.name).join('|')
  useLoad(async () => {
    if (!names) return setThumbs({})
    const { data } = await supabase.storage.from('models').createSignedUrls(names.split('|').map((n) => `${dir}/${n}`), 3600)
    setThumbs(Object.fromEntries((data ?? []).map((d) => [d.path?.split('/').pop() ?? '', d.signedUrl ?? ''])))
  }, [names])
  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    setErr('')
    const arr = [...list].filter((f) => f.type.startsWith('image/'))
    for (let i = 0; i < arr.length; i++) {
      setBusy(`Uploading ${i + 1} of ${arr.length}…`)
      const f = await toWebp(arr[i])
      try { await bigUpload('models', `${dir}/${slug(f.name)}`, f) } catch (e) { setErr(e instanceof Error ? e.message : String(e)); break }
    }
    setBusy(''); files.reload()
  }
  const remove = async (name: string) => {
    if (!window.confirm(`Remove ${name} from the client’s renderings? This deletes the image.`)) return
    const { error } = await supabase.storage.from('models').remove([`${dir}/${name}`])
    if (error) return setErr(error.message)
    files.reload()
  }
  return (
    <section className="card pad stack" style={{ gap: 10 }} aria-labelledby="rnd-h">
      <h2 id="rnd-h">Renderings</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Shown in the client’s Renderings tab, beside the 3D model, in name order (prefix with 01, 02… to set the order). Images are converted to WebP, max 3200 px.</p>
      <label className="btn small secondary" style={{ alignSelf: 'flex-start' }}>{busy || 'Upload renderings'}
        <input type="file" accept="image/*" multiple hidden disabled={!!busy} onChange={(e) => { upload(e.target.files); e.target.value = '' }} /></label>
      {err && <p className="err" role="alert">{err}</p>}
      {files.data?.length === 0 && <p className="muted" style={{ margin: 0 }}><em>No renderings uploaded.</em></p>}
      <div className="rnd-grid">{files.data?.map((f) => <figure key={f.name}>
        {thumbs[f.name] ? <img src={thumbs[f.name]} alt={f.name} loading="lazy" /> : <div className="rnd-ph" />}
        <figcaption><span>{f.name}</span><RowMenu label={`Actions for ${f.name}`} items={[{ label: 'Delete', danger: true, onSelect: () => remove(f.name) }]} /></figcaption></figure>)}</div>
    </section>
  )
}

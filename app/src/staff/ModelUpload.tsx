import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { fmtDate } from '../lib/projectContent'

/** Project page → Files: the 3D model the client sees on their project page (storage bucket models/{project}/). */
export default function ModelUpload({ projectId, onSaved }: { projectId: string; onSaved?: () => void }) {
  const files = useLoad(async () => ((await supabase.storage.from('models').list(projectId)).data ?? []).filter((f) => f.name && !f.name.startsWith('.')), [projectId])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const upload = async (f: File | undefined) => {
    if (!f) return
    setErr(''); setBusy(true)
    const { error } = await supabase.storage.from('models').upload(`${projectId}/${f.name}`, f, { upsert: true })
    setBusy(false)
    if (error) return setErr(error.message)
    files.reload(); onSaved?.()
  }
  const remove = async (name: string) => {
    if (!window.confirm(`Remove ${name} from the client portal? This deletes the file.`)) return
    const { error } = await supabase.storage.from('models').remove([`${projectId}/${name}`])
    if (error) return setErr(error.message)
    files.reload(); onSaved?.()
  }
  return (
    <section className="card pad stack" style={{ gap: 10 }} aria-labelledby="mdl-h">
      <h2 id="mdl-h">3D model</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Shown on the client’s project page. Export from SketchUp as .glb (or .gltf) and upload it here.</p>
      <label className="btn small secondary" style={{ alignSelf: 'flex-start' }}>{busy ? 'Uploading…' : 'Upload model'}
        <input type="file" accept=".glb,.gltf,.skp" hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} /></label>
      {err && <p className="err" role="alert">{err}</p>}
      {files.data?.length === 0 && <p className="muted" style={{ margin: 0 }}><em>No model uploaded.</em></p>}
      <ul className="cp-files">{files.data?.map((f) => <li key={f.name}><span>{f.name}</span>
        <span className="muted">{f.updated_at ? fmtDate(f.updated_at) : ''}</span>
        <button type="button" className="btn small danger" onClick={() => remove(f.name)}>Remove</button></li>)}</ul>
    </section>
  )
}

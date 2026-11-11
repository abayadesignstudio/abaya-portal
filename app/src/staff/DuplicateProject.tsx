import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/** Next free project number for this month: 2611A, 2611B… */
async function nextNumber() {
  const d = new Date(), pre = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`
  const { data } = await supabase.from('projects').select('number').ilike('number', `${pre}%`)
  const used = new Set((data ?? []).map((x) => String(x.number).toUpperCase()))
  for (let i = 0; i < 26; i++) { const n = pre + String.fromCharCode(65 + i); if (!used.has(n)) return n }
  return pre
}

/** Copy a project: settings, phases (fees, billing, order), team and budgeted hours, deliverables and trades. */
export default function DuplicateProject({ project, onClose }: { project: { id: string; number: string; name: string }; onClose: () => void }) {
  const nav = useNavigate()
  const [num, setNum] = useState(''); const [name, setName] = useState(`${project.name} (copy)`); const [dates, setDates] = useState(false)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { nextNumber().then(setNum) }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    const { data, error } = await supabase.rpc('duplicate_project', { p_id: project.id, p_number: num, p_name: name, p_keep_dates: dates })
    setBusy(false)
    if (error) return setErr(error.message)
    onClose(); nav(`/projects/${data}`, { state: { tab: 'overview' } })
  }
  return (
    <div className="cs-modal" role="dialog" aria-modal="true" aria-labelledby="dup-h" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={go} className="card pad stack cs-modal-box">
        <h2 id="dup-h">Duplicate {project.number} · {project.name}</h2>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ flex: '0 1 130px' }}><label className="l" htmlFor="dup-n">New number</label><input id="dup-n" className="input" required value={num} onChange={(e) => setNum(e.target.value.toUpperCase())} /></div>
          <div style={{ flex: '1 1 240px' }}><label className="l" htmlFor="dup-m">Name</label><input id="dup-m" className="input" required value={name} onChange={(e) => setName(e.target.value)} /></div>
        </div>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={dates} onChange={(e) => setDates(e.target.checked)} style={{ width: 18, height: 18 }} /> Keep the phase dates</label>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Copies the client, type, address, phases (fees, billing, order, meetings), team and budgeted hours, contracted deliverables and trades. Time, invoices, drawings, files, updates, agreements and additional services stay with the original.</p>
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div className="row" style={{ gap: 8 }}><button className="btn" disabled={busy || !num.trim()}>{busy ? 'Duplicating…' : 'Duplicate'}</button>
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button></div>
      </form>
    </div>
  )
}

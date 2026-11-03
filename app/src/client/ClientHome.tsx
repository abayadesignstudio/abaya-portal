import { supabase, SECTOR_COLOR } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'

export default function ClientHome() {
  const { data, error } = useLoad(async () => must(await supabase.from('projects').select('id, number, name, sector, category, status').order('number')))
  return (
    <div className="stack">
      <h1>Your projects</h1>
      {error && <p className="err">{error}</p>}
      {data?.length === 0 && <p className="muted">No projects yet.</p>}
      {data?.map((p) => (
        <div key={p.id} className="card pad row">
          <span className="tag" style={{ background: SECTOR_COLOR[p.sector ?? 'internal'] }}>{p.number}</span>
          <strong>{p.name}</strong>{p.category && <span className="pill">{p.category}</span>}
        </div>
      ))}
      <p className="muted" style={{ fontSize: 13 }}>Invoices, drawings and project updates arrive here later this week.</p>
    </div>
  )
}

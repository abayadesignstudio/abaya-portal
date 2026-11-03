import { Link, Navigate } from 'react-router-dom'
import { supabase, money, SECTOR_COLOR, CATEGORY_NAME } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { sortPhases, fmtDate, type PhaseRow } from '../lib/projectContent'
import PhaseStepper from './PhaseStepper'
import './client.css'

type P = { id: string; number: string; name: string; sector: string | null; category: string | null; status: string; next_milestone: string | null; phases: PhaseRow[] }
type I = { id: string; number: string; total: number; amount_paid: number; status: string; due_date: string | null }

export default function ClientHome() {
  const { data, error } = useLoad(async () => ({
    projects: must(await supabase.from('projects').select('id, number, name, sector, category, status, next_milestone, phases(id, code, fee, status, start_date, end_date, meetings_included)').order('number', { ascending: false })) as unknown as P[],
    invoices: must(await supabase.from('invoices').select('id, number, total, amount_paid, status, due_date').eq('status', 'open')) as I[],
  }))
  const owed = (data?.invoices ?? []).reduce((a, i) => a + Number(i.total) - Number(i.amount_paid), 0)
  const today = new Date().toISOString().slice(0, 10)
  const late = (data?.invoices ?? []).filter((i) => i.due_date && i.due_date < today)
  // a client with a single project goes straight to its dashboard
  if (data?.projects.length === 1) return <Navigate to={`/projects/${data.projects[0].id}`} replace />
  return (
    <div className="stack">
      <h1>Your projects</h1>
      {error && <p className="err">{error}</p>}
      {owed > 0 && <div className="card pad row between" style={{ borderLeft: `4px solid ${late.length ? 'var(--red)' : 'var(--amber)'}` }}>
        <div><strong>{money(owed)} open</strong> <span className="muted">across {data!.invoices.length} invoice{data!.invoices.length === 1 ? '' : 's'}{late.length ? ` · ${late.length} past due` : ''}</span></div>
        <Link className="btn small secondary" to="/invoices">View invoices</Link></div>}
      {data?.projects.length === 0 && <p className="muted card pad">No projects are shared with you yet.</p>}
      {data?.projects.map((p) => (
        <Link key={p.id} to={`/projects/${p.id}`} className="card pad stack" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="row between">
            <div className="row" style={{ gap: 8 }}>
              <span className="tag" style={{ background: SECTOR_COLOR[p.sector ?? 'internal'] }}>{p.number}</span>
              <strong style={{ fontSize: 18 }}>{p.name}</strong>
              {p.category && <abbr className="pill" title={CATEGORY_NAME[p.category]}>{p.category}</abbr>}
            </div>
            <span className="muted" style={{ fontSize: 14 }}>{p.status === 'complete' ? 'Complete' : p.next_milestone ?? ''}</span>
          </div>
          {p.phases.length > 0 ? <PhaseStepper phases={sortPhases(p.phases)} /> : <p className="muted" style={{ margin: 0 }}><em>Schedule coming soon.</em></p>}
          <span style={{ fontWeight: 700, color: 'var(--navy)' }}>Open project ›</span>
        </Link>
      ))}
      <p className="muted" style={{ fontSize: 13 }}>Last checked {fmtDate(new Date().toISOString())}.</p>
    </div>
  )
}

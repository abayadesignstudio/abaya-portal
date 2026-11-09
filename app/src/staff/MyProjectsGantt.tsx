import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import ProjectsGantt, { type GRow } from './ProjectsGantt'

/** Home: the Projects timeline, limited to the projects you're on (project team, or hours assigned on a phase).
 *  Same bars, milestones, deliverables, tasks and events as the Projects page; drag a phase to move its dates. */
export default function MyProjectsGantt({ me }: { me: string }) {
  const data = useLoad(async () => {
    const [mem, alloc] = await Promise.all([
      supabase.from('project_members').select('project_id').eq('profile_id', me),
      supabase.from('phase_allocations').select('phases(project_id)').eq('profile_id', me),
    ])
    const ids = new Set<string>([
      ...((mem.data ?? []) as { project_id: string }[]).map((r) => r.project_id),
      ...((alloc.data ?? []) as unknown as { phases: { project_id: string } | null }[]).map((r) => r.phases?.project_id).filter(Boolean) as string[],
    ])
    if (!ids.size) return { rows: [] as GRow[], feeUsed: {} as Record<string, number | null> }
    const rows = must(await supabase.from('projects').select('id, number, name, status, sector, clients(name), phases(id, code, status, fee, start_date, end_date)')
      .in('id', [...ids]).in('status', ['active', 'paused', 'proposal']).order('number', { ascending: false })) as unknown as GRow[]
    // fee used = hours logged × each person's rate, against the project's phase fees (same as the Projects page)
    const time = must(await supabase.from('time_entries').select('project_id, minutes, bill_rate, profiles(bill_rate)').in('project_id', rows.map((r) => r.id))) as unknown as
      { project_id: string; minutes: number; bill_rate: number | null; profiles: { bill_rate: number | null } | null }[]
    const labor: Record<string, number> = {}
    for (const t of time) labor[t.project_id] = (labor[t.project_id] ?? 0) + t.minutes / 60 * Number(t.bill_rate ?? t.profiles?.bill_rate ?? 0)
    const feeUsed = Object.fromEntries(rows.map((p) => { const fee = p.phases.reduce((a, ph) => a + Number(ph.fee), 0); return [p.id, fee ? (labor[p.id] ?? 0) / fee * 100 : null] }))
    return { rows, feeUsed }
  }, [me])
  const rows = useMemo(() => data.data?.rows ?? [], [data.data])

  return (
    <section className="stack" aria-labelledby="hm-gantt-h" style={{ gap: 8, minWidth: 0 }}>
      <div className="row between" style={{ padding: '0 4px' }}>
        <h2 id="hm-gantt-h">My projects <span className="muted" style={{ fontWeight: 400 }}>· {rows.length}</span></h2>
        <Link to="/projects" style={{ fontSize: 14, fontWeight: 700 }}>All projects ›</Link>
      </div>
      {data.error && <p className="err">{data.error}</p>}
      {data.data && rows.length === 0 && <p className="muted card pad" style={{ margin: 0 }}><em>You aren’t on any active project yet. Projects show here once you’re on a project’s team or have hours assigned on one of its phases (project → Budget).</em></p>}
      {rows.length > 0 && <ProjectsGantt rows={rows} feeUsed={data.data?.feeUsed ?? {}} onDates={async (id, d) => {
        const { error } = await supabase.from('phases').update(d).eq('id', id)
        if (!error) data.reload()
        return error?.message ?? null
      }} />}
    </section>)
}

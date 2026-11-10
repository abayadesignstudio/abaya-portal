import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useRoles, useRates, rateForRole } from '../lib/roles'

/** Role for a time entry: one of the firm's roles, or a custom role with its own hourly rate
 *  (e.g. a project still billed at an older agreement's rate). rate = '' means "use the usual rate". */
export default function RolePicker({ id, role, rate, onChange }: { id: string; role: string; rate: string; onChange: (role: string, rate: string) => void }) {
  const roles = useRoles(); const rates = useRates()
  const { profile } = useAuth()
  const myTitle = (profile as { title?: string | null } | null)?.title
  const standard = roles.includes(role)
  // a standard role carries that role's rate when it isn't your own; "custom" is only for a role not in Settings
  const standardRate = standard ? rateForRole(role, myTitle, rates) : ''
  const [custom, setCustom] = useState(() => (!!role && !standard) || (!!rate && rate !== standardRate))
  useEffect(() => { if ((role && !standard && roles.length) || (rate && standard && rate !== standardRate && rates.length)) setCustom(true) }, [role, rate, standard, standardRate, roles.length, rates.length])
  return (
    <div className="rp">
      <label className="sr" htmlFor={id}>Role</label>
      <select id={id} className="input" value={custom ? '__custom' : role} onChange={(e) => {
        if (e.target.value === '__custom') { setCustom(true); onChange(role && !standard ? role : '', rate) }
        else { setCustom(false); onChange(e.target.value, rateForRole(e.target.value, myTitle, rates)) }
      }}>
        <option value="">Role</option>
        {roles.map((r) => { const x = rates.find((y) => y.role === r); return <option key={r} value={r}>{r}{x && r !== myTitle ? ` · $${x.rate}/hr` : ''}</option> })}
        <option value="__custom">Custom role &amp; rate…</option>
      </select>
      {custom && <div className="rp-custom">
        <label className="sr" htmlFor={id + '-n'}>Custom role name</label>
        <input id={id + '-n'} className="input" placeholder="Role, e.g. Project Architect (2024 rate)" value={role} onChange={(e) => onChange(e.target.value, rate)} />
        <label className="sr" htmlFor={id + '-r'}>Hourly rate for this entry</label>
        <span className="rp-rate"><span aria-hidden="true">$</span><input id={id + '-r'} className="input num" inputMode="decimal" placeholder="Rate" value={rate} onChange={(e) => onChange(role, e.target.value.replace(/[^0-9.]/g, ''))} /><span aria-hidden="true">/hr</span></span>
        <button type="button" className="linkbtn" onClick={() => { setCustom(false); onChange('', '') }}>Use a standard role</button>
      </div>}
    </div>)
}

/** Your usual role on a project: your role on the project's team, else the role you used last on it, else your standard role
 *  (your rate level in Settings → People), else the role you use most. With no project, your standard role. */
export function useDefaultRole(me: string) {
  const [d, setD] = useState<{ members: { project_id: string; role_label: string | null; bill_rate: number | null }[]; recent: { project_id: string; role_label: string | null }[]; title: string | null } | null>(null)
  useEffect(() => {
    let live = true
    Promise.all([
      supabase.from('project_members').select('project_id, role_label, bill_rate').eq('profile_id', me),
      supabase.from('time_entries').select('project_id, role_label').eq('profile_id', me).not('role_label', 'is', null).order('created_at', { ascending: false }).limit(200),
      supabase.from('profiles').select('title').eq('id', me).maybeSingle(),
    ]).then(([m, r, p]) => { if (live) setD({ members: (m.data ?? []) as never, recent: (r.data ?? []) as never, title: (p.data as { title: string | null } | null)?.title ?? null }) })
    return () => { live = false }
  }, [me])
  return (projectId: string): string => {
    if (!d) return ''
    if (projectId) {
      const m = d.members.find((x) => x.project_id === projectId)?.role_label
      if (m) return m
      const last = d.recent.find((x) => x.project_id === projectId)?.role_label
      if (last) return last
    }
    // no project yet (or nothing project-specific): your standard role from Settings → People
    if (d.title) return d.title
    const counts = new Map<string, number>(); d.recent.forEach((x) => { if (x.role_label) counts.set(x.role_label, (counts.get(x.role_label) ?? 0) + 1) })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  }
}

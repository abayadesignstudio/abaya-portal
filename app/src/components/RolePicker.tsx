import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ROLES } from '../lib/time'

/** Role for a time entry: one of the firm's roles, or a custom role with its own hourly rate
 *  (e.g. a project still billed at an older agreement's rate). rate = '' means "use the usual rate". */
export default function RolePicker({ id, role, rate, onChange }: { id: string; role: string; rate: string; onChange: (role: string, rate: string) => void }) {
  const standard = (ROLES as readonly string[]).includes(role)
  const [custom, setCustom] = useState(() => !!rate || (!!role && !standard))
  useEffect(() => { if (rate || (role && !(ROLES as readonly string[]).includes(role))) setCustom(true) }, [role, rate])
  return (
    <div className="rp">
      <label className="sr" htmlFor={id}>Role</label>
      <select id={id} className="input" value={custom ? '__custom' : role} onChange={(e) => {
        if (e.target.value === '__custom') { setCustom(true); onChange(role && !standard ? role : '', rate) }
        else { setCustom(false); onChange(e.target.value, '') }
      }}>
        <option value="">Role</option>
        {ROLES.map((r) => <option key={r}>{r}</option>)}
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

/** Your usual role on a project: your role on the project's team, else the role you used last on it, else your title, else the role you use most. */
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
    if (!d || !projectId) return ''
    const m = d.members.find((x) => x.project_id === projectId)?.role_label
    if (m) return m
    const last = d.recent.find((x) => x.project_id === projectId)?.role_label
    if (last) return last
    if (d.title && (ROLES as readonly string[]).includes(d.title)) return d.title
    const counts = new Map<string, number>(); d.recent.forEach((x) => { if (x.role_label) counts.set(x.role_label, (counts.get(x.role_label) ?? 0) + 1) })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  }
}

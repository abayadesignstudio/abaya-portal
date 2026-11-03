import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import './admin.css'

type FS = { digest_time: string; digest_enabled: boolean; reminder_days: number[]; late_rate_monthly: number; firm_name: string | null; address: string | null; phone: string | null; billing_email: string | null; check_payee: string | null }
type Person = { id: string; email: string; full_name: string | null; initials: string | null; title: string | null; role: 'admin' | 'staff' | 'client' | 'none'; util_target: number | null; bill_rate: number | null }
type Invite = { email: string; role: string; full_name: string | null; created_at: string }

export default function Settings() {
  const { profile } = useAuth()
  const admin = profile?.role === 'admin'
  return (
    <div className="stack">
      <h1>Settings</h1>
      <FirmSettings admin={admin} />
      {admin ? <People me={profile!.id} /> : <p className="muted">Only admins can manage people and invitations.</p>}
    </div>
  )
}

function FirmSettings({ admin }: { admin: boolean }) {
  const { data, error } = useLoad(async () => must(await supabase.from('firm_settings').select('digest_time, digest_enabled, reminder_days, late_rate_monthly, firm_name, address, phone, billing_email, check_payee').eq('id', 1).single()) as FS)
  const [f, setF] = useState<FS & { days: string } | null>(null)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  useEffect(() => { if (data) setF({ ...data, digest_time: data.digest_time.slice(0, 5), days: data.reminder_days.join(', ') }) }, [data])
  if (error) return <p className="err" role="alert">{error}</p>
  if (!f) return <p className="muted">Loading…</p>
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(''); setErr('')
    const days = f.days.split(/[,\s]+/).filter(Boolean).map(Number)
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 365)) return setErr('Reminder days must be whole numbers from 0 to 365, separated by commas.')
    const rate = Number(f.late_rate_monthly); if (!(rate >= 0 && rate <= 10)) return setErr('Late rate must be between 0 and 10 percent.')
    const t = (s: string | null) => (s ?? '').trim() || null
    const r = await supabase.from('firm_settings').update({ digest_time: f.digest_time, digest_enabled: f.digest_enabled, reminder_days: [...new Set(days)].sort((a, b) => a - b), late_rate_monthly: rate,
      firm_name: t(f.firm_name), address: t(f.address), phone: t(f.phone), billing_email: t(f.billing_email), check_payee: t(f.check_payee) }).eq('id', 1)
    if (r.error) setErr(r.error.message); else setMsg('Saved.')
  }
  const dis = !admin
  return (
    <form onSubmit={save} className="card pad stack">
      <h2>Firm</h2>
      <fieldset disabled={dis} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="formgrid">
          <div style={{ gridColumn: 'span 2' }}><label className="l" htmlFor="s-fn">Firm name (on invoices and emails)</label><input id="s-fn" className="input" value={f.firm_name ?? ''} onChange={(e) => setF({ ...f, firm_name: e.target.value })} placeholder="Abaya Design Studio" /></div>
          <div style={{ gridColumn: 'span 2' }}><label className="l" htmlFor="s-ad">Address</label><input id="s-ad" className="input" value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
          <div><label className="l" htmlFor="s-ph">Phone</label><input id="s-ph" type="tel" className="input" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div style={{ gridColumn: 'span 2' }}><label className="l" htmlFor="s-be">Billing email (replies go here)</label><input id="s-be" type="email" className="input" value={f.billing_email ?? ''} onChange={(e) => setF({ ...f, billing_email: e.target.value })} /></div>
          <div><label className="l" htmlFor="s-cp">Make checks payable to</label><input id="s-cp" className="input" value={f.check_payee ?? ''} onChange={(e) => setF({ ...f, check_payee: e.target.value })} /></div>
        </div>
        <h3 style={{ margin: '8px 0 0' }}>Emails and reminders</h3>
        <div className="formgrid">
          <div><label className="l" htmlFor="s-dt">Daily digest time</label><input id="s-dt" type="time" className="input" value={f.digest_time} onChange={(e) => setF({ ...f, digest_time: e.target.value })} /></div>
          <div style={{ alignSelf: 'end' }}><label className="row" style={{ gap: 8, minHeight: 44 }}><input type="checkbox" checked={f.digest_enabled} onChange={(e) => setF({ ...f, digest_enabled: e.target.checked })} style={{ width: 18, height: 18 }} />Send the daily digest</label></div>
          <div style={{ gridColumn: 'span 2' }}><label className="l" htmlFor="s-rd">Payment reminders — days after due date</label><input id="s-rd" className="input" aria-describedby="s-rd-h" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /><p id="s-rd-h" className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>For example 0, 7, 14, 21 — 0 means on the due date.</p></div>
          <div><label className="l" htmlFor="s-lr">Late charge (% per month)</label><input id="s-lr" className="input num" inputMode="decimal" value={String(f.late_rate_monthly)} onChange={(e) => setF({ ...f, late_rate_monthly: e.target.value as unknown as number })} /></div>
        </div>
      </fieldset>
      {err && <p className="err" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      {admin ? <div><button className="btn">Save firm settings</button></div> : <p className="muted">Only admins can change these.</p>}
    </form>
  )
}

function People({ me }: { me: string }) {
  const { data, error, reload } = useLoad(async () => {
    const people = must(await supabase.from('profiles').select('id, email, full_name, initials, title, role, util_target, bill_rate').in('role', ['admin', 'staff']).order('full_name')) as Person[]
    const invites = must(await supabase.from('invites').select('email, role, full_name, created_at').in('role', ['admin', 'staff']).order('created_at', { ascending: false })) as Invite[]
    return { people, invites: invites.filter((i) => !people.some((p) => p.email.toLowerCase() === i.email.toLowerCase())) }
  })
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('')
  const [inv, setInv] = useState({ email: '', full_name: '', role: 'staff' })
  const update = async (p: Person, patch: Partial<Person>) => {
    setErr(''); setMsg('')
    if (patch.role && p.id === me && patch.role !== 'admin') return setErr('You cannot remove your own admin access.')
    const r = await supabase.from('profiles').update(patch).eq('id', p.id)
    if (r.error) setErr(r.error.message); else { setMsg(`Updated ${p.full_name || p.email}.`); reload() }
  }
  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('')
    const email = inv.email.trim().toLowerCase(); if (!email) return setErr('Enter an email.')
    const r = await supabase.from('invites').upsert({ email, full_name: inv.full_name.trim() || null, role: inv.role as 'staff' | 'admin', client_id: null, invited_by: me })
    if (r.error) return setErr(r.error.message)
    setMsg(`${email} can now sign in with that email address.`); setInv({ email: '', full_name: '', role: 'staff' }); reload()
  }
  const revoke = async (i: Invite) => { const r = await supabase.from('invites').delete().eq('email', i.email); if (r.error) setErr(r.error.message); else reload() }
  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  return (
    <section className="card pad stack" aria-labelledby="people-h">
      <h2 id="people-h">People</h2>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="tablewrap">
        <table className="table" style={{ minWidth: 760 }}>
          <thead><tr><th>Name</th><th>Role</th><th className="r">Utilization target (%)</th><th className="r">Bill rate ($/hr)</th></tr></thead>
          <tbody>{data?.people.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.full_name || p.email}</strong><div className="muted" style={{ fontSize: 13 }}>{p.title ? `${p.title} · ` : ''}{p.email}</div></td>
              <td><label className="sr" htmlFor={`r-${p.id}`}>Role for {p.email}</label>
                <select id={`r-${p.id}`} className="input inline-select" value={p.role} onChange={(e) => update(p, { role: e.target.value as Person['role'] })}>
                  <option value="staff">Staff</option><option value="admin">Admin</option><option value="none">No access</option></select></td>
              <td className="r"><label className="sr" htmlFor={`u-${p.id}`}>Utilization target for {p.email}</label>
                <input id={`u-${p.id}`} className="input num" style={{ width: 90, textAlign: 'right' }} inputMode="decimal" defaultValue={p.util_target ?? ''} onBlur={(e) => { const v = num(e.target.value); if (v !== p.util_target) update(p, { util_target: v }) }} /></td>
              <td className="r"><label className="sr" htmlFor={`b-${p.id}`}>Bill rate for {p.email}</label>
                <input id={`b-${p.id}`} className="input num" style={{ width: 100, textAlign: 'right' }} inputMode="decimal" defaultValue={p.bill_rate ?? ''} onBlur={(e) => { const v = num(e.target.value); if (v !== p.bill_rate) update(p, { bill_rate: v }) }} /></td>
            </tr>))}</tbody>
        </table>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      <h3 style={{ margin: '8px 0 0' }}>Invite a team member</h3>
      <form onSubmit={sendInvite} className="row" style={{ alignItems: 'flex-end' }}>
        <div><label className="l" htmlFor="i-n">Name</label><input id="i-n" className="input" value={inv.full_name} onChange={(e) => setInv({ ...inv, full_name: e.target.value })} /></div>
        <div><label className="l" htmlFor="i-e">Email</label><input id="i-e" type="email" required className="input" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></div>
        <div><label className="l" htmlFor="i-r">Role</label><select id="i-r" className="input" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
        <button className="btn">Invite</button>
      </form>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>Sign-in is invite-only. Once invited, they sign in with that email address. Clients are invited from the Clients page.</p>
      {data && data.invites.length > 0 && <>
        <h3 style={{ margin: '8px 0 0' }}>Waiting to sign in</h3>
        <table className="table"><tbody>{data.invites.map((i) => (
          <tr key={i.email}><td>{i.full_name || '—'}</td><td>{i.email}</td><td>{i.role === 'admin' ? 'Admin' : 'Staff'}</td>
            <td className="r"><button className="btn small secondary" onClick={() => revoke(i)}>Cancel invite</button></td></tr>))}</tbody></table>
      </>}
    </section>
  )
}

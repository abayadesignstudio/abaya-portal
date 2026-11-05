import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad, must } from '../lib/useQuery'
import { useRates, type Rate } from './budget/BudgetTab'
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
      {admin && <OnlinePayments />}
      {admin && <BillableRates />}
      {admin ? <People me={profile!.id} /> : <p className="muted">Only admins can manage people and invitations.</p>}
    </div>
  )
}

/** Firm rate table: roles and their rate levels. Project team members pick a role, then one of its rates. */
function BillableRates() {
  const rates = useRates()
  const [f, setF] = useState({ role: '', level: '', rate: '' })
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('')
  const list = rates.data ?? []
  const roles = [...new Set(list.map((r) => r.role))]
  const run = async (fn: () => Promise<void>, ok: string) => { try { await fn(); setErr(''); setMsg(ok); rates.reload() } catch (e) { setMsg(''); setErr(e instanceof Error ? e.message : String(e)) } }
  const add = (e: React.FormEvent) => {
    e.preventDefault()
    const role = f.role.trim(), rate = parseFloat(f.rate.replace(/[$,]/g, ''))
    if (!role || !(rate >= 0)) return setErr('Enter a role and a rate.')
    const sameRole = list.filter((r) => r.role === role)
    const level = f.level.trim() || `${role} ${sameRole.length + 1}`
    const sort = sameRole.length ? Math.max(...sameRole.map((r) => r.sort)) : (list.length ? Math.max(...list.map((r) => r.sort)) + 10 : 10)
    run(async () => { must(await supabase.from('billing_rates').insert({ role, level, rate, sort })); setF({ role: '', level: '', rate: '' }) }, `Added ${level}.`)
  }
  // changing a level's rate also updates the project team members who use that level
  const setRate = (r: Rate, v: string) => { const rate = parseFloat(v.replace(/[$,]/g, '')); if (!(rate >= 0) || rate === Number(r.rate)) return
    run(async () => { must(await supabase.from('billing_rates').update({ rate }).eq('id', r.id)); must(await supabase.from('project_members').update({ bill_rate: rate }).eq('rate_id', r.id)) }, `${r.level} is now $${rate.toFixed(2)}/hr, including on projects that use it.`) }
  const setLevel = (r: Rate, v: string) => { const level = v.trim(); if (!level || level === r.level) return
    run(async () => { must(await supabase.from('billing_rates').update({ level }).eq('id', r.id)) }, 'Renamed.') }
  const remove = (r: Rate) => { if (!window.confirm(`Remove ${r.level}? People on projects keep their current rate.`)) return
    run(async () => { must(await supabase.from('billing_rates').delete().eq('id', r.id)) }, `Removed ${r.level}.`) }
  return (
    <section className="card pad stack" aria-labelledby="br-h">
      <h2 id="br-h" style={{ margin: 0 }}>Billable rates</h2>
      <p className="muted" style={{ margin: 0 }}>Each role has one or more rate levels. On a project’s team, you pick a person’s role and then one of that role’s rates, so the two always match. Changing a rate here updates everyone on projects at that level.</p>
      {rates.error && <p className="err">{rates.error}</p>}
      <div className="br-grid">
        {roles.map((role) => <div key={role} className="br-role">
          <strong>{role}</strong>
          {list.filter((r) => r.role === role).map((r) => <div key={r.id} className="br-line">
            <input className="input" aria-label={`Name of ${r.level}`} defaultValue={r.level} onBlur={(e) => setLevel(r, e.target.value)} />
            <span className="br-money"><span aria-hidden="true">$</span><input className="input num" aria-label={`Rate for ${r.level}`} inputMode="decimal" defaultValue={Number(r.rate).toFixed(2)}
              onBlur={(e) => setRate(r, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /><span className="muted">/hr</span></span>
            <button type="button" className="linkbtn" style={{ color: 'var(--muted)', fontSize: 18 }} aria-label={`Remove ${r.level}`} onClick={() => remove(r)}>×</button>
          </div>)}
        </div>)}
      </div>
      <form onSubmit={add} className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
        <div><label className="l" htmlFor="br-r">Role</label><input id="br-r" className="input" list="br-roles" placeholder="e.g. Principal" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} />
          <datalist id="br-roles">{roles.map((r) => <option key={r} value={r} />)}</datalist></div>
        <div><label className="l" htmlFor="br-l">Level name (optional)</label><input id="br-l" className="input" placeholder={f.role ? `${f.role} ${list.filter((r) => r.role === f.role.trim()).length + 1}` : 'e.g. Principal 2'} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} /></div>
        <div style={{ width: 140 }}><label className="l" htmlFor="br-rate">Rate ($/hr)</label><input id="br-rate" className="input num" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
        <button className="btn secondary">+ Add rate</button>
      </form>
      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}{msg && <p className="ok" role="status" style={{ margin: 0 }}>{msg}</p>}
    </section>
  )
}

/** Stripe connection status for online invoice payments (the keys themselves live only in Supabase secrets). */
function OnlinePayments() {
  const [st, setSt] = useState<{ configured: boolean; webhook: boolean; mode: string | null } | null>(null)
  useEffect(() => {
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invoice-pay`, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string } })
      .then((r) => r.json()).then(setSt).catch(() => setSt({ configured: false, webhook: false, mode: null }))
  }, [])
  const ready = st?.configured && st.webhook
  return (
    <section className="card pad stack" aria-labelledby="op-h">
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 10, background: '#635bff', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', font: '700 22px Arial', flex: 'none' }}>S</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id="op-h" style={{ margin: 0 }}>Online payments {st && <span className="status" style={{ marginLeft: 6, color: '#fff', background: ready ? (st.mode === 'test' ? '#b54708' : '#0e7c66') : '#667085', fontSize: 12, verticalAlign: 3 }}>
            {ready ? (st.mode === 'test' ? 'Connected · test mode' : 'Connected') : st.configured ? 'Almost there' : 'Not connected'}</span>}</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Clients pay invoices by bank transfer (ACH) or card through Stripe. Payments are recorded on the invoice automatically, and you get a notification. Each invoice’s payment options and fee pass-through are set in the invoice builder.</p>
          {st && !ready && <p style={{ margin: '8px 0 0', fontSize: 14 }}>{st.configured
            ? <>Stripe is connected, but the webhook isn’t: add <code>STRIPE_WEBHOOK_SECRET</code> so payments mark invoices paid.</>
            : <>Add your Stripe keys to switch this on (steps in the “stripe-payments-setup” project doc). Until then, invoices show “Pay online — coming soon”.</>}</p>}
        </div>
        <a className="btn secondary small" href="https://dashboard.stripe.com/" target="_blank" rel="noreferrer">View Dashboard</a>
      </div>
    </section>
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

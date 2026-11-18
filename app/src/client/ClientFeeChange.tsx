import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, money } from '../lib/supabase'
import { useLoad, must } from '../lib/useQuery'
import { useAuth } from '../lib/auth'
import { CLink, usePreviewNav } from './preview'
import { AdoptDialog, type Adopted } from './ClientAgreement'
import { lineLabel, type FcLine } from '../staff/FeeChanges'

type Fc = { id: string; project_id: string; number: number; title: string; reason: string; lines: FcLine[]; total_from: number; total_to: number; status: string; doc_hash: string | null; sent_at: string | null; signed_at: string | null; projects: { number: string; name: string } | null }
type Sig = { signer_name: string; signer_title: string | null; signed_at: string; signature: string }

/** Client: review a fee change the firm sent and sign it. Nothing changes on the project until it's signed. */
export default function ClientFeeChange({ previewId }: { previewId?: string } = {}) {
  const params = useParams()
  const id = previewId ?? params.id!
  const pv = usePreviewNav() // staff preview: shows the page, but nothing is signed
  const { profile } = useAuth()
  const d = useLoad(async () => {
    const f = must(await supabase.from('fee_changes').select('id, project_id, number, title, reason, lines, total_from, total_to, status, doc_hash, sent_at, signed_at, projects(number, name)').eq('id', id).single()) as unknown as Fc
    const sig = f.status === 'signed' ? (await supabase.from('fee_change_signatures').select('signer_name, signer_title, signed_at, signature').eq('fee_change_id', id).maybeSingle()).data as Sig | null : null
    return { f, sig }
  }, [id])
  const [adopt, setAdopt] = useState(false)
  const [agree, setAgree] = useState(false)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  if (d.error) return <p className="err">{d.error}</p>
  if (!d.data) return <p>Loading…</p>
  const { f, sig } = d.data
  const delta = Number(f.total_to) - Number(f.total_from)
  const sign = async (a: Adopted) => {
    setAdopt(false)
    if (pv) return setErr('Preview only: the client signs this in their own portal.')
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('sign_fee_change', { p_id: f.id, p_hash: f.doc_hash, p_name: a.name, p_title: a.title, p_method: a.method, p_signature: a.sig })
    setBusy(false)
    if (error) return setErr(error.message)
    d.reload()
  }
  return <div className="stack" style={{ maxWidth: 820 }}>
    <CLink to={`/projects/${f.project_id}`} style={{ fontWeight: 700, textDecoration: 'none' }}>‹ {f.projects ? `${f.projects.number} · ${f.projects.name}` : 'Back to the project'}</CLink>
    <h1>{f.title}</h1>
    {f.status === 'signed'
      ? <p className="ok" role="status" style={{ margin: 0 }}>✓ Signed {f.signed_at ? new Date(f.signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}. The project’s fees now reflect this change.</p>
      : <p style={{ margin: 0 }}>Abaya Design Studio is asking for your approval of this change to the fee in your signed agreement. <strong>Nothing changes until you sign.</strong></p>}
    <section className="card pad stack">
      <h2 style={{ fontSize: 17 }}>Why the fee is changing</h2>
      <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{f.reason}</p>
    </section>
    <section className="card pad stack">
      <h2 style={{ fontSize: 17 }}>What changes</h2>
      <div style={{ overflowX: 'auto' }}><table className="table" style={{ minWidth: 0 }}>
        <thead><tr><th>Item</th><th className="r">Current fee</th><th className="r">New fee</th><th className="r">Difference</th></tr></thead>
        <tbody>{f.lines.map((l, i) => { const x = Number(l.to) - Number(l.from)
          return <tr key={i}><td>{lineLabel(l)}{l.billing === 'hourly' && <div className="muted" style={{ fontSize: 12.5 }}>Billed hourly, not to exceed this amount</div>}</td>
            <td className="r num muted">{l.phase_id ? money(l.from) : 'New'}</td><td className="r num"><strong>{money(l.to)}</strong></td>
            <td className="r num">{x >= 0 ? '+' : '−'}{money(Math.abs(x))}</td></tr> })}</tbody>
        <tfoot><tr><td><strong>Total project fee</strong></td><td className="r num muted">{money(f.total_from)}</td><td className="r num"><strong>{money(f.total_to)}</strong></td>
          <td className="r num"><strong>{delta >= 0 ? '+' : '−'}{money(Math.abs(delta))}</strong></td></tr></tfoot>
      </table></div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>All other terms of your signed agreement stay the same.</p>
    </section>
    {f.status === 'signed' && sig && <section className="card pad stack" aria-label="Signature">
      <img src={sig.signature} alt={`Signature of ${sig.signer_name}`} style={{ height: 60, maxWidth: 280, objectFit: 'contain', alignSelf: 'flex-start' }} />
      <span>{sig.signer_name}{sig.signer_title ? `, ${sig.signer_title}` : ''} · {new Date(sig.signed_at).toLocaleString('en-US')}</span>
    </section>}
    {f.status === 'sent' && <section className="card pad stack">
      <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 4 }} />
        <span>I have read this fee change and approve the new fee of <strong>{money(f.total_to)}</strong>. I agree to sign it electronically.</span></label>
      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div><button type="button" className="btn" disabled={!agree || busy} onClick={() => setAdopt(true)}>{busy ? 'Signing…' : 'Sign fee change'}</button></div>
    </section>}
    {adopt && <AdoptDialog defaultName={profile?.full_name ?? ''} defaultTitle="" onCancel={() => setAdopt(false)} onAdopt={sign} />}
  </div>
}

// Carry a calculator fee (FeeSeed) into a project's agreement: update its open draft, or start a new one.
// Used by the Proposals page and the phone's Fee calculator so both follow the same rules:
//  • one open agreement (draft or out for signature) per project at a time
//  • phases already in a signed agreement are left out of the next one
//  • a draft disconnected from the calculator is only overwritten after confirmation
import { supabase, money, PHASES } from './supabase'
import { agreementCodes } from './fees'
import { newDoc } from './agreementTemplate'
import type { FeeSeed } from './feeSeed'

type Proj = { id: string; number: string; name: string; address: string | null; category: string | null; categories: string[] | null; client_id: string | null
  clients: { name: string; phone: string | null; billing_email: string | null; address: string | null } | null; phases: { code: string; fee: number | null }[] | null }

export type ApplyResult = { id: string; created: boolean; note?: string } | { error: string } | { cancelled: true }

const nameOf = (c: string) => PHASES.find(([x]) => x === c)?.[1] ?? c

export async function applyFeeToProject(projectId: string, seed: FeeSeed | null, createdBy: string | null, confirm: (msg: string) => boolean): Promise<ApplyResult> {
  const { data: pr, error: pe } = await supabase.from('projects')
    .select('id, number, name, address, category, categories, client_id, clients(name, phone, billing_email, address), phases(code, fee)').eq('id', projectId).single()
  if (pe || !pr) return { error: pe?.message ?? 'That project wasn’t found.' }
  const p = pr as unknown as Proj
  const { data: rows, error: ae } = await supabase.from('agreements').select('id, status, doc, title').eq('project_id', p.id).neq('status', 'void')
  if (ae) return { error: ae.message }
  const all = (rows ?? []) as { id: string; status: string; doc: ReturnType<typeof newDoc>; title: string }[]

  const held = [...new Set(all.filter((x) => x.status === 'signed').flatMap((x) => agreementCodes({ split: x.doc.split ?? null, ph: x.doc.ph })))]
  let sd = seed
  if (sd && held.length) {
    const keep = sd.split.filter(([k]) => !held.includes(k))
    const amt = keep.map(([k, v]) => [k, sd!.fee * v / 100] as const), tot = Math.round(amt.reduce((a, [, x]) => a + x, 0) * 100) / 100
    if (!keep.length) return { error: `Every phase in this fee is already in a signed agreement on ${p.number}. Use Change fee on the project instead.` }
    sd = { ...sd, fee: tot, split: amt.map(([k, x]) => [k, Math.round(x / tot * 1e6) / 1e4] as [string, number]) }
  }

  const c = all.find((x) => x.status === 'draft' || x.status === 'sent') ?? null
  if (c?.status === 'sent') return { error: `${p.number}’s agreement (“${c.title}”) is out for the client’s signature. Unpublish it on the agreement page first, then apply this fee.` }
  if (c) {
    if (!sd) return { id: c.id, created: false, note: `${p.number} already has this open agreement; finish or sign it before starting the next.` }
    const d = c.doc
    if (d.detached && !confirm(`“${c.title}” was disconnected from the calculator, so its fee (${money(Number(d.v.fee) || 0)}) was set on the agreement. Replace it with ${money(sd.fee)} from “${sd.name || 'this calculation'}” and reconnect?`)) return { cancelled: true }
    d.detached = false; d.source = { estimateId: sd.estimateId, name: sd.name, fee: sd.fee }
    d.v.fee = String(sd.fee)
    if (sd.sf > 0 && !d.v.projSize) d.v.projSize = `${sd.sf.toLocaleString()} SF`
    const S = sd
    Object.keys(d.ph).forEach((k) => { d.ph[k].on = S.split.some(([u]) => u === k) })
    d.split = Object.fromEntries(sd.split.map(([k, v]) => [k, String(v)]))
    // keep the draft's payment grouping when it already has one; otherwise one payment per phase
    if (!d.pay?.some((x) => (x.phases?.length ?? 0) > 1) || d.pay.reduce((a, x) => a + (+x.pct || 0), 0) !== 100)
      d.pay = sd.split.map(([k, v], i) => ({ label: `Payment ${i + 1}`, due: `Due at completion of ${nameOf(k)}`, phase: nameOf(k), pct: String(v), phases: [k] }))
    else d.pay = d.pay.map((x) => ({ ...x, pct: String(Math.round((x.phases ?? []).reduce((a, k) => a + (S.split.find(([u]) => u === k)?.[1] ?? 0), 0) * 100) / 100) }))
    const { error } = await supabase.from('agreements').update({ doc: d, total_fee: sd.fee, updated_at: new Date().toISOString() }).eq('id', c.id)
    if (error) return { error: error.message }
    return { id: c.id, created: false, note: `Updated this draft with the new fee: phases on ${p.number} follow it.` }
  }

  const fees = Object.fromEntries((p.phases ?? []).filter((ph) => Number(ph.fee) > 0 && !held.includes(ph.code)).map((ph) => [ph.code, Number(ph.fee)]))
  const doc = newDoc({
    projName: p.name, projAddr: p.address ?? '', projType: (p.categories ?? []).join(',') || p.category || 'S',
    ownerName: p.clients?.name ?? '', ownerPhone: p.clients?.phone ?? '', ownerEmail: p.clients?.billing_email ?? '', ownerAddr: p.clients?.address ?? '',
  }, fees)
  if (sd) { // the calculator's fee, phases and one payment per phase replace the project's phase fees
    doc.v.fee = String(sd.fee)
    if (sd.sf > 0 && !doc.v.projSize) doc.v.projSize = `${sd.sf.toLocaleString()} SF`
    const S2 = sd
    Object.keys(doc.ph).forEach((k) => { doc.ph[k].on = S2.split.some(([u]) => u === k) })
    doc.split = Object.fromEntries(sd.split.map(([k, v]) => [k, String(v)]))
    doc.source = { estimateId: sd.estimateId, name: sd.name, fee: sd.fee }
    doc.pay = sd.split.map(([k, v], i) => ({ label: `Payment ${i + 1}`, due: `Due at completion of ${nameOf(k)}`, phase: nameOf(k), pct: String(v), phases: [k] }))
  }
  const { data, error } = await supabase.from('agreements').insert({
    title: held.length ? `${p.name} — Proposal (${PHASES.map(([k]) => k).filter((k) => doc.ph[k]?.on).join(', ')})` : `${p.name} — Proposal`, project_id: p.id, client_id: p.client_id ?? null,
    doc, total_fee: +doc.v.fee || 0, created_by: createdBy,
  }).select('id').single()
  if (error) return { error: error.message }
  return { id: (data as { id: string }).id, created: true }
}

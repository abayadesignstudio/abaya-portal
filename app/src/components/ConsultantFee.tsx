import { useEffect, useState } from 'react'
import { supabase, money } from '../lib/supabase'

/** The firm's default consultant multiplier (Settings → Firm). Falls back to 1.15. */
export function useConsultantMultiplier() {
  const [m, setM] = useState(1.15)
  useEffect(() => {
    let on = true
    void supabase.from('firm_settings').select('consultant_multiplier').eq('id', 1).maybeSingle()
      .then(({ data }) => { const v = Number((data as { consultant_multiplier?: number } | null)?.consultant_multiplier); if (on && v >= 1) setM(v) })
    return () => { on = false }
  }, [])
  return m
}

/** "Consultant's service" helper: their bill × the multiplier → the fee the owner pays.
 *  Their bill is only used to work out the fee; it isn't saved anywhere the client can read. */
export default function ConsultantFee({ id, onFee }: { id: string; onFee: (fee: string) => void }) {
  const dflt = useConsultantMultiplier()
  const [cost, setCost] = useState(''); const [mult, setMult] = useState('')
  const m = Number(mult || dflt), c = Number(cost)
  const fee = c > 0 && m >= 1 ? Math.round(c * m * 100) / 100 : 0
  useEffect(() => { if (fee) onFee(String(fee)) }, [fee]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', background: '#f6f8fb', border: '1px solid #dfe5ee', borderRadius: 8, padding: '8px 10px' }}>
    <div><label className="l" htmlFor={id + '-c'}>Consultant’s fee to you</label><input id={id + '-c'} className="input num" style={{ width: 130 }} inputMode="decimal" placeholder="$" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
    <span style={{ paddingBottom: 10 }}>×</span>
    <div><label className="l" htmlFor={id + '-m'}>Multiplier</label><input id={id + '-m'} className="input num" style={{ width: 80 }} inputMode="decimal" placeholder={String(dflt)} value={mult} onChange={(e) => setMult(e.target.value)} /></div>
    <span style={{ paddingBottom: 10 }}>=</span>
    <div style={{ paddingBottom: 10 }}><strong className="num">{fee ? money(fee) : '—'}</strong> <span className="muted" style={{ fontSize: 12 }}>to the owner{fee ? ` (${money(fee - c)} for coordination)` : ''}</span></div>
    <p className="muted" style={{ margin: 0, fontSize: 12, flexBasis: '100%' }}>Fills in the fee. The consultant’s own fee isn’t saved, so the client never sees your markup.</p>
  </div>
}

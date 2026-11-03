import { PHASES, PHASE_NAME } from '../lib/supabase'
import { PHASE_STYLE, type PhaseRow } from '../lib/projectContent'

/** 7-phase stepper. Full names on wide screens, CE/SD/… on narrow ones. Phases not in the contract are dashed. */
export default function PhaseStepper({ phases }: { phases: Pick<PhaseRow, 'code' | 'status'>[] }) {
  const by = Object.fromEntries(phases.map((p) => [p.code, p]))
  return (
    <ol className="stepper" aria-label="Project phases">
      {PHASES.map(([code]) => {
        const p = by[code]
        const st = p ? PHASE_STYLE[p.status] ?? PHASE_STYLE.not_started : null
        return (
          <li key={code} aria-label={`${PHASE_NAME[code]}: ${p ? st!.label : 'not in contract'}`}>
            <span className="dot" style={{ background: st ? st.bg : 'transparent', color: st ? st.fg : '#c9c4b8', borderColor: st ? st.border : '#d6d1c6', borderStyle: p ? 'solid' : 'dashed' }}>{code}</span>
            <span className="lbl full" style={{ color: p ? 'var(--text)' : '#98a2b3' }}>{PHASE_NAME[code]}</span>
            <span className="lbl abbr" style={{ color: p ? 'var(--text)' : '#98a2b3' }}>{code}</span>
          </li>)
      })}
    </ol>
  )
}

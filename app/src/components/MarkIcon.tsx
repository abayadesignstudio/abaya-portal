/** Item icons shared by the Projects timeline and the Home calendar:
 *  task = red circle with a ringed check (grey when done), milestone = map pin, deliverable = paper airplane, event = calendar.
 *  Colours come from CSS variables on a parent: --mc (outline colour, e.g. the project's sector colour) and --pin (milestone fill). */
export type MarkKind = 'milestone' | 'deliverable' | 'task' | 'event'

export default function MarkIcon({ kind, done, size = 22 }: { kind: MarkKind; done: boolean; size?: number }) {
  const s = size
  // task: Google's red circle with a white ringed check; grey once it's done
  if (kind === 'task') return <svg viewBox="0 0 24 24" width={s} height={s} aria-hidden="true"><circle cx="12" cy="12" r="11" fill={done ? '#9aa0a6' : '#e8233b'} /><circle cx="12" cy="12" r="6.6" fill="none" stroke="#fff" strokeWidth="1.8" /><path d="M9.1 12.1l2.1 2.1 3.9-4.1" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
  // milestone: a map pin (white hole while open, a check once reached)
  if (kind === 'milestone') return <svg viewBox="0 0 24 30" width={Math.round(s * 20 / 22)} height={Math.round(s * 25 / 22)} aria-hidden="true"><path d="M12 28.5C12 28.5 3 18.6 3 11.5a9 9 0 0 1 18 0c0 7.1-9 17-9 17z" fill="var(--pin)" stroke="#1c1f23" strokeWidth="2" strokeLinejoin="round" />{done ? <path d="M8.2 11.6l2.6 2.6 5-5.2" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /> : <circle cx="12" cy="11.5" r="3.6" fill="#fff" stroke="#1c1f23" strokeWidth="2" />}</svg>
  // deliverable: a paper airplane (sent off); filled once it's delivered
  if (kind === 'deliverable') return <svg viewBox="0 0 24 24" width={s} height={s} aria-hidden="true"><circle cx="12" cy="12" r="11" fill={done ? 'var(--mc)' : '#fff'} stroke="var(--mc)" strokeWidth="1.6" /><path d="M17.6 6.4L5.8 11.2l4.4 1.7 1.7 4.4z M17.6 6.4l-7.4 6.5" fill={done ? '#fff' : 'none'} stroke={done ? '#fff' : 'var(--mc)'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />{done && <path d="M17.6 6.4l-7.4 6.5" stroke="var(--mc)" strokeWidth="1.3" strokeLinecap="round" />}</svg>
  // event: a calendar page
  return <svg viewBox="0 0 24 24" width={s} height={s} aria-hidden="true"><circle cx="12" cy="12" r="11" fill={done ? 'var(--mc)' : '#fff'} stroke="var(--mc)" strokeWidth="1.6" /><rect x="7" y="8" width="10" height="9" rx="1.5" fill="none" stroke={done ? '#fff' : 'var(--mc)'} strokeWidth="1.5" /><path d="M7 11h10M9.5 6.5v3M14.5 6.5v3" stroke={done ? '#fff' : 'var(--mc)'} strokeWidth="1.5" strokeLinecap="round" /></svg>
}

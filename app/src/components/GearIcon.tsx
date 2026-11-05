// A toothed gear like the iPhone Settings icon: an outer cog with many fine teeth, a hollow middle and an inner hub.
const TEETH = 18
const gear = (() => {
  const pts: string[] = []
  const rO = 11.2, rI = 9.4 // tooth tips, roots
  for (let i = 0; i < TEETH; i++) {
    const a = (i / TEETH) * Math.PI * 2, w = (Math.PI * 2) / TEETH
    for (const [r, t] of [[rI, -0.5], [rO, -0.22], [rO, 0.22], [rI, 0.5]] as const) {
      const ang = a + t * w
      pts.push(`${(12 + r * Math.cos(ang)).toFixed(2)},${(12 + r * Math.sin(ang)).toFixed(2)}`)
    }
  }
  return `M${pts.join('L')}Z`
})()

export default function GearIcon({ size = 18, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {/* the cog, with its middle cut out (evenodd), then a hub with spokes like Apple's */}
      <path d={`${gear} M12,5.6a6.4,6.4 0 1,0 0.01,0Z`} fill="currentColor" fillRule="evenodd" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      {[0, 60, 120, 180, 240, 300].map((d) => <rect key={d} x="11.35" y="6.4" width="1.3" height="4" rx=".6" fill="currentColor" transform={`rotate(${d} 12 12)`} />)}
    </svg>
  )
}

// Round profile picture, or initials in a circle when there's no photo. Use this anywhere a person's circle appears.
export const initialsOf = (name: string | null | undefined, initials?: string | null) =>
  initials || (name || '?').split(/[\s@]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

/** size: inline size in px; className: let CSS size it instead (e.g. "pb-avatar"). */
export default function Avatar({ url, name, initials, size = 36, ring, className }: { url?: string | null; name?: string | null; initials?: string | null; size?: number; ring?: string; className?: string }) {
  if (className) return url
    ? <img src={url} alt="" aria-hidden="true" className={className + ' av-img'} />
    : <span aria-hidden="true" className={className}>{initialsOf(name, initials)}</span>
  const style = { width: size, height: size, borderRadius: '50%', flex: 'none', border: ring ? `1px solid ${ring}` : undefined } as const
  return url
    ? <img src={url} alt="" aria-hidden="true" width={size} height={size} style={{ ...style, objectFit: 'cover', display: 'block', background: '#ddd' }} />
    : <span aria-hidden="true" style={{ ...style, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.38), fontWeight: 700, background: ring ? 'transparent' : 'var(--navy)', color: ring ? 'inherit' : '#fff' }}>{initialsOf(name, initials)}</span>
}

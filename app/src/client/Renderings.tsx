import { useEffect, useRef, useState } from 'react'

/** Client renderings gallery: fit-to-screen image, zoom (wheel / pinch / double-click), drag to pan,
 *  full-screen mode, arrows and a counter (no thumbnails). */
export default function Renderings({ images }: { images: { name: string; url: string }[] }) {
  const [i, setI] = useState(0)
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 }) // scale and offset (px) relative to "fit"
  const [full, setFull] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; s: number } | null>(null)

  useEffect(() => { if (i >= images.length) setI(0) }, [images.length, i])
  useEffect(() => { setZ({ s: 1, x: 0, y: 0 }) }, [i, full])
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  // wheel needs a non-passive listener to stop the page scrolling
  useEffect(() => {
    const el = box.current; if (!el) return
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)) }
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel)
  })

  if (!images.length) return <div className="mv"><div className="mv-msg" style={{ textAlign: 'center', padding: 24 }}>Renderings will appear here once they’re published.</div></div>
  const go = (d: number) => setI((x) => (x + d + images.length) % images.length)
  const cur = images[Math.min(i, images.length - 1)]
  const label = (n: string) => n.replace(/\.\w+$/, '').replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ')

  function zoomAt(cx: number, cy: number, f: number) {
    const r = box.current!.getBoundingClientRect()
    const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2)
    setZ((o) => {
      const s = Math.min(8, Math.max(0.4, o.s * f)); const k = s / o.s
      // at or below fit, keep it centred (zooming out leaves space around the whole image)
      if (s <= 1) return { s, x: 0, y: 0 }
      return { s, x: px - (px - o.x) * k, y: py - (py - o.y) * k }
    })
  }
  const fit = () => setZ({ s: 1, x: 0, y: 0 })
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen(); else root.current?.requestFullscreen?.() }

  const down = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pts.current.size === 2) { const [a, b] = [...pts.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: z.s }; drag.current = null }
    else drag.current = { x: e.clientX, y: e.clientY, ox: z.x, oy: z.y }
  }
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pts.current.size === 2) {
      const [a, b] = [...pts.current.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y)
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.current.s * d / pinch.current.d) / z.s)
    } else if (drag.current && z.s > 1) {
      setZ((o) => ({ ...o, x: drag.current!.ox + e.clientX - drag.current!.x, y: drag.current!.oy + e.clientY - drag.current!.y }))
    }
  }
  const up = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); if (pts.current.size < 2) pinch.current = null; drag.current = null }

  return (
    <div ref={root} className={'rg' + (full ? ' full' : '')} tabIndex={0} onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); if (e.key === 'f' || e.key === 'F') toggleFull(); if (e.key === '0') fit() }}>
      <div ref={box} className={'rg-main' + (z.s > 1 ? ' zoomed' : '')} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={(e) => (Math.abs(z.s - 1) > 0.01 ? fit() : zoomAt(e.clientX, e.clientY, 2.5))}>
        <img src={cur.url} alt={label(cur.name)} draggable={false} style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }} />
        {images.length > 1 && <><button type="button" className="rg-nav l" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(-1)} aria-label="Previous rendering">‹</button>
          <button type="button" className="rg-nav r" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(1)} aria-label="Next rendering">›</button></>}
        <div className="rg-tools" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.5)} aria-label="Zoom out" disabled={z.s <= 0.4}>−</button>
          <button type="button" onClick={fit} className={Math.abs(z.s - 1) < 0.01 ? 'on' : ''}>Fit</button>
          <button type="button" onClick={() => { const r = box.current!.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.5) }} aria-label="Zoom in">+</button>
          <button type="button" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'} title="Full screen (F)">{full ? '⤡' : '⤢'}</button>
        </div>
        <span className="rg-count">{i + 1} / {images.length}</span>
      </div>
    </div>
  )
}

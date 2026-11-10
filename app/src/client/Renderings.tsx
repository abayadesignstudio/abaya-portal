import { useEffect, useRef, useState } from 'react'

/** Client renderings gallery: fit-to-panel image, smooth zoom (wheel / pinch / double-click / buttons),
 *  drag to pan, full-screen mode, arrows and a counter.
 *  Zoom and pan run outside React (direct style updates eased per animation frame) so they stay smooth. */
const MIN = 0.4, MAX = 8
export default function Renderings({ images }: { images: { name: string; url: string }[] }) {
  const [i, setI] = useState(0)
  const [full, setFull] = useState(false)
  const [fitOn, setFitOn] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const root = useRef<HTMLDivElement>(null)
  // current (drawn) and target view; the frame loop eases cur → tgt
  const cur = useRef({ s: 1, x: 0, y: 0 })
  const tgt = useRef({ s: 1, x: 0, y: 0 })
  const raf = useRef(0)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; s: number } | null>(null)

  const paint = () => {
    const c = cur.current
    if (img.current) img.current.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.s})`
    if (box.current) box.current.classList.toggle('zoomed', c.s > 1.001)
  }
  const tick = () => {
    const c = cur.current, t = tgt.current
    const k = 0.28 // easing per frame
    c.s += (t.s - c.s) * k; c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k
    const done = Math.abs(t.s - c.s) < 0.001 && Math.abs(t.x - c.x) < 0.3 && Math.abs(t.y - c.y) < 0.3
    if (done) { c.s = t.s; c.x = t.x; c.y = t.y }
    paint()
    raf.current = done ? 0 : requestAnimationFrame(tick)
  }
  const kick = (instant = false) => {
    if (instant) { Object.assign(cur.current, tgt.current); paint(); return }
    if (!raf.current) raf.current = requestAnimationFrame(tick)
  }
  const setTarget = (s: number, x: number, y: number, instant = false) => {
    s = Math.min(MAX, Math.max(MIN, s))
    if (s <= 1) { x = 0; y = 0 } // at or below fit the image stays centred
    tgt.current = { s, x, y }
    setFitOn(Math.abs(s - 1) < 0.01)
    kick(instant)
  }
  const zoomAt = (cx: number, cy: number, f: number) => {
    const r = box.current!.getBoundingClientRect()
    const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2)
    const t = tgt.current; const s = Math.min(MAX, Math.max(MIN, t.s * f)); const k = s / t.s
    setTarget(s, px - (px - t.x) * k, py - (py - t.y) * k)
  }
  const zoomCentre = (f: number) => { const r = box.current!.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f) }
  const fit = () => setTarget(1, 0, 0)

  useEffect(() => { if (i >= images.length) setI(0) }, [images.length, i])
  useEffect(() => { setTarget(1, 0, 0, true) }, [i, full]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  // preload the neighbours so arrowing through is instant
  useEffect(() => { for (const d of [1, -1]) { const im = images[(i + d + images.length) % images.length]; if (im) { const p = new Image(); p.decoding = 'async'; p.src = im.url } } }, [i, images])
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  // wheel needs a non-passive listener so the page doesn't scroll while zooming
  useEffect(() => {
    const el = box.current; if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY // lines → px
      zoomAt(e.clientX, e.clientY, Math.exp(-Math.max(-300, Math.min(300, d)) * 0.0022))
    }
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel)
  }, [images.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!images.length) return <div className="mv"><div className="mv-msg" style={{ textAlign: 'center', padding: 24 }}>Renderings will appear here once they’re published.</div></div>
  const go = (d: number) => setI((x) => (x + d + images.length) % images.length)
  const shown = images[Math.min(i, images.length - 1)]
  const label = (n: string) => n.replace(/\.\w+$/, '').replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ')
  const toggleFull = () => {
    const p = document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen?.()
    p?.catch(() => { /* browser refused full screen */ })
  }

  const down = (e: React.PointerEvent) => {
    box.current?.setPointerCapture?.(e.pointerId)
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pts.current.size === 2) { const [a, b] = [...pts.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: tgt.current.s }; drag.current = null }
    else drag.current = { x: e.clientX, y: e.clientY, ox: tgt.current.x, oy: tgt.current.y }
  }
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pts.current.size === 2) {
      const [a, b] = [...pts.current.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y)
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.current.s * d / pinch.current.d) / tgt.current.s)
    } else if (drag.current && tgt.current.s > 1) {
      // panning follows the pointer exactly (no easing lag)
      setTarget(tgt.current.s, drag.current.ox + e.clientX - drag.current.x, drag.current.oy + e.clientY - drag.current.y, true)
    }
  }
  const up = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); if (pts.current.size < 2) pinch.current = null; drag.current = null }

  return (
    <div ref={root} className={'rg' + (full ? ' full' : '')} tabIndex={0} onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); if (e.key === 'f' || e.key === 'F') toggleFull(); if (e.key === '0') fit(); if (e.key === '+' || e.key === '=') zoomCentre(1.5); if (e.key === '-') zoomCentre(1 / 1.5) }}>
      <div ref={box} className="rg-main" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={(e) => (Math.abs(tgt.current.s - 1) > 0.01 ? fit() : zoomAt(e.clientX, e.clientY, 2.5))}>
        <img ref={img} key={shown.url} src={shown.url} alt={label(shown.name)} draggable={false} decoding="async" />
        {images.length > 1 && <><button type="button" className="rg-nav l" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onClick={() => go(-1)} aria-label="Previous rendering">‹</button>
          <button type="button" className="rg-nav r" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onClick={() => go(1)} aria-label="Next rendering">›</button></>}
        <div className="rg-tools" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => zoomCentre(1 / 1.5)} aria-label="Zoom out">−</button>
          <button type="button" onClick={fit} className={fitOn ? 'on' : ''}>Fit</button>
          <button type="button" onClick={() => zoomCentre(1.5)} aria-label="Zoom in">+</button>
          <button type="button" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'} title="Full screen (F)">{full ? '⤡' : '⤢'}</button>
        </div>
        <span className="rg-count">{i + 1} / {images.length}</span>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'

/** Client renderings gallery: large image, arrows, thumbnails. */
export default function Renderings({ images }: { images: { name: string; url: string }[] }) {
  const [i, setI] = useState(0)
  useEffect(() => { if (i >= images.length) setI(0) }, [images.length, i])
  if (!images.length) return <div className="mv"><div className="mv-msg" style={{ textAlign: 'center', padding: 24 }}>Renderings will appear here once they’re published.</div></div>
  const go = (d: number) => setI((x) => (x + d + images.length) % images.length)
  const cur = images[Math.min(i, images.length - 1)]
  const label = (n: string) => n.replace(/\.\w+$/, '').replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ')
  return (
    <div className="rg" tabIndex={0} onKeyDown={(e) => { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1) }} onContextMenu={(e) => e.preventDefault()}>
      <div className="rg-main">
        <img src={cur.url} alt={label(cur.name)} draggable={false} />
        {images.length > 1 && <><button type="button" className="rg-nav l" onClick={() => go(-1)} aria-label="Previous rendering">‹</button>
          <button type="button" className="rg-nav r" onClick={() => go(1)} aria-label="Next rendering">›</button></>}
        <span className="rg-count">{i + 1} / {images.length}</span>
      </div>
      {images.length > 1 && <div className="rg-thumbs">{images.map((im, k) => <button key={im.name} type="button" className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={label(im.name)}><img src={im.url} alt="" draggable={false} loading="lazy" /></button>)}</div>}
    </div>
  )
}

import { KIND_LABEL, fmtDate, type Update } from '../lib/projectContent'

export default function UpdateCard({ u, urls, onDelete }: { u: Update; urls: Record<string, string>; onDelete?: () => void }) {
  return (
    <article className="card pad stack" style={{ gap: 8 }}>
      <div className="row between">
        <div className="row" style={{ gap: 8 }}><span className="pill">{KIND_LABEL[u.kind] ?? u.kind}</span>{u.title && <strong>{u.title}</strong>}
          {!u.visible_to_client && <span className="pill" style={{ borderColor: '#e4b4ad', color: 'var(--red)' }}>Staff only</span>}</div>
        <span className="muted" style={{ fontSize: 13 }}>{u.profiles?.full_name ?? 'Abaya Design Studio'} · {fmtDate(u.created_at)}</span>
      </div>
      {u.body && <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{u.body}</p>}
      {u.items.length > 0 && <ul style={{ margin: 0, paddingLeft: 20 }}>{u.items.map((it, i) => <li key={i}>{it}</li>)}</ul>}
      {u.photo_paths.length > 0 && <div className="row" style={{ gap: 8 }}>{u.photo_paths.map((p) => urls[p]
        ? <a key={p} href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="Project photo" style={{ width: 160, height: 120, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} /></a>
        : <span key={p} style={{ width: 160, height: 120, borderRadius: 6, background: '#ece9e3' }} />)}</div>}
      {onDelete && <div><button type="button" className="btn small danger" onClick={onDelete}>Delete</button></div>}
    </article>
  )
}


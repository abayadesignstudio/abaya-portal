import { useCallback, useEffect, useState } from 'react'

// Tiny data hook: runs an async loader, exposes data/error/reload
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps)
  const reload = useCallback(async () => {
    setLoading(true)
    try { setData(await run()); setError(null) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setLoading(false)
  }, [run])
  useEffect(() => { reload() }, [reload])
  return { data, error, loading, reload, setData }
}

export function must<T>(r: { data: T | null; error: { message: string } | null }): NonNullable<T> {
  if (r.error) throw new Error(r.error.message)
  return r.data as NonNullable<T>
}

import { useState } from 'react'

/** useState that remembers its value in this browser (localStorage), so a page reopens the way it was left. */
export function useRemembered(key: string, initial: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => { try { return localStorage.getItem(key) ?? initial } catch { return initial } })
  const set = (x: string) => { setV(x); try { localStorage.setItem(key, x) } catch { /* private mode */ } }
  return [v, set]
}

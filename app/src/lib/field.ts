/** Field tools for the phone: GPS trips (miles + site stops) and audio recording.
 *  In the iPhone app these run natively (keep going with the phone locked); in a browser they fall back to
 *  the web APIs, which only work while the page is open. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { isNativeApp, onNative, toNative } from './native'
import { supabase } from './supabase'

export type Stop = { lat: number; lng: number; address: string; arrived: string; left: string }
export type TripResult = { started: string; ended: string; miles: number; stops: Stop[]; route: number[][] }
export type GpsState = { on: boolean; miles: number; since: string | null; error?: string }
export type RecState = { on: boolean; since: string | null; purpose: 'conversation' | 'dictation'; error?: string }
/** What a finished recording becomes: an uploaded file in the recordings bucket. */
export type Uploaded = { path: string; seconds: number; purpose: 'conversation' | 'dictation' }

const R = 6371000 / 1609.344 // earth radius in miles
const milesBetween = (a: GeolocationCoordinates | { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const t = (d: number) => d * Math.PI / 180
  const dl = t(b.latitude - a.latitude), dn = t(b.longitude - a.longitude)
  const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a.latitude)) * Math.cos(t(b.latitude)) * Math.sin(dn / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ---- browser fallbacks (module singletons so every component sees the same session)
let webWatch: number | null = null
let webTrip: { started: string; miles: number; last: GeolocationCoordinates | null; route: number[][]; anchor: GeolocationCoordinates | null; since: number; stops: Stop[] } | null = null
let webRec: { rec: MediaRecorder; chunks: Blob[]; started: number; purpose: RecState['purpose']; type: string } | null = null

export function useField(me: string) {
  const [gps, setGps] = useState<GpsState>({ on: false, miles: 0, since: null })
  const [rec, setRec] = useState<RecState>({ on: false, since: null, purpose: 'conversation' })
  const [trip, setTrip] = useState<TripResult | null>(null)          // finished trip waiting to be saved
  const [uploaded, setUploaded] = useState<Uploaded | null>(null)    // finished recording, uploaded
  const [action, setAction] = useState<string | null>(null)          // widget tapped: timer | voice | record | trip
  const [uploading, setUploading] = useState(false)
  const pendingPath = useRef<string | null>(null)
  const native = isNativeApp()

  useEffect(() => {
    if (!native) return
    const off = onNative((m) => {
      if (m.type === 'gps') setGps((g) => m.error ? { ...g, error: m.error } : { on: !!m.on, miles: Number(m.miles) || 0, since: m.since ?? null })
      else if (m.type === 'gps-done') setTrip({ started: m.started, ended: m.ended, miles: Number(m.miles) || 0, stops: m.stops ?? [], route: m.route ?? [] })
      else if (m.type === 'record') setRec((r) => m.error ? { ...r, error: m.error } : { on: !!m.on, since: m.since ?? null, purpose: m.purpose === 'dictation' ? 'dictation' : 'conversation' })
      else if (m.type === 'record-done') {
        setUploading(false)
        if (m.ok) setUploaded({ path: m.path, seconds: Number(m.seconds) || 0, purpose: m.purpose === 'dictation' ? 'dictation' : 'conversation' })
        else setRec((r) => ({ ...r, error: m.error || 'Upload failed.' }))
      } else if (m.type === 'action') setAction(String(m.action))
    })
    toNative({ type: 'ready' })
    return off
  }, [native])

  const startTrip = useCallback(() => {
    setGps((g) => ({ ...g, error: undefined }))
    if (native) return toNative({ type: 'gps', action: 'start' })
    if (!('geolocation' in navigator)) return setGps((g) => ({ ...g, error: 'This browser has no location.' }))
    webTrip = { started: new Date().toISOString(), miles: 0, last: null, route: [], anchor: null, since: Date.now(), stops: [] }
    webWatch = navigator.geolocation.watchPosition((p) => {
      const t = webTrip; if (!t || p.coords.accuracy > 50) return
      if (t.last) { const d = milesBetween(t.last, p.coords); if (d < 1.25) t.miles += d }
      t.last = p.coords
      t.route.push([p.coords.latitude, p.coords.longitude, Math.round(p.timestamp / 1000)])
      if (t.anchor && milesBetween(t.anchor, p.coords) < 0.075) {
        if (p.timestamp - t.since >= 300000) {
          const s = t.stops[t.stops.length - 1]
          if (s && Date.now() - new Date(s.left).getTime() < 600000) s.left = new Date(p.timestamp).toISOString()
          else t.stops.push({ lat: t.anchor.latitude, lng: t.anchor.longitude, address: '', arrived: new Date(t.since).toISOString(), left: new Date(p.timestamp).toISOString() })
        }
      } else { t.anchor = p.coords; t.since = p.timestamp }
      setGps({ on: true, miles: Math.round(t.miles * 10) / 10, since: t.started })
    }, (e) => setGps((g) => ({ ...g, error: e.message })), { enableHighAccuracy: true, maximumAge: 5000 })
    setGps({ on: true, miles: 0, since: webTrip.started })
  }, [native])

  const stopTrip = useCallback(() => {
    if (native) return toNative({ type: 'gps', action: 'stop' })
    if (webWatch != null) navigator.geolocation.clearWatch(webWatch)
    webWatch = null
    const t = webTrip; webTrip = null
    setGps({ on: false, miles: 0, since: null })
    if (t) setTrip({ started: t.started, ended: new Date().toISOString(), miles: Math.round(t.miles * 100) / 100, stops: t.stops, route: t.route.filter((_, i) => i % 5 === 0).slice(-2000) })
  }, [native])

  const startRec = useCallback(async (purpose: RecState['purpose']) => {
    setRec((r) => ({ ...r, error: undefined })); setUploaded(null)
    if (native) return toNative({ type: 'record', action: 'start', purpose })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
      const r = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 24000 })
      webRec = { rec: r, chunks: [], started: Date.now(), purpose, type: r.mimeType || type }
      r.ondataavailable = (e) => { if (e.data.size) webRec?.chunks.push(e.data) }
      r.start(1000)
      setRec({ on: true, since: new Date().toISOString(), purpose })
    } catch (e) { setRec((x) => ({ ...x, error: (e as Error).message || 'Microphone unavailable.' })) }
  }, [native])

  /** Stop and upload to recordings/<me>/<uuid>; `uploaded` is set when it's in storage. */
  const stopRec = useCallback(async () => {
    setUploading(true)
    if (native) {
      const path = `${me}/${crypto.randomUUID()}.m4a`
      const { data, error } = await supabase.storage.from('recordings').createSignedUploadUrl(path)
      if (error || !data) { setUploading(false); setRec((r) => ({ ...r, error: error?.message ?? 'Could not prepare the upload.' })); toNative({ type: 'record', action: 'stop' }); return }
      pendingPath.current = path
      toNative({ type: 'record', action: 'stop', uploadUrl: data.signedUrl, path })
      return
    }
    const w = webRec; webRec = null
    if (!w) { setUploading(false); return }
    const done = new Promise<void>((res) => { w.rec.onstop = () => res() })
    w.rec.stop(); w.rec.stream.getTracks().forEach((t) => t.stop())
    await done
    setRec({ on: false, since: null, purpose: w.purpose })
    const ext = w.type.includes('mp4') ? 'm4a' : 'webm'
    const path = `${me}/${crypto.randomUUID()}.${ext}`
    const blob = new Blob(w.chunks, { type: w.type.split(';')[0] || 'audio/webm' })
    const { error } = await supabase.storage.from('recordings').upload(path, blob, { contentType: blob.type })
    setUploading(false)
    if (error) return setRec((r) => ({ ...r, error: error.message }))
    setUploaded({ path, seconds: Math.round((Date.now() - w.started) / 1000), purpose: w.purpose })
  }, [native, me])

  return { native, gps, rec, trip, uploaded, uploading, action,
    startTrip, stopTrip, clearTrip: () => setTrip(null), startRec, stopRec, clearUploaded: () => setUploaded(null), clearAction: () => setAction(null),
    clearErrors: () => { setGps((g) => ({ ...g, error: undefined })); setRec((r) => ({ ...r, error: undefined })) } }
}
export type FieldApi = ReturnType<typeof useField>

/** Calls the voice function with the signed-in user's token. */
export async function voice(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('voice', { body })
  if (error) {
    let msg = error.message
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error } catch { /* keep message */ }
    throw new Error(msg)
  }
  return data
}

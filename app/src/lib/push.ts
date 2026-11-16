// Web push: turn notifications on/off for this browser or home-screen app.
import { supabase } from './supabase'
import { isNativeApp } from './native'

const PUBLIC_KEY = 'BC99vgZA4jd7vIP82JZebsuwArfnxLdaN8xjGvrxRP6EenCXT6_7lOaPonUz3ACBcqJkNVNkvAdWYMFuGKMmpD4'
const SW = new URL('../sw.js', window.location.href).href // portal lives at …/portal/, the worker at the site root

export type PushState = 'unsupported' | 'needs-install' | 'blocked' | 'off' | 'on'

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

export async function pushState(): Promise<PushState> {
  if (isNativeApp()) return 'unsupported' // the iPhone app will use Apple's own notifications
  if (isIOS() && !standalone()) return 'needs-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const reg = await navigator.serviceWorker.getRegistration(SW)
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

const key = () => {
  const b = atob(PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (PUBLIC_KEY.length % 4)) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

/** Must be called from a tap/click. */
export async function turnOnPush(): Promise<PushState> {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off'
  const reg = await navigator.serviceWorker.register(SW, { scope: new URL('../', window.location.href).pathname })
  await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key() })
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  const { error } = await supabase.from('push_subscriptions').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' })
  if (error) throw new Error(error.message)
  return 'on'
}

export async function turnOffPush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration(SW)
  const sub = await reg?.pushManager.getSubscription()
  if (sub) { await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe() }
  return 'off'
}

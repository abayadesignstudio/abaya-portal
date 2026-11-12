/** Bridge to the Abaya iPhone app (a native shell around the portal). Does nothing in a normal browser. */
type Handler = { postMessage: (m: unknown) => void }
const handler = (): Handler | undefined => (window as unknown as { webkit?: { messageHandlers?: { abaya?: Handler } } }).webkit?.messageHandlers?.abaya
export const isNativeApp = () => !!handler()
export const toNative = (m: Record<string, unknown>) => { try { handler()?.postMessage(m) } catch { /* not in the app */ } }

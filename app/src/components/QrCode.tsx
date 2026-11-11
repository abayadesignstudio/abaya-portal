// A QR code drawn as inline SVG (no network, no image upload). Used for the Zelle QR on invoices and in Settings.
import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

export default function QrCode({ value, size = 168, label }: { value: string; size?: number; label: string }) {
  const svg = useMemo(() => {
    try { const q = qrcode(0, 'M'); q.addData(value); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) } catch { return '' }
  }, [value])
  if (!svg) return null
  return <div className="qr-code" role="img" aria-label={label} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
}

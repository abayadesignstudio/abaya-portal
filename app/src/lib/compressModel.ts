// In-browser model compression (loaded only when someone uploads a model).
// Merges duplicates, drops unused data, welds vertices, converts textures to WebP (max 2048 px)
// and applies Meshopt geometry compression. The viewer decodes Meshopt + WebP.
import { WebIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions'
import { dedup, prune, weld, resample, meshopt, flatten, join } from '@gltf-transform/functions'
import type { Document } from '@gltf-transform/core'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'

export type CompressResult = { file: File; before: number; after: number; note?: string }

export async function compressModel(file: File, onStep?: (label: string) => void): Promise<CompressResult> {
  const before = file.size
  await MeshoptEncoder.ready; await MeshoptDecoder.ready
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
  onStep?.('Reading model…')
  const doc = await io.readBinary(new Uint8Array(await file.arrayBuffer()))
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === EXTMeshoptCompression.EXTENSION_NAME)) {
    return { file, before, after: before, note: 'Already compressed — uploaded as-is.' }
  }
  onStep?.('Cleaning up geometry…')
  await doc.transform(dedup(), prune(), resample(), weld(), flatten(), join({ keepNamed: false }), dedup(), prune())
  onStep?.('Compressing textures…')
  const tex = await webpTextures(doc, (i, n) => onStep?.(`Compressing textures… ${i}/${n}`))
  onStep?.('Compressing geometry…')
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  onStep?.('Packing…')
  const out = await io.writeBinary(doc)
  const detail = tex.before ? ` Textures ${mb(tex.before)} → ${mb(tex.after)}.` : ''
  if (out.byteLength >= before) return { file, before, after: before, note: 'Compression didn’t help — uploaded the original.' + detail }
  const name = file.name.replace(/\.glb$/i, '') + '.web.glb'
  return { file: new File([out], name, { type: 'model/gltf-binary' }), before, after: out.byteLength, note: detail.trim() || undefined }
}

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`

/** Re-encode every texture as WebP (quality 0.82), longest side ≤ 2048 px, using the browser's own encoder.
 *  Normal maps stay lossless-ish (quality 0.95). Keeps the original if WebP comes out bigger. */
async function webpTextures(doc: Document, onEach?: (i: number, n: number) => void) {
  const list = doc.getRoot().listTextures()
  let before = 0, after = 0, changed = false
  const normals = new Set(doc.getRoot().listMaterials().map((m) => m.getNormalTexture()).filter(Boolean))
  for (let i = 0; i < list.length; i++) {
    onEach?.(i + 1, list.length)
    const t = list[i]; const img = t.getImage(); if (!img) continue
    before += img.byteLength
    try {
      const bmp = await createImageBitmap(new Blob([img as BlobPart], { type: t.getMimeType() || 'image/png' }))
      const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height))
      const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k))
      const c = new OffscreenCanvas(w, h); c.getContext('2d')!.drawImage(bmp, 0, 0, w, h); bmp.close()
      const blob = await c.convertToBlob({ type: 'image/webp', quality: normals.has(t) ? 0.95 : 0.82 })
      if (blob.type !== 'image/webp' || blob.size >= img.byteLength) { after += img.byteLength; continue }
      t.setImage(new Uint8Array(await blob.arrayBuffer())).setMimeType('image/webp')
      if (t.getURI()) t.setURI(t.getURI().replace(/\.\w+$/, '.webp'))
      after += blob.size; changed = true
    } catch { after += img.byteLength }
  }
  if (changed) doc.createExtension(EXTTextureWebP).setRequired(true)
  return { before, after }
}

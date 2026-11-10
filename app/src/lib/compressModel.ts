// In-browser model compression (loaded only when someone uploads a model).
// Merges duplicates, drops unused data, welds vertices, converts textures to WebP (max 2048 px)
// and applies Meshopt geometry compression. The viewer decodes Meshopt + WebP.
import { WebIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, prune, weld, resample, textureCompress, meshopt, flatten, join } from '@gltf-transform/functions'
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
  try { await doc.transform(textureCompress({ targetFormat: 'webp', resize: [2048, 2048] })) } catch { /* browser lacks WebP encoding — keep originals */ }
  onStep?.('Compressing geometry…')
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  onStep?.('Packing…')
  const out = await io.writeBinary(doc)
  if (out.byteLength >= before) return { file, before, after: before, note: 'Compression didn’t help — uploaded the original.' }
  const name = file.name.replace(/\.glb$/i, '') + '.web.glb'
  return { file: new File([out], name, { type: 'model/gltf-binary' }), before, after: out.byteLength }
}

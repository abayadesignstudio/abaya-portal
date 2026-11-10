import { Upload } from 'tus-js-client'
import { supabase } from './supabase'

/** Resumable (chunked) upload to Supabase Storage — for models and other large files.
 *  Sends 6 MB chunks, retries dropped ones, reports progress 0–1. */
export async function bigUpload(bucket: string, path: string, file: File, onProgress?: (p: number) => void): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in.')
  const ref = new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname.split('.')[0]
  await new Promise<void>((resolve, reject) => {
    const up = new Upload(file, {
      endpoint: `https://${ref}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 2000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${token}`, 'x-upsert': 'true' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: bucket, objectName: path, contentType: file.type || 'application/octet-stream', cacheControl: '3600' },
      chunkSize: 6 * 1024 * 1024,
      onError: (e) => {
        const m = String((e as Error).message ?? e)
        reject(new Error(/maximum allowed size|413|Payload too large/i.test(m)
          ? `This file (${(file.size / 1048576).toFixed(0)} MB) is over the storage size limit.` : m))
      },
      onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
      onSuccess: () => resolve(),
    })
    up.findPreviousUploads().then((prev) => { if (prev.length) up.resumeFromPreviousUpload(prev[0]); up.start() })
  })
}

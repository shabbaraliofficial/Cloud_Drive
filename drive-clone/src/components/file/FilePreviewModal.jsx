import { useEffect, useMemo, useState } from 'react'
import ReactPlayer from 'react-player'

import { API_BASE_URL } from '../../lib/api'
import { clearAuthTokens, getAccessToken } from '../../lib/auth'
import { detectFileKind, toAbsoluteFileUrl } from '../../lib/filePreview'

function FilePreviewModal({ open, file, onClose, previewBasePath = '/api/files' }) {
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [textPreview, setTextPreview] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !file?.id) return undefined

    let active = true
    let objectUrl = ''

    const load = async () => {
      setLoading(true)
      setError('')
      setTextPreview('')
      try {
        const token = getAccessToken()
        if (!token) {
          clearAuthTokens()
          throw new Error('Missing bearer token. Please log in again.')
        }
        const response = await fetch(`${API_BASE_URL}${previewBasePath}/${file.id}/preview`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!response.ok) {
          let data = null
          try {
            data = await response.json()
          } catch {
            data = null
          }
          throw new Error(data?.detail || data?.message || 'Preview failed')
        }

        const contentType = response.headers.get('content-type') || ''

        if (contentType.includes('application/json')) {
          const data = await response.json()
          if (!active) return

          const url = data?.preview_url || data?.url || data?.download_url || ''
          const mime = data?.mime_type || data?.content_type || file?.mime_type || ''
          const name = data?.name || file?.name || 'File'
          setPreview({
            kind: detectFileKind(mime, name),
            url: toAbsoluteFileUrl(url),
            streamUrl: toAbsoluteFileUrl(data?.stream_url || ''),
            mime,
            name,
            size: data?.size,
          })
          return
        }

        const blob = await response.blob()
        if (!active) return

        objectUrl = URL.createObjectURL(blob)
        setPreview({
          kind: detectFileKind(blob.type, file?.name || ''),
          url: objectUrl,
          streamUrl: '',
          mime: blob.type,
          name: file?.name || 'File',
          size: blob.size,
        })
      } catch (err) {
        if (active) {
          setError(err.message || 'Preview failed')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    load()

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file, open, previewBasePath])

  useEffect(() => {
    if (!open || !preview?.url || preview.kind !== 'text') return undefined
    let active = true
    fetch(preview.url)
      .then((res) => res.text())
      .then((text) => {
        if (!active) return
        setTextPreview(text)
      })
      .catch((err) => {
        if (!active) return
        setError(err.message || 'Failed to load text preview')
      })
    return () => {
      active = false
    }
  }, [open, preview])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const title = useMemo(() => preview?.name || file?.name || 'Preview', [preview, file])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">Close</button>
        </div>

        <div className="max-h-[78vh] overflow-auto p-4">
          {loading ? <p className="text-sm text-slate-500 dark:text-slate-400">Loading preview...</p> : null}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          {!loading && !error && preview?.kind === 'image' ? (
            <img src={preview.url} alt={preview.name} className="mx-auto max-h-[70vh] rounded-lg object-contain" />
          ) : null}

          {!loading && !error && preview?.kind === 'pdf' ? (
            <iframe title={preview.name} src={preview.url} className="h-[70vh] w-full rounded-lg border border-slate-200 dark:border-slate-700" />
          ) : null}

          {!loading && !error && preview?.kind === 'video' ? (
            <div className="overflow-hidden rounded-lg bg-black">
              <ReactPlayer
                src={preview.streamUrl || preview.url}
                controls
                playsInline
                width="100%"
                height="70vh"
              />
            </div>
          ) : null}

          {!loading && !error && preview?.kind === 'audio' ? (
            <audio controls src={preview.url} className="w-full" />
          ) : null}

          {!loading && !error && preview?.kind === 'text' ? (
            <pre className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
              {textPreview || 'Loading text content...'}
            </pre>
          ) : null}

          {!loading && !error && preview?.kind === 'other' ? (
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{preview.name}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Type: {preview.mime || 'Unknown'}</p>
              {preview.size ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Size: {preview.size} bytes</p> : null}
              {preview.url ? (
                <a href={preview.url} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white">
                  Open file
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default FilePreviewModal

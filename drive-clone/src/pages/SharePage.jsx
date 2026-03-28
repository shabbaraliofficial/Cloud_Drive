import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactPlayer from 'react-player'
import { api } from '../lib/api'
import { detectFileKind, toAbsoluteFileUrl } from '../lib/filePreview'

function SharePage() {
  const { token = '' } = useParams()
  const [file, setFile] = useState(null)
  const [textPreview, setTextPreview] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')

    api.getSharedFile(token)
      .then((data) => {
        if (!active) return
        setFile({
          ...data,
          file_url: toAbsoluteFileUrl(data?.file_url || data?.preview_url || ''),
          preview_url: toAbsoluteFileUrl(data?.preview_url || data?.file_url || ''),
          kind: detectFileKind(data?.mime_type || '', data?.name || ''),
        })
      })
      .catch((err) => {
        if (!active) return
        setError(err.message || 'Share link is unavailable')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [token])

  useEffect(() => {
    if (!file?.preview_url || file.kind !== 'text') return undefined
    let active = true
    fetch(file.preview_url)
      .then((res) => res.text())
      .then((text) => {
        if (active) setTextPreview(text)
      })
      .catch(() => {
        if (active) setTextPreview('')
      })
    return () => {
      active = false
    }
  }, [file])

  const title = useMemo(() => file?.name || 'Shared file', [file])

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#e0f2fe,_#f8fafc_55%)] px-4 py-10 dark:bg-slate-950">
      <div className="mx-auto max-w-5xl rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-2xl backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600">Shared File</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
            {file?.mime_type ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{file.mime_type}</p> : null}
          </div>
          <Link to="/login" className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
            Open Drive
          </Link>
        </div>

        {loading ? <p className="text-sm text-slate-500 dark:text-slate-400">Loading shared file...</p> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        {!loading && !error && file?.kind === 'image' ? (
          <img src={file.preview_url} alt={file.name} className="mx-auto max-h-[72vh] rounded-2xl object-contain" />
        ) : null}

        {!loading && !error && file?.kind === 'video' ? (
          <div className="overflow-hidden rounded-2xl bg-black">
            <ReactPlayer
              src={file.preview_url}
              controls
              playsInline
              width="100%"
              height="72vh"
            />
          </div>
        ) : null}

        {!loading && !error && file?.kind === 'audio' ? (
          <div className="rounded-2xl border border-slate-200 p-6 dark:border-slate-700">
            <audio controls src={file.preview_url} className="w-full" />
          </div>
        ) : null}

        {!loading && !error && file?.kind === 'pdf' ? (
          <iframe title={file.name} src={file.preview_url} className="h-[72vh] w-full rounded-2xl border border-slate-200 dark:border-slate-700" />
        ) : null}

        {!loading && !error && file?.kind === 'text' ? (
          <pre className="max-h-[72vh] overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
            {textPreview || 'Loading text preview...'}
          </pre>
        ) : null}

        {!loading && !error && file?.kind === 'other' ? (
          <div className="rounded-2xl border border-slate-200 p-6 dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-300">Preview is not available for this file type.</p>
          </div>
        ) : null}

        {!loading && !error && file?.file_url ? (
          <a
            href={file.file_url}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white"
          >
            Download file
          </a>
        ) : null}
      </div>
    </main>
  )
}

export default SharePage

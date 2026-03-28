import { useEffect, useMemo, useState } from 'react'

import { api } from '../../lib/api'
import { toast } from '../../lib/popup'
import { formatBytes } from '../../lib/storage'

function formatVersionDate(value) {
  if (!value) return 'Unknown date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleString()
}

function VersionHistoryDialog({ open, file, onClose, onRestored }) {
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(false)
  const [restoringId, setRestoringId] = useState('')
  const [error, setError] = useState('')

  const fileName = useMemo(() => file?.name || 'File', [file])

  useEffect(() => {
    if (!open || !file?.id) return undefined

    let active = true
    setLoading(true)
    setError('')

    api.getFileVersions(file.id)
      .then((items) => {
        if (!active) return
        setVersions(Array.isArray(items) ? items : [])
      })
      .catch((err) => {
        if (!active) return
        setError(err?.message || 'Failed to load version history')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [file?.id, open])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  const handleRestore = async (versionId) => {
    if (!file?.id || !versionId) return

    try {
      setRestoringId(versionId)
      const restored = await api.restoreFileVersion(file.id, versionId)
      const refreshedVersions = await api.getFileVersions(file.id)
      setVersions(Array.isArray(refreshedVersions) ? refreshedVersions : [])
      toast.success('Version restored successfully')
      onRestored?.(restored)
    } catch (err) {
      toast.error(err?.message || 'Failed to restore version')
    } finally {
      setRestoringId('')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Version History</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{fileName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="max-h-[72vh] overflow-auto p-5">
          {loading ? <p className="text-sm text-slate-500 dark:text-slate-400">Loading version history...</p> : null}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          {!loading && !error && !versions.length ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              No previous versions yet.
            </div>
          ) : null}

          {!loading && !error && versions.length ? (
            <div className="space-y-3">
              {versions.map((version) => (
                <article
                  key={version.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {version.file_name || 'Untitled version'}
                      </h4>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Saved {formatVersionDate(version.created_at)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {formatBytes(version.file_size || 0)} • {version.mime_type || version.file_type || 'Unknown type'}
                      </p>
                      {version.tags?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {version.tags.map((tag) => (
                            <span
                              key={`${version.id}-${tag}`}
                              className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-300"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRestore(version.id)}
                      disabled={restoringId === version.id}
                      className="rounded-xl bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {restoringId === version.id ? 'Restoring...' : 'Restore'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default VersionHistoryDialog

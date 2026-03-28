import { useEffect, useMemo, useState } from 'react'
import { Clock3, Copy, Globe2, Link2, LockKeyhole, Share2, Users, X } from 'lucide-react'

import { api } from '../../lib/api'
import { toast } from '../../lib/popup'

const LINK_EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never expires' },
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

const SHARE_DURATION_OPTIONS = [
  { value: '1h', label: '1 hour' },
  { value: '2h', label: '2 hours' },
  { value: '1d', label: '1 day' },
]

function buildExpiryDate(value) {
  if (value === 'never') return null

  const next = new Date()
  if (value === '1d') next.setDate(next.getDate() + 1)
  if (value === '7d') next.setDate(next.getDate() + 7)
  if (value === '30d') next.setDate(next.getDate() + 30)
  return next.toISOString()
}

function ShareDialog({ open, file, onClose }) {
  const [access, setAccess] = useState('public')
  const [permission, setPermission] = useState('viewer')
  const [expiry, setExpiry] = useState('never')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shareResult, setShareResult] = useState(null)
  const [copyLabel, setCopyLabel] = useState('Copy link')
  const [directory, setDirectory] = useState([])
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [sharePermission, setSharePermission] = useState('read')
  const [shareDuration, setShareDuration] = useState('1d')
  const [shareMessage, setShareMessage] = useState('')

  const itemType = useMemo(() => (file?.itemType === 'folder' ? 'folder' : 'file'), [file?.itemType])

  useEffect(() => {
    if (!open) return
    setAccess('public')
    setPermission('viewer')
    setExpiry('never')
    setBusy(false)
    setError('')
    setShareResult(null)
    setCopyLabel('Copy link')
    setSelectedUserId('')
    setSharePermission('read')
    setShareDuration('1d')
    setShareMessage('')
  }, [file, open])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  useEffect(() => {
    if (!open) return undefined

    let active = true
    setDirectoryLoading(true)
    api.getUserDirectory()
      .then((users) => {
        if (!active) return
        setDirectory(Array.isArray(users) ? users : [])
      })
      .catch((err) => {
        if (!active) return
        setDirectory([])
        setError(err.message || 'Failed to load share targets')
      })
      .finally(() => {
        if (active) setDirectoryLoading(false)
      })

    return () => {
      active = false
    }
  }, [open])

  const expiryDate = useMemo(() => buildExpiryDate(expiry), [expiry])

  const handleGenerateLink = async () => {
    if (!file?.id || itemType !== 'file') return

    try {
      setBusy(true)
      setError('')
      const data = await api.createShareLink(file.id, {
        is_public: access === 'public',
        permission,
        expires_at: expiryDate,
      })

      setShareResult({
        url: data?.share_url || '',
        token: data?.share_token || '',
        access,
        permission,
        expiresAt: expiryDate,
      })
      toast.success('Share link created')
    } catch (err) {
      setError(err.message || 'Failed to create share link')
      toast.error(err.message || 'Failed to create share link')
    } finally {
      setBusy(false)
    }
  }

  const handleShareWithUser = async () => {
    if (!file?.id || !selectedUserId) {
      toast.warning('Choose a user to share with')
      return
    }

    try {
      setBusy(true)
      setError('')
      const result = await api.shareItem({
        item_type: itemType,
        item_id: file.id,
        user_id: selectedUserId,
        permission: sharePermission,
        duration: shareDuration,
      })
      setShareMessage(
        `${result?.shared_with_username || 'User'} now has ${result?.permission || sharePermission} access for ${shareDuration}.`
      )
      toast.success(`${itemType === 'folder' ? 'Folder' : 'File'} shared successfully`)
    } catch (err) {
      setError(err.message || 'Failed to share item')
      toast.error(err.message || 'Failed to share item')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyLink = async () => {
    if (!shareResult?.url) return

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareResult.url)
        setCopyLabel('Copied')
        toast.success('Share link copied')
        window.setTimeout(() => setCopyLabel('Copy link'), 1500)
        return
      }
      const fallbackMessage = 'Clipboard access is not available. Copy the link manually below.'
      setError(fallbackMessage)
      toast.warning(fallbackMessage)
    } catch (err) {
      setError(err.message || 'Unable to copy link')
      toast.error(err.message || 'Unable to copy link')
    }
  }

  if (!open || !file) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/65 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-600">Share {itemType}</p>
            <h3 className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">{file.name}</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Control who can access this {itemType} and how long the access lasts.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </div>

        <section className="rounded-3xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-sky-600" />
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Share with people</h4>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="space-y-2 md:col-span-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">User</span>
              <select
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="">{directoryLoading ? 'Loading users...' : 'Select a user'}</option>
                {directory.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} ({user.username})
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Permission</span>
              <select
                value={sharePermission}
                onChange={(event) => setSharePermission(event.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="read">Read</option>
                <option value="write">Write</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Duration</span>
              <select
                value={shareDuration}
                onChange={(event) => setShareDuration(event.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {SHARE_DURATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                onClick={handleShareWithUser}
                disabled={busy || !selectedUserId}
                className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Share2 size={16} className="mr-2" />
                Share
              </button>
            </div>
          </div>
          {shareMessage ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
              {shareMessage}
            </div>
          ) : null}
        </section>

        {itemType === 'file' ? (
          <section className="mt-5 rounded-3xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Link2 size={16} className="text-sky-600" />
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Share by link</h4>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {access === 'public' ? <Globe2 size={14} /> : <LockKeyhole size={14} />}
                  Link access
                </span>
                <select
                  value={access}
                  onChange={(event) => setAccess(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="public">Public link</option>
                  <option value="private">Private link</option>
                </select>
              </label>

              <label className="space-y-2">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <Globe2 size={14} />
                  Link permission
                </span>
                <select
                  value={permission}
                  onChange={(event) => setPermission(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
              </label>
            </div>

            <label className="mt-4 block space-y-2">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <Clock3 size={14} />
                Link expiry
              </span>
              <select
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {LINK_EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300">
              {access === 'public'
                ? 'Anyone with the link can open this file.'
                : 'This link requires the recipient to be signed in before the file can be opened.'}
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleGenerateLink}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? 'Creating link...' : 'Generate link'}
              </button>
              <button
                type="button"
                onClick={handleCopyLink}
                disabled={!shareResult?.url}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Copy size={16} className="mr-2" />
                {copyLabel}
              </button>
            </div>

            {shareResult?.url ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Share link</p>
                <p className="break-all text-sm text-slate-800 dark:text-slate-100">{shareResult.url}</p>
              </div>
            ) : null}
          </section>
        ) : null}

        {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
      </div>
    </div>
  )
}

export default ShareDialog

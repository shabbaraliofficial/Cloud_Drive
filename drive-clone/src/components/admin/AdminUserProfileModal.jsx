import { CalendarDays, Eye, HardDrive, Mail, UserRound, X } from 'lucide-react'

import { formatBytes } from '../../lib/storage'

function formatDateTime(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return date.toLocaleString()
}

function InfoCard({ label, value, Icon, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  }

  return (
    <article className="rounded-[24px] border border-slate-200/80 bg-white/90 p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/70">
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${tones[tone] || tones.slate}`}>
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-2 break-words text-sm font-medium text-slate-950 dark:text-slate-50">{value}</p>
        </div>
      </div>
    </article>
  )
}

function EmptyFilesState() {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-base font-medium text-slate-950 dark:text-slate-50">No user files found</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Uploaded files for this user will appear here.
      </p>
    </div>
  )
}

function AdminUserProfileModal({
  open,
  loading = false,
  profileData,
  busyFileId = '',
  onClose,
  onDeleteFile,
  onViewFile,
}) {
  if (!open) return null

  const user = profileData?.user || null
  const files = Array.isArray(profileData?.files) ? profileData.files : []
  const planLabel = user?.is_premium ? (user?.account_type || 'Premium') : 'Free'
  const statusLabel = user?.is_active ? 'Active' : 'Banned'

  return (
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-700">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-600 dark:text-sky-300">
              User Profile
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              {user?.full_name || user?.username || user?.email || 'Loading user'}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              View account details and manage the user&apos;s files without exposing passwords.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Close user profile"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[78vh] overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
              Loading user profile...
            </div>
          ) : null}

          {!loading && user ? (
            <div className="space-y-6">
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <InfoCard label="Name" value={user.full_name || 'Not available'} Icon={UserRound} tone="sky" />
                <InfoCard label="Email" value={user.email || 'Not available'} Icon={Mail} tone="emerald" />
                <InfoCard label="Username" value={user.username ? `@${user.username}` : 'Not available'} Icon={UserRound} />
                <InfoCard label="Storage Used" value={formatBytes(user.storage_used || 0)} Icon={HardDrive} tone="amber" />
                <InfoCard label="Account Status" value={statusLabel} Icon={UserRound} tone={user.is_active ? 'emerald' : 'amber'} />
                <InfoCard label="Plan" value={planLabel} Icon={HardDrive} tone={user.is_premium ? 'amber' : 'slate'} />
                <InfoCard label="Created Date" value={formatDateTime(user.created_at)} Icon={CalendarDays} />
              </section>

              <section className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/92 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/70">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-6 py-5 dark:border-slate-800/80">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">User Files</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Review uploaded content and take admin actions when needed.
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {files.length} file{files.length === 1 ? '' : 's'}
                  </span>
                </div>

                {files.length ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-slate-50/90 text-xs uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-900/80 dark:text-slate-300">
                        <tr>
                          <th className="px-6 py-4">File name</th>
                          <th className="px-6 py-4">Type</th>
                          <th className="px-6 py-4">Size</th>
                          <th className="px-6 py-4">Upload date</th>
                          <th className="px-6 py-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {files.map((file) => {
                          const fileBusy = busyFileId === file.id
                          return (
                            <tr key={file.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                              <td className="px-6 py-4">
                                <p className="font-medium text-slate-900 dark:text-slate-100">{file.file_name}</p>
                              </td>
                              <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{file.file_type || 'Unknown'}</td>
                              <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{formatBytes(file.file_size || 0)}</td>
                              <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{formatDateTime(file.created_at)}</td>
                              <td className="px-6 py-4">
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => onViewFile?.(file)}
                                    className="inline-flex items-center gap-1 rounded-xl bg-sky-100 px-3 py-2 text-xs font-medium text-sky-700 transition hover:bg-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50"
                                  >
                                    <Eye size={14} />
                                    View file
                                  </button>
                                  <button
                                    type="button"
                                    disabled={fileBusy}
                                    onClick={() => onDeleteFile?.(file)}
                                    className="inline-flex items-center gap-1 rounded-xl bg-rose-100 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50"
                                  >
                                    {fileBusy ? 'Deleting...' : 'Delete file'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyFilesState />
                )}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default AdminUserProfileModal

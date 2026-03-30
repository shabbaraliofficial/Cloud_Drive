import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  Eye,
  Files,
  HardDrive,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserX,
  Users,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import AdminAnalytics from '../components/admin/AdminAnalytics'
import AdminLayout from '../components/admin/AdminLayout'
import AdminUserProfileModal from '../components/admin/AdminUserProfileModal'
import FilePreviewModal from '../components/file/FilePreviewModal'
import useProfile from '../hooks/useProfile'
import { api } from '../lib/api'
import { clearAuthTokens } from '../lib/auth'
import { confirmAction, toast } from '../lib/popup'
import { formatBytes } from '../lib/storage'

const EMPTY_STATS = {
  total_users: 0,
  total_files: 0,
  total_storage_used: 0,
}

const EMPTY_ANALYTICS = {
  storage: {
    used: 0,
    free: 0,
  },
  file_types: {
    image: 0,
    video: 0,
    pdf: 0,
    other: 0,
  },
  uploads_last_7_days: [],
  user_growth: [],
}

const SECTION_COPY = {
  dashboard: {
    heading: 'Platform overview',
    subheading: 'Monitor account growth, uploaded content, and storage pressure from an isolated admin workspace.',
  },
  users: {
    heading: 'User management',
    subheading: 'Review account roles, storage usage, and access status without exposing any user dashboard UI.',
  },
  files: {
    heading: 'File governance',
    subheading: 'Inspect file ownership and remove content directly from storage when needed.',
  },
  stats: {
    heading: 'System metrics',
    subheading: 'Track platform totals, account health, and storage distribution at a glance.',
  },
}

function isAdminAccessFailure(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('missing bearer token')
    || message.includes('please log in again')
    || message.includes('unauthorized')
    || message.includes('invalid token')
    || message.includes('admin access')
    || message.includes('access denied')
}

function StatCard({ title, value, caption, Icon, tone = 'sky', onClick }) {
  const tones = {
    sky: 'from-sky-500/18 to-cyan-500/5 text-sky-700 dark:text-sky-300',
    emerald: 'from-emerald-500/18 to-teal-500/5 text-emerald-700 dark:text-emerald-300',
    amber: 'from-amber-500/18 to-orange-500/5 text-amber-700 dark:text-amber-300',
  }

  const content = (
    <article className="rounded-[28px] border border-white/70 bg-white/88 p-5 shadow-sm backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/75">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">{value}</p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{caption}</p>
        </div>
        <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${tones[tone] || tones.sky}`}>
          <Icon size={22} />
        </span>
      </div>
    </article>
  )

  if (!onClick) return content

  return (
    <button type="button" onClick={onClick} className="text-left transition hover:-translate-y-0.5">
      {content}
    </button>
  )
}

function SectionCard({ title, subtitle, action, children }) {
  return (
    <section className="overflow-hidden rounded-[30px] border border-white/70 bg-white/88 shadow-sm backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/75">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-6 py-5 dark:border-slate-800/80">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">{title}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

function Badge({ tone = 'slate', children }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  }

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  )
}

function InsightTile({ label, value, description }) {
  return (
    <article className="rounded-[26px] border border-slate-200/80 bg-white/90 p-5 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/70">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">{value}</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{description}</p>
    </article>
  )
}

function EmptyState({ title, description }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-base font-medium text-slate-950 dark:text-slate-50">{title}</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  )
}

function UsersTable({
  users,
  currentAdminId,
  busyUserId,
  onViewProfile,
  onToggleBan,
  onRemovePremium,
  onDeleteUser,
}) {
  if (!users.length) {
    return (
      <EmptyState
        title="No users matched your search"
        description="Try a different name, email, username, or role filter."
      />
    )
  }

  return (
    <table className="min-w-full text-left text-sm">
      <thead className="bg-slate-50/90 text-xs uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-900/80 dark:text-slate-300">
        <tr>
          <th className="px-6 py-4">Name</th>
          <th className="px-6 py-4">Email</th>
          <th className="px-6 py-4">Storage used</th>
          <th className="px-6 py-4">Role</th>
          <th className="px-6 py-4 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {users.map((entry) => {
          const isCurrentAdmin = entry.id === currentAdminId
          const userBusy = busyUserId === entry.id

          return (
            <tr key={entry.id} className="border-t border-slate-100 align-top dark:border-slate-800">
              <td className="px-6 py-4">
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {entry.full_name || entry.username || 'Unnamed user'}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      @{entry.username || 'unknown'}
                    </span>
                    <Badge tone={entry.is_active ? 'emerald' : 'amber'}>
                      {entry.is_active ? 'Active' : 'Banned'}
                    </Badge>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{entry.email}</td>
              <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                <div>
                  <p>{formatBytes(entry.storage_used || 0)}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {entry.file_count || 0} {(entry.file_count || 0) === 1 ? 'file' : 'files'}
                  </p>
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={entry.role === 'admin' ? 'sky' : 'slate'}>
                    {entry.role || 'user'}
                  </Badge>
                  <Badge tone={entry.is_premium ? 'amber' : 'emerald'}>
                    {entry.account_type || entry.plan || 'Free'}
                  </Badge>
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={userBusy}
                    onClick={() => onViewProfile(entry)}
                    className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Eye size={14} />
                    View profile
                  </button>
                  {isCurrentAdmin ? (
                    <span className="text-xs text-slate-400 dark:text-slate-500">Current session</span>
                  ) : (
                    <>
                      {entry.is_premium ? (
                        <button
                          type="button"
                          disabled={userBusy}
                          onClick={() => onRemovePremium(entry)}
                          className="inline-flex items-center gap-1 rounded-xl bg-sky-100 px-3 py-2 text-xs font-medium text-sky-700 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50"
                        >
                          <Sparkles size={14} />
                          {userBusy ? 'Saving...' : 'Remove premium'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={userBusy}
                        onClick={() => onToggleBan(entry)}
                        className="inline-flex items-center gap-1 rounded-xl bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
                      >
                        <UserX size={14} />
                        {userBusy ? 'Saving...' : entry.is_active ? 'Ban' : 'Unban'}
                      </button>
                      <button
                        type="button"
                        disabled={userBusy}
                        onClick={() => onDeleteUser(entry)}
                        className="inline-flex items-center gap-1 rounded-xl bg-rose-100 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function FilesTablePanel({ files, busyFileId, onDeleteFile }) {
  if (!files.length) {
    return (
      <EmptyState
        title="No files matched your search"
        description="Adjust the search query to inspect more file records."
      />
    )
  }

  return (
    <table className="min-w-full text-left text-sm">
      <thead className="bg-slate-50/90 text-xs uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-900/80 dark:text-slate-300">
        <tr>
          <th className="px-6 py-4">File name</th>
          <th className="px-6 py-4">Owner</th>
          <th className="px-6 py-4">Size</th>
          <th className="px-6 py-4 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {files.map((entry) => {
          const fileBusy = busyFileId === entry.id
          return (
            <tr key={entry.id} className="border-t border-slate-100 align-top dark:border-slate-800">
              <td className="px-6 py-4">
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{entry.file_name}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge tone="slate">{entry.file_type || 'unknown'}</Badge>
                    {entry.is_deleted ? <Badge tone="amber">In trash</Badge> : null}
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                <p>{entry.owner_name || 'Unknown owner'}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {entry.owner_email || 'No email'}
                </p>
              </td>
              <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                {formatBytes(entry.file_size || 0)}
              </td>
              <td className="px-6 py-4">
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={fileBusy}
                    onClick={() => onDeleteFile(entry)}
                    className="inline-flex items-center gap-1 rounded-xl bg-rose-100 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50"
                  >
                    <Trash2 size={14} />
                    {fileBusy ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function MiniList({ items, emptyMessage, renderItem }) {
  if (!items.length) {
    return <EmptyState title="Nothing to review" description={emptyMessage} />
  }

  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map(renderItem)}
    </div>
  )
}

function AdminPage() {
  const navigate = useNavigate()
  const { user, loading: profileLoading } = useProfile()
  const [activeSection, setActiveSection] = useState('dashboard')
  const [searchValue, setSearchValue] = useState('')
  const deferredSearchValue = useDeferredValue(searchValue)
  const [stats, setStats] = useState(EMPTY_STATS)
  const [analytics, setAnalytics] = useState(EMPTY_ANALYTICS)
  const [users, setUsers] = useState([])
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [busyUserId, setBusyUserId] = useState('')
  const [busyFileId, setBusyFileId] = useState('')
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [userProfileLoading, setUserProfileLoading] = useState(false)
  const [selectedUserProfile, setSelectedUserProfile] = useState(null)
  const [previewFile, setPreviewFile] = useState(null)
  const selectedProfileUserId = selectedUserProfile?.user?.id || ''

  const handleAdminError = useCallback((err, fallbackMessage) => {
    console.error('Admin error:', err)
    if (isAdminAccessFailure(err)) {
      clearAuthTokens()
      navigate('/admin/login', { replace: true })
      return
    }
    setError(err?.message || fallbackMessage)
  }, [navigate])

  const loadAdminData = useCallback(async ({ background = false } = {}) => {
    if (background) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError('')

    try {
      const [statsRes, usersRes, filesRes] = await Promise.all([
        api.getAdminStats(),
        api.getAdminUsers(),
        api.getAdminFiles(),
      ])
      setStats(statsRes || EMPTY_STATS)
      setUsers(Array.isArray(usersRes) ? usersRes : [])
      setFiles(Array.isArray(filesRes) ? filesRes : [])
    } catch (err) {
      handleAdminError(err, 'Failed to load admin data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [handleAdminError])

  const loadAnalyticsData = useCallback(async () => {
    setAnalyticsLoading(true)
    try {
      const analyticsRes = await api.getAdminAnalytics()
      setAnalytics(analyticsRes || EMPTY_ANALYTICS)
    } catch (err) {
      console.error('Admin analytics error:', err)
      if (isAdminAccessFailure(err)) {
        clearAuthTokens()
        navigate('/admin/login', { replace: true })
        return
      }
      setAnalytics(EMPTY_ANALYTICS)
      toast.error(err?.message || 'Failed to load analytics')
    } finally {
      setAnalyticsLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    if (!profileLoading && user?.role === 'admin') {
      loadAdminData()
      loadAnalyticsData()
    }
  }, [loadAdminData, loadAnalyticsData, profileLoading, user?.role])

  const query = deferredSearchValue.trim().toLowerCase()
  const filteredUsers = useMemo(() => {
    if (!query) return users
    return users.filter((entry) => (
      String(entry.full_name || '').toLowerCase().includes(query)
      || String(entry.email || '').toLowerCase().includes(query)
      || String(entry.username || '').toLowerCase().includes(query)
      || String(entry.role || '').toLowerCase().includes(query)
      || String(entry.plan || '').toLowerCase().includes(query)
      || String(entry.account_type || '').toLowerCase().includes(query)
    ))
  }, [query, users])

  const filteredFiles = useMemo(() => {
    if (!query) return files
    return files.filter((entry) => (
      String(entry.file_name || '').toLowerCase().includes(query)
      || String(entry.owner_name || '').toLowerCase().includes(query)
      || String(entry.owner_email || '').toLowerCase().includes(query)
      || String(entry.file_type || '').toLowerCase().includes(query)
    ))
  }, [files, query])

  const activeUsers = useMemo(() => users.filter((entry) => entry.is_active).length, [users])
  const bannedUsers = useMemo(() => users.filter((entry) => !entry.is_active).length, [users])
  const adminCount = useMemo(() => users.filter((entry) => entry.role === 'admin').length, [users])
  const trashedFiles = useMemo(() => files.filter((entry) => entry.is_deleted).length, [files])
  const averageStoragePerUser = useMemo(() => {
    if (!stats.total_users) return 0
    return stats.total_storage_used / stats.total_users
  }, [stats.total_storage_used, stats.total_users])
  const largestFiles = useMemo(() => {
    return [...filteredFiles]
      .sort((left, right) => (right.file_size || 0) - (left.file_size || 0))
      .slice(0, 5)
  }, [filteredFiles])

  const handleToggleBan = useCallback(async (targetUser) => {
    const actionLabel = targetUser.is_active ? 'ban' : 'unban'
    const confirmed = await confirmAction({
      title: `${actionLabel === 'ban' ? 'Ban' : 'Unban'} user?`,
      message: `${actionLabel === 'ban' ? 'Disable access for' : 'Restore access for'} ${targetUser.full_name || targetUser.email}?`,
      confirmLabel: actionLabel === 'ban' ? 'Ban user' : 'Unban user',
      cancelLabel: 'Cancel',
      tone: actionLabel === 'ban' ? 'danger' : 'default',
    })
    if (!confirmed) return

    try {
      setBusyUserId(targetUser.id)
      const updated = await api.toggleAdminUserBan(targetUser.id)
      setUsers((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)))
      if (String(selectedProfileUserId) === String(updated.id)) {
        setSelectedUserProfile((current) => (current ? { ...current, user: updated } : current))
      }
      toast.success(updated.is_active ? 'User access restored' : 'User has been banned')
    } catch (err) {
      handleAdminError(err, 'Failed to update user status')
      toast.error(err?.message || 'Failed to update user status')
    } finally {
      setBusyUserId('')
    }
  }, [handleAdminError, selectedProfileUserId])

  const handleDeleteUser = useCallback(async (targetUser) => {
    const confirmed = await confirmAction({
      title: 'Delete user account?',
      message: `Delete ${targetUser.full_name || targetUser.email} and permanently remove all of their stored files? This cannot be undone.`,
      confirmLabel: 'Delete user',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    if (!confirmed) return

    try {
      setBusyUserId(targetUser.id)
      await api.deleteAdminUser(targetUser.id)
      if (String(selectedProfileUserId) === String(targetUser.id)) {
        setProfileModalOpen(false)
        setSelectedUserProfile(null)
      }
      toast.success('User deleted successfully')
      await loadAdminData({ background: true })
    } catch (err) {
      handleAdminError(err, 'Failed to delete user')
      toast.error(err?.message || 'Failed to delete user')
    } finally {
      setBusyUserId('')
    }
  }, [handleAdminError, loadAdminData, selectedProfileUserId])

  const handleDeleteFile = useCallback(async (targetFile) => {
    const confirmed = await confirmAction({
      title: 'Delete file permanently?',
      message: `Delete ${targetFile.file_name} from storage and the database? This cannot be undone.`,
      confirmLabel: 'Delete file',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    if (!confirmed) return

    try {
      setBusyFileId(targetFile.id)
      await api.deleteAdminFile(targetFile.id)
      setPreviewFile((current) => (current?.id === targetFile.id ? null : current))
      toast.success('File deleted successfully')
      await loadAdminData({ background: true })
      if (selectedProfileUserId && String(targetFile.owner_id || '') === String(selectedProfileUserId)) {
        const detail = await api.getAdminUserProfile(selectedProfileUserId)
        setSelectedUserProfile(detail || null)
      }
    } catch (err) {
      handleAdminError(err, 'Failed to delete file')
      toast.error(err?.message || 'Failed to delete file')
    } finally {
      setBusyFileId('')
    }
  }, [handleAdminError, loadAdminData, selectedProfileUserId])

  const handleRemovePremium = useCallback(async (targetUser) => {
    const confirmed = await confirmAction({
      title: 'Remove premium plan?',
      message: `Move ${targetUser.full_name || targetUser.email} back to the free plan without deleting any files?`,
      confirmLabel: 'Remove premium',
      cancelLabel: 'Cancel',
      tone: 'default',
    })
    if (!confirmed) return

    try {
      setBusyUserId(targetUser.id)
      const updated = await api.removeAdminUserPremium(targetUser.id)
      setUsers((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)))
      if (String(selectedProfileUserId) === String(updated.id)) {
        setSelectedUserProfile((current) => (current ? { ...current, user: updated } : current))
      }
      toast.success('Premium plan removed')
    } catch (err) {
      handleAdminError(err, 'Failed to remove premium plan')
      toast.error(err?.message || 'Failed to remove premium plan')
    } finally {
      setBusyUserId('')
    }
  }, [handleAdminError, selectedProfileUserId])

  const handleViewUserProfile = useCallback(async (targetUser) => {
    try {
      setBusyUserId(targetUser.id)
      setProfileModalOpen(true)
      setUserProfileLoading(true)
      setSelectedUserProfile(null)
      const detail = await api.getAdminUserProfile(targetUser.id)
      setSelectedUserProfile(detail || null)
    } catch (err) {
      setProfileModalOpen(false)
      setSelectedUserProfile(null)
      handleAdminError(err, 'Failed to load user profile')
      toast.error(err?.message || 'Failed to load user profile')
    } finally {
      setUserProfileLoading(false)
      setBusyUserId('')
    }
  }, [handleAdminError])

  const handleViewUserFile = useCallback((file) => {
    setPreviewFile({
      id: file.id,
      name: file.file_name || 'File',
      mime_type: file.mime_type || file.file_type || '',
    })
  }, [])

  const handleRefresh = useCallback(() => {
    loadAdminData({ background: true })
    loadAnalyticsData()
  }, [loadAdminData, loadAnalyticsData])

  if (profileLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
        Loading admin console...
      </div>
    )
  }

  const sectionCopy = SECTION_COPY[activeSection] || SECTION_COPY.dashboard

  return (
    <AdminLayout
      currentUser={user}
      activeSection={activeSection}
      onSelectSection={setActiveSection}
      heading={sectionCopy.heading}
      subheading={sectionCopy.subheading}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      onRefresh={handleRefresh}
      refreshing={refreshing}
    >
      {error ? (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {(activeSection === 'dashboard' || activeSection === 'stats') ? (
        <section className="grid gap-4 xl:grid-cols-3">
          <StatCard
            title="Total Users"
            value={stats.total_users.toLocaleString()}
            caption="Registered accounts across the platform."
            Icon={Users}
            tone="sky"
            onClick={() => setActiveSection('users')}
          />
          <StatCard
            title="Total Files"
            value={stats.total_files.toLocaleString()}
            caption="All file records currently stored in the system."
            Icon={Files}
            tone="emerald"
            onClick={() => setActiveSection('files')}
          />
          <StatCard
            title="Total Storage"
            value={formatBytes(stats.total_storage_used)}
            caption="Combined storage currently occupied by uploaded content."
            Icon={HardDrive}
            tone="amber"
            onClick={() => setActiveSection('stats')}
          />
        </section>
      ) : null}

      {activeSection === 'dashboard' ? (
        <div className="mt-6 space-y-6">
          <AdminAnalytics analytics={analytics} loading={analyticsLoading} />

          <div className="grid gap-6 2xl:grid-cols-[1.2fr,0.8fr]">
            <SectionCard
              title="Account watchlist"
              subtitle="A quick moderation view of the accounts in the current result set."
              action={(
                <div className="flex items-center gap-2">
                  <Badge tone="sky">{filteredUsers.length} visible</Badge>
                  <button
                    type="button"
                    onClick={() => setActiveSection('users')}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Open users
                  </button>
                </div>
              )}
            >
              <MiniList
                items={filteredUsers.slice(0, 5)}
                emptyMessage="User records will appear here after the first account is created."
                renderItem={(entry) => (
                  <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                    <div>
                      <p className="font-medium text-slate-950 dark:text-slate-50">
                        {entry.full_name || entry.username || 'Unnamed user'}
                      </p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {entry.email} / {formatBytes(entry.storage_used || 0)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={entry.role === 'admin' ? 'sky' : 'slate'}>{entry.role || 'user'}</Badge>
                      <Badge tone={entry.is_active ? 'emerald' : 'amber'}>
                        {entry.is_active ? 'Active' : 'Banned'}
                      </Badge>
                    </div>
                  </div>
                )}
              />
            </SectionCard>

            <SectionCard
              title="Storage pulse"
              subtitle="Largest files in the current dataset and overall platform health."
              action={(
                <div className="flex items-center gap-2">
                  <Badge tone="amber">{largestFiles.length} tracked</Badge>
                  <button
                    type="button"
                    onClick={() => setActiveSection('stats')}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Open stats
                  </button>
                </div>
              )}
            >
              <div className="grid gap-4 p-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <InsightTile
                    label="Active users"
                    value={activeUsers.toLocaleString()}
                    description="Accounts currently allowed to sign in."
                  />
                  <InsightTile
                    label="Admins"
                    value={adminCount.toLocaleString()}
                    description="Accounts with elevated platform access."
                  />
                </div>
                <MiniList
                  items={largestFiles}
                  emptyMessage="The largest-file view will populate as users upload content."
                  renderItem={(entry) => (
                    <div key={entry.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/80">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-950 dark:text-slate-50">{entry.file_name}</p>
                        <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                          {entry.owner_name || 'Unknown owner'} / {entry.file_type || 'unknown'}
                        </p>
                      </div>
                      <Badge tone="slate">{formatBytes(entry.file_size || 0)}</Badge>
                    </div>
                  )}
                />
              </div>
            </SectionCard>
          </div>

          <SectionCard
            title="File activity"
            subtitle="A fast read on the file records returned by your current filters."
            action={(
              <div className="flex items-center gap-2">
                <Badge tone="sky">{filteredFiles.length} visible</Badge>
                <button
                  type="button"
                  onClick={() => setActiveSection('files')}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Open files
                </button>
              </div>
            )}
          >
            <FilesTablePanel
              files={filteredFiles.slice(0, 6)}
              busyFileId={busyFileId}
              onDeleteFile={handleDeleteFile}
            />
          </SectionCard>
        </div>
      ) : null}

      {activeSection === 'users' ? (
        <div className="mt-6">
          <SectionCard
            title="Users"
            subtitle="Inspect account roles, storage usage, and access state."
            action={<Badge tone="sky">{filteredUsers.length} visible</Badge>}
          >
            <UsersTable
              users={filteredUsers}
              currentAdminId={user?.id}
              busyUserId={busyUserId}
              onViewProfile={handleViewUserProfile}
              onToggleBan={handleToggleBan}
              onRemovePremium={handleRemovePremium}
              onDeleteUser={handleDeleteUser}
            />
          </SectionCard>
        </div>
      ) : null}

      {activeSection === 'files' ? (
        <div className="mt-6">
          <SectionCard
            title="Files"
            subtitle="Review uploaded content and remove records directly from storage."
            action={<Badge tone="sky">{filteredFiles.length} visible</Badge>}
          >
            <FilesTablePanel
              files={filteredFiles}
              busyFileId={busyFileId}
              onDeleteFile={handleDeleteFile}
            />
          </SectionCard>
        </div>
      ) : null}

      {activeSection === 'stats' ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
          <InsightTile
            label="Active accounts"
            value={activeUsers.toLocaleString()}
            description="Users currently able to access the product."
          />
          <InsightTile
            label="Banned accounts"
            value={bannedUsers.toLocaleString()}
            description="Accounts blocked by admin action."
          />
          <InsightTile
            label="Files in trash"
            value={trashedFiles.toLocaleString()}
            description="File records currently marked as deleted."
          />
          <InsightTile
            label="Average storage"
            value={formatBytes(averageStoragePerUser)}
            description="Average storage consumption per registered account."
          />

          <div className="2xl:col-span-2 xl:col-span-2">
            <SectionCard
              title="Platform balance"
              subtitle="How storage and account health are distributed across the system."
            >
              <div className="grid gap-4 p-6 md:grid-cols-2">
                <div className="rounded-[26px] border border-slate-200/80 bg-slate-50/90 p-5 dark:border-slate-800 dark:bg-slate-900/80">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    Storage footprint
                  </p>
                  <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                    {formatBytes(stats.total_storage_used)}
                  </p>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Spread across {stats.total_files.toLocaleString()} file records.
                  </p>
                </div>
                <div className="rounded-[26px] border border-slate-200/80 bg-slate-50/90 p-5 dark:border-slate-800 dark:bg-slate-900/80">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    Moderation load
                  </p>
                  <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                    {bannedUsers.toLocaleString()}
                  </p>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Restricted accounts currently outside the active user pool.
                  </p>
                </div>
              </div>
            </SectionCard>
          </div>

          <div className="2xl:col-span-2 xl:col-span-2">
            <SectionCard
              title="Admin health notes"
              subtitle="Focused metrics for account operations and storage pressure."
            >
              <div className="grid gap-4 p-6">
                <div className="flex items-start gap-3 rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/80">
                  <Users className="mt-1 text-sky-600 dark:text-sky-300" size={18} />
                  <div>
                    <p className="font-medium text-slate-950 dark:text-slate-50">Account spread</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {adminCount.toLocaleString()} admin account(s) manage {stats.total_users.toLocaleString()} total users.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/80">
                  <Activity className="mt-1 text-emerald-600 dark:text-emerald-300" size={18} />
                  <div>
                    <p className="font-medium text-slate-950 dark:text-slate-50">Content pressure</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {stats.total_files.toLocaleString()} file records are consuming {formatBytes(stats.total_storage_used)}.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/80">
                  <BarChart3 className="mt-1 text-amber-600 dark:text-amber-300" size={18} />
                  <div>
                    <p className="font-medium text-slate-950 dark:text-slate-50">Storage average</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Each registered account uses an average of {formatBytes(averageStoragePerUser)}.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/80">
                  <ShieldCheck className="mt-1 text-rose-600 dark:text-rose-300" size={18} />
                  <div>
                    <p className="font-medium text-slate-950 dark:text-slate-50">Restricted access</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {bannedUsers.toLocaleString()} account(s) are currently blocked from signing in.
                    </p>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      ) : null}

      <AdminUserProfileModal
        open={profileModalOpen}
        loading={userProfileLoading}
        profileData={selectedUserProfile}
        busyFileId={busyFileId}
        onClose={() => {
          setProfileModalOpen(false)
          setSelectedUserProfile(null)
        }}
        onDeleteFile={handleDeleteFile}
        onViewFile={handleViewUserFile}
      />

      <FilePreviewModal
        open={Boolean(previewFile)}
        file={previewFile}
        onClose={() => setPreviewFile(null)}
        previewBasePath="/admin/file"
      />
    </AdminLayout>
  )
}

export default AdminPage

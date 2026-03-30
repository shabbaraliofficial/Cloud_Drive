import { useMemo, useState } from 'react'
import {
  BarChart3,
  Files,
  LayoutDashboard,
  LogOut,
  Moon,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Users,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import useTheme from '../../context/useTheme'
import { api } from '../../lib/api'
import { clearAuthTokens } from '../../lib/auth'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'users', label: 'Users', Icon: Users },
  { id: 'files', label: 'Files', Icon: Files },
  { id: 'stats', label: 'Stats', Icon: BarChart3 },
]

function AdminLayout({
  currentUser,
  activeSection,
  onSelectSection,
  heading,
  subheading,
  searchValue,
  onSearchChange,
  onRefresh,
  refreshing = false,
  children,
}) {
  const navigate = useNavigate()
  const { isDark, toggleTheme } = useTheme()
  const [loggingOut, setLoggingOut] = useState(false)

  const displayName = currentUser?.full_name || currentUser?.username || 'Administrator'
  const email = currentUser?.email || 'admin@cloudrive.dev'
  const initials = useMemo(() => {
    const words = String(displayName).trim().split(/\s+/).filter(Boolean)
    if (!words.length) return 'AD'
    return words
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('')
  }, [displayName])

  const handleLogout = async () => {
    try {
      setLoggingOut(true)
      await api.logout()
    } catch (error) {
      console.error('Admin logout failed:', error)
    } finally {
      clearAuthTokens()
      navigate('/admin/login', { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.14),_transparent_24%),linear-gradient(180deg,_#f4f7fb_0%,_#e9eef7_100%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(34,197,94,0.14),_transparent_22%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)]">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-slate-200/80 bg-white/80 px-5 py-5 backdrop-blur xl:px-6 lg:w-[300px] lg:border-b-0 lg:border-r dark:border-slate-800/80 dark:bg-slate-950/80">
          <div>
            <div className="flex items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-sky-500/15 dark:bg-sky-600">
                <ShieldCheck size={22} />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.26em] text-sky-600 dark:text-sky-300">
                  Admin Space
                </p>
                <h1 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Cloud Drive Control</h1>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-500 dark:text-slate-400">
              A dedicated workspace for account moderation, storage oversight, and file governance.
            </p>
          </div>

          <nav className="mt-8 grid gap-2">
            {NAV_ITEMS.map(({ id, label, Icon }) => {
              const active = activeSection === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectSection?.(id)}
                  className={`flex items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                    active
                      ? 'bg-slate-950 text-white shadow-lg shadow-slate-900/10 dark:bg-sky-600'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
                  }`}
                >
                  <span className="inline-flex items-center gap-3">
                    <Icon size={18} />
                    {label}
                  </span>
                  {active ? (
                    <span className="rounded-full bg-white/15 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-white">
                      Live
                    </span>
                  ) : null}
                </button>
              )
            })}
          </nav>

          <div className="mt-8 rounded-[28px] border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/80">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              Access Level
            </p>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white dark:bg-sky-600">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950 dark:text-slate-50">{displayName}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{email}</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm dark:bg-slate-950 dark:text-slate-300">
              <p className="font-medium text-slate-950 dark:text-slate-50">Administrator only</p>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                This area is isolated from the user drive and only renders admin tools.
              </p>
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 px-4 py-4 backdrop-blur sm:px-6 lg:px-8 dark:border-slate-800/70 dark:bg-slate-950/75">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-600 dark:text-sky-300">
                  Admin Dashboard
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                  {heading}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subheading}</p>
              </div>

              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <label className="relative min-w-0 lg:w-[360px]">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="search"
                    value={searchValue}
                    onChange={(event) => onSearchChange?.(event.target.value)}
                    placeholder="Search users, owners, files, or roles"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-sky-900/40"
                  />
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onRefresh}
                    disabled={refreshing}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing' : 'Refresh'}
                  </button>
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    title="Toggle theme"
                  >
                    {isDark ? <Sun size={18} /> : <Moon size={18} />}
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500"
                  >
                    <LogOut size={16} />
                    {loggingOut ? 'Signing out' : 'Logout'}
                  </button>
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}

export default AdminLayout

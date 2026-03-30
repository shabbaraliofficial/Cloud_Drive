import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, ChevronDown, Moon, Search, SlidersHorizontal, Sun, LogOut, UserCircle2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import useTheme from '../../context/useTheme'
import useProfile from '../../hooks/useProfile'
import { api } from '../../lib/api'
import { clearAuthTokens, isAuthenticated } from '../../lib/auth'
import { toAbsoluteFileUrl } from '../../lib/filePreview'
import { formatBytes, normalizeStoragePayload } from '../../lib/storage'

function Header({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search in Drive',
  onOpenAdvancedSearch,
  searchHasFilters = false,
  searching = false,
}) {
  const navigate = useNavigate()
  const { isDark, toggleTheme } = useTheme()
  const { user, loading, refreshProfile } = useProfile()
  const [open, setOpen] = useState(false)
  const [storage, setStorage] = useState(null)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!open || !isAuthenticated()) return
    Promise.allSettled([
      refreshProfile(),
      api.getStorageUsage().then(setStorage),
    ]).catch((error) => {
      console.error('Failed to refresh profile menu:', error)
    })
  }, [open, refreshProfile])

  const displayName = user?.name || user?.full_name || user?.username || 'User'
  const email = user?.email || 'user@example.com'
  const profilePicture = user?.profile_picture ? toAbsoluteFileUrl(user.profile_picture) : null
  const avatarLetter = useMemo(
    () => (displayName.trim()?.charAt(0)?.toUpperCase() || 'U'),
    [displayName]
  )
  const storageMetrics = useMemo(
    () => normalizeStoragePayload({ ...(user || {}), ...(storage || {}) }),
    [storage, user]
  )
  const usedPct = storageMetrics.usedPercent

  const handleLogout = async () => {
    try {
      await api.logout()
    } catch (error) {
      console.error('Logout failed:', error)
    }
    clearAuthTokens()
    navigate('/login', { replace: true })
  }

  const searchInputProps = typeof onSearchChange === 'function'
    ? {
      value: searchValue ?? '',
      onChange: (event) => onSearchChange(event.target.value),
    }
    : {}

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-4 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="shrink-0 text-left"
          aria-label="Go to dashboard"
        >
          <p className="text-xs uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">Drive</p>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">My Cloud Drive</h1>
        </button>

        <div className="relative mx-auto w-full max-w-xl flex-1">
          <Search
            size={16}
            className={`absolute top-1/2 left-3 -translate-y-1/2 ${searching ? 'text-sky-500' : 'text-slate-400'}`}
          />
          <input
            placeholder={searchPlaceholder}
            aria-busy={searching}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-14 pl-10 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
            {...searchInputProps}
          />
          {typeof onOpenAdvancedSearch === 'function' ? (
            <button
              type="button"
              onClick={onOpenAdvancedSearch}
              className={`absolute top-1/2 right-2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg border transition ${
                searchHasFilters
                  ? 'border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-900/50 dark:bg-sky-900/40 dark:text-sky-300'
                  : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900'
              }`}
              aria-label="Open advanced search"
              title="Advanced search"
            >
              <span className="relative inline-flex">
                <SlidersHorizontal size={16} />
                {searchHasFilters ? (
                  <span className="absolute -top-1.5 -right-1.5 h-2.5 w-2.5 rounded-full bg-sky-500" />
                ) : null}
              </span>
            </button>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            className="rounded-xl p-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Toggle theme"
            onClick={toggleTheme}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            type="button"
            className="rounded-xl p-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Notifications"
          >
            <Bell size={18} />
          </button>

          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              {profilePicture ? (
                <img src={profilePicture} alt="Profile" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white dark:bg-sky-700">
                  {avatarLetter}
                </span>
              )}
              <ChevronDown size={16} />
            </button>

            {open ? (
              <div className="absolute top-12 right-0 z-50 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-3 border-b border-slate-100 pb-3 dark:border-slate-700">
                  <div className="flex items-center gap-3">
                    {profilePicture ? (
                      <img src={profilePicture} alt="Profile" className="h-12 w-12 rounded-full object-cover ring-2 ring-slate-100 dark:ring-slate-800" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white dark:bg-sky-700">{avatarLetter}</div>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {loading ? 'Loading...' : displayName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {loading ? 'Fetching profile...' : email}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>Storage</span>
                      <span>{usedPct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-600" style={{ width: `${usedPct}%` }} />
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                      {formatBytes(storageMetrics.used)} used of {formatBytes(storageMetrics.total)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    navigate('/profile')
                  }}
                  className="mb-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <UserCircle2 size={16} />
                  Manage Account
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose-600 transition hover:bg-rose-50 dark:hover:bg-rose-900/20"
                >
                  <LogOut size={16} />
                  Logout
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header

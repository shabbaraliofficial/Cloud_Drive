import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { isAuthenticated } from '../../lib/auth'
import { formatStorageSummary, normalizeStoragePayload } from '../../lib/storage'

function Footer() {
  const [usage, setUsage] = useState(null)

  useEffect(() => {
    let mounted = true

    const loadUsage = async () => {
      if (!isAuthenticated()) {
        if (mounted) {
          setUsage(null)
        }
        return
      }

      try {
        const data = await api.getStorageUsage()
        if (mounted) {
          setUsage(data || null)
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to fetch storage usage:', error)
      }
    }

    loadUsage()

    return () => {
      mounted = false
    }
  }, [])

  const usageText = useMemo(() => {
    if (!usage) return 'Storage usage unavailable'
    return formatStorageSummary(normalizeStoragePayload(usage))
  }, [usage])

  return (
    <footer className="border-t border-slate-200 bg-white/90 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-300 sm:px-6">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2">
        <p>&copy; 2026 My Cloud Drive</p>
        <p>{usageText}</p>
      </div>
    </footer>
  )
}

export default Footer

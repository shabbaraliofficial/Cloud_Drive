import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { isAuthenticated } from '../lib/auth'

function useProfile() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refreshProfile = useCallback(async () => {
    if (!isAuthenticated()) {
      setUser(null)
      setLoading(false)
      return null
    }
    setLoading(true)
    try {
      const profile = await api.getProfile()
      setUser(profile || null)
      return profile
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated()) {
      setUser(null)
      setLoading(false)
      return undefined
    }

    refreshProfile().catch((error) => {
      console.error('Failed to fetch profile:', error)
      setUser(null)
    })
    return undefined
  }, [refreshProfile])

  return { user, loading, refreshProfile }
}

export default useProfile

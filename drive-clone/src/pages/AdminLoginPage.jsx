import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'

import AuthShell from '../components/auth/AuthShell'
import AuthInput from '../components/auth/AuthInput'
import { api } from '../lib/api'
import { clearAuthTokens, isAuthenticated, setAuthTokens } from '../lib/auth'
import { getHomeRouteForRole, isAdminRole } from '../lib/roleRoutes'

function AdminLoginPage() {
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false

    if (!isAuthenticated()) {
      return undefined
    }

    api.getProfile()
      .then((profile) => {
        if (cancelled) return
        navigate(getHomeRouteForRole(profile?.role), { replace: true })
      })
      .catch(() => {
        clearAuthTokens()
      })

    return () => {
      cancelled = true
    }
  }, [navigate])

  const onChange = (event) => {
    const { name, value } = event.target
    setCredentials((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: '' }))
  }

  const loginAsAdmin = async (event) => {
    event.preventDefault()
    const nextErrors = {}
    setSubmitError('')

    if (!credentials.username.trim()) nextErrors.username = 'Admin username is required.'
    if (!credentials.password.trim()) nextErrors.password = 'Password is required.'

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }

    try {
      setIsSubmitting(true)
      const tokenData = await api.login({
        username: credentials.username.trim(),
        password: credentials.password,
      })
      setAuthTokens(tokenData.access_token, tokenData.refresh_token)
      const profile = await api.getProfile()

      if (!isAdminRole(profile?.role)) {
        clearAuthTokens()
        throw new Error('This account does not have admin access.')
      }

      navigate('/admin', { replace: true })
    } catch (error) {
      clearAuthTokens()
      setSubmitError(error.message || 'Admin login failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Admin sign in"
      subtitle="Use your admin credentials to manage users, files, and platform-level storage."
      sideText="This login is reserved for administrator accounts. Regular users should continue through the standard sign-in flow."
    >
      <form className="space-y-4" onSubmit={loginAsAdmin}>
        <AuthInput
          label="Admin Username or Email"
          name="username"
          value={credentials.username}
          onChange={onChange}
          error={errors.username}
          autoComplete="username"
          placeholder="Enter admin username or email"
        />
        <AuthInput
          label="Password"
          type="password"
          name="password"
          value={credentials.password}
          onChange={onChange}
          error={errors.password}
          autoComplete="current-password"
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-sky-700 dark:hover:bg-sky-600"
        >
          <ShieldCheck size={16} />
          {isSubmitting ? 'Checking access...' : 'Login To Admin'}
        </button>
        {submitError ? <p className="text-xs text-rose-600">{submitError}</p> : null}
      </form>

      <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200">
        Admin access is verified after sign-in using your existing authentication system and role checks.
      </div>

      <div className="mt-5 text-center">
        <p className="text-gray-400">
          Need the regular user portal?
          <Link
            to="/login"
            className="ml-1 font-semibold text-blue-400 hover:text-blue-300"
          >
            User Login
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}

export default AdminLoginPage

import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Apple, Chrome, Facebook, ShieldCheck } from 'lucide-react'
import AuthShell from '../components/auth/AuthShell'
import AuthInput from '../components/auth/AuthInput'
import { api } from '../lib/api'
import { clearAuthTokens, setAuthTokens } from '../lib/auth'
import { getHomeRouteForRole } from '../lib/roleRoutes'

function SocialButton({ icon, label, onClick }) {
  const SocialIcon = icon
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
    >
      <SocialIcon size={16} />
      {label}
    </button>
  )
}

function LoginPage() {
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams(location.search)
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const oauthError = params.get('oauth_error')

    if (oauthError) {
      setSubmitError(`Google login failed: ${oauthError}`)
      return undefined
    }

    const hydrateSession = async () => {
      if (!accessToken || !refreshToken) return

      try {
        setAuthTokens(accessToken, refreshToken)
        const profile = await api.getProfile()
        if (cancelled) return
        navigate(getHomeRouteForRole(profile?.role), { replace: true })
      } catch (error) {
        clearAuthTokens()
        if (cancelled) return
        setSubmitError(error?.message || 'Unable to restore your session')
      }
    }

    hydrateSession()

    return () => {
      cancelled = true
    }
  }, [location.search, navigate])

  const onChange = (event) => {
    const { name, value } = event.target
    setCredentials((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: '' }))
  }

  const loginWithCredentials = async (event) => {
    event.preventDefault()
    const nextErrors = {}
    setSubmitError('')

    if (!credentials.username.trim()) nextErrors.username = 'Username is required.'
    if (!credentials.password.trim()) nextErrors.password = 'Password is required.'

    if (Object.keys(nextErrors).length > 0) {
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
      navigate(getHomeRouteForRole(profile?.role), { replace: true })
    } catch (error) {
      clearAuthTokens()
      setSubmitError(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const loginWithGoogle = () => {
    window.location.href = 'http://localhost:8000/api/auth/google/login'
  }

  const socialLogin = async (provider) => {
    setSubmitError('')
    if (provider.toLowerCase() === 'google') {
      loginWithGoogle()
      return
    }
    try {
      await api.socialLogin(provider.toLowerCase())
      setSubmitError(`${provider} login is not active yet. Backend placeholder is connected.`)
    } catch (error) {
      setSubmitError(error.message)
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Login with your username and password or continue with your preferred account provider."
      sideText="Your docs, sheets, files, and collaboration spaces are synced and secured in one place."
    >
      <form className="space-y-4" onSubmit={loginWithCredentials}>
        <AuthInput
          label="Username or Email"
          name="username"
          value={credentials.username}
          onChange={onChange}
          error={errors.username}
          autoComplete="username"
          placeholder={location.state?.username || 'Enter username or email'}
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
          {isSubmitting ? 'Logging in...' : 'Login Securely'}
        </button>
        {submitError ? <p className="text-xs text-rose-600">{submitError}</p> : null}
      </form>

      <div className="text-center mt-4">
        <p className="text-gray-400">
          Don&apos;t have an account?
          <Link
            to="/register"
            className="text-blue-400 hover:text-blue-300 font-semibold ml-1"
          >
            Create Account
          </Link>
        </p>
        <p className="mt-2 text-gray-400">
          Need administrator access?
          <Link
            to="/admin/login"
            className="ml-1 font-semibold text-blue-400 hover:text-blue-300"
          >
            Admin Login
          </Link>
        </p>
      </div>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        <span className="text-xs uppercase tracking-widest text-slate-400 dark:text-slate-500">or continue with</span>
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SocialButton icon={Chrome} label="Google" onClick={() => socialLogin('Google')} />
        <SocialButton icon={Facebook} label="Facebook" onClick={() => socialLogin('Facebook')} />
        <SocialButton icon={Apple} label="Apple ID" onClick={() => socialLogin('Apple')} />
      </div>
    </AuthShell>
  )
}

export default LoginPage

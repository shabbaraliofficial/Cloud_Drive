import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'

import Header from '../components/layout/Header'
import Footer from '../components/layout/Footer'
import useTheme from '../context/useTheme'
import { api } from '../lib/api'
import { toAbsoluteFileUrl } from '../lib/filePreview'
import { toast } from '../lib/popup'
import { loadRazorpayCheckout } from '../lib/razorpay'
import { formatBytes, formatStorageGb, normalizeStoragePayload } from '../lib/storage'

const TABS = ['Overview', 'Personal Info', 'Security', 'Storage', 'Settings']
const PLAN_ORDER = {
  free: 0,
  basic: 1,
  pro: 2,
}

const PLAN_CARDS = [
  {
    id: 'free',
    name: 'Free',
    price: '₹0',
    billing: 'Forever',
    storage: '10 GB',
    description: 'A simple starter tier for personal storage and sharing.',
    accent: 'from-slate-700 to-slate-900',
    badge: 'Starter',
    features: ['10 GB secure storage', 'Upload, preview, and share files', 'Perfect for personal use'],
  },
  {
    id: 'basic',
    name: 'Basic',
    price: '₹99',
    billing: '/month',
    storage: '50 GB',
    description: 'More room for documents, photos, and day-to-day backups.',
    accent: 'from-sky-500 to-cyan-500',
    badge: 'Popular',
    features: ['50 GB storage limit', 'Ideal for work files and media', 'Razorpay test checkout ready'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '₹299',
    billing: '/month',
    storage: '200 GB',
    description: 'A roomy plan for heavier usage, large uploads, and long-term storage.',
    accent: 'from-emerald-500 to-teal-500',
    badge: 'Best value',
    features: ['200 GB storage limit', 'Designed for heavier cloud usage', 'Best for large media libraries'],
  },
]

function formatSyncTime(value) {
  if (!value) return 'Never synced'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Never synced'
  return format(parsed, 'MMM d, yyyy h:mm a')
}

function getCurrentDeviceName() {
  if (typeof navigator === 'undefined') return 'Web Browser'
  return navigator.userAgentData?.platform || navigator.platform || 'Web Browser'
}

function SubscriptionPlans({
  currentPlan,
  paymentsEnabled,
  upgradingPlan,
  onUpgrade,
}) {
  return (
    <div className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Subscription Plans</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Choose a storage plan and upgrade with Razorpay test mode.
          </p>
        </div>
        {!paymentsEnabled ? (
          <p className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            Set `VITE_RAZORPAY_KEY_ID` (rzp_test_...) to enable checkout
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {PLAN_CARDS.map((plan) => {
          const isCurrentPlan = currentPlan === plan.id
          const canUpgrade = (PLAN_ORDER[plan.id] ?? 0) > (PLAN_ORDER[currentPlan] ?? 0)
          const isBusy = upgradingPlan === plan.id

          let buttonLabel = 'Included'
          if (isCurrentPlan) {
            buttonLabel = 'Current plan'
          } else if (canUpgrade) {
            buttonLabel = `Upgrade to ${plan.name}`
          }

          return (
            <article
              key={plan.id}
              className={`relative overflow-hidden rounded-2xl border p-5 shadow-sm transition ${isCurrentPlan ? 'border-sky-300 bg-sky-50/70 dark:border-sky-500/50 dark:bg-sky-950/20' : 'border-slate-200 bg-white/70 dark:border-slate-700 dark:bg-slate-900/70'}`}
            >
              <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${plan.accent}`} />

              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{plan.badge}</p>
                  <h4 className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">{plan.name}</h4>
                </div>
                {isCurrentPlan ? (
                  <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
                    Active
                  </span>
                ) : null}
              </div>

              <div className="mt-4 flex items-end gap-1">
                <span className="text-3xl font-semibold text-slate-900 dark:text-slate-100">{plan.price}</span>
                <span className="pb-1 text-sm text-slate-500 dark:text-slate-400">{plan.billing}</span>
              </div>

              <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">{plan.storage} storage</p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{plan.description}</p>

              <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                {plan.features.map((feature) => (
                  <li key={feature} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                disabled={!paymentsEnabled || !canUpgrade || Boolean(upgradingPlan)}
                onClick={() => onUpgrade(plan.id)}
                className={`mt-5 w-full rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${canUpgrade && paymentsEnabled ? 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-sky-700 dark:hover:bg-sky-600' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}
              >
                {isBusy ? 'Opening Razorpay...' : buttonLabel}
              </button>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function ProfilePage() {
  const { isDark, toggleTheme } = useTheme()
  const razorpayKeyId = (import.meta.env.VITE_RAZORPAY_KEY_ID || '').trim()
  const hasValidRazorpayKey = Boolean(razorpayKeyId)
    && razorpayKeyId !== 'your_test_key'
    && razorpayKeyId.startsWith('rzp_test_')

  const [activeTab, setActiveTab] = useState('Overview')
  const [user, setUser] = useState({
    full_name: '',
    username: '',
    email: '',
    profile_picture: '',
    account_type: 'Free',
    plan: 'free',
    is_premium: false,
    storage_used: 0,
    storage_limit: 0,
    used: 0,
    total: 0,
    remaining: 0,
    two_factor_enabled: false,
    last_login: null,
  })
  const [storageInfo, setStorageInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [avatarBuster, setAvatarBuster] = useState(Date.now())
  const [profileError, setProfileError] = useState('')
  const [backupDevices, setBackupDevices] = useState([])
  const [backupEnabled, setBackupEnabled] = useState(false)
  const [backupLoading, setBackupLoading] = useState(false)
  const [upgradingPlan, setUpgradingPlan] = useState('')

  const [personalForm, setPersonalForm] = useState({
    full_name: '',
    username: '',
    phone_number: '',
    dob: '',
    gender: '',
    bio: '',
  })

  const [securityForm, setSecurityForm] = useState({
    old_password: '',
    new_password: '',
    two_factor_enabled: false,
  })

  const [settingsForm, setSettingsForm] = useState({
    email_notifications: true,
    auto_trash_delete: false,
  })

  const loadProfile = async (options = {}) => {
    const showSpinner = !options.silent
    if (showSpinner) {
      setLoading(true)
    }
    setProfileError('')
    try {
      const [data, storage] = await Promise.all([api.getProfile(), api.getStorageUsage()])
      setUser(data)
      setStorageInfo(storage)
      setPersonalForm({
        full_name: data?.full_name || '',
        username: data?.username || '',
        phone_number: data?.phone_number || data?.mobile_number || '',
        dob: data?.dob || data?.date_of_birth || '',
        gender: data?.gender || '',
        bio: data?.bio || '',
      })
      setSecurityForm((prev) => ({
        ...prev,
        two_factor_enabled: Boolean(data?.two_factor_enabled ?? data?.is_2fa_enabled ?? false),
      }))
      setAvatarBuster(Date.now())
    } catch (error) {
      console.error('Profile load failed', error)
      setProfileError(error?.message || 'Unable to load profile')
      toast.error(error?.message || 'Server not reachable')
    } finally {
      if (showSpinner) {
        setLoading(false)
      }
    }
  }

  const loadBackupSettings = async () => {
    setBackupLoading(true)
    try {
      const settings = await api.getBackupSettings()
      setBackupEnabled(Boolean(settings?.backup_enabled))
      setBackupDevices(Array.isArray(settings?.devices) ? settings.devices : [])
    } catch (error) {
      console.error('Backup settings load failed', error)
      toast.error(error?.message || 'Unable to load backup settings')
    } finally {
      setBackupLoading(false)
    }
  }

  useEffect(() => {
    const run = async () => {
      await loadProfile()
      await loadBackupSettings()
    }
    run()
  }, [])

  const handleBackupToggle = async (value) => {
    setBackupLoading(true)
    try {
      const settings = await api.updateBackupSettings({
        backup_enabled: value,
        device_name: getCurrentDeviceName(),
        status: value ? 'Active backup' : 'Paused',
      })
      setBackupEnabled(Boolean(settings?.backup_enabled))
      setBackupDevices(Array.isArray(settings?.devices) ? settings.devices : [])
      toast.success(value ? 'Backup enabled' : 'Backup paused')
    } catch (error) {
      console.error(error)
      toast.error(error?.message || 'Failed to update backup settings')
    } finally {
      setBackupLoading(false)
    }
  }

  const storageMetrics = useMemo(
    () => normalizeStoragePayload({ ...(user || {}), ...(storageInfo || {}) }),
    [storageInfo, user]
  )
  const currentPlan = String(user?.plan || 'free').toLowerCase()
  const paymentsEnabled = hasValidRazorpayKey
  const used = storageMetrics.used
  const total = storageMetrics.total
  const remaining = storageMetrics.remaining
  const fileCount = storageMetrics.fileCount
  const storagePct = storageMetrics.usedPercent

  const handlePersonalSave = async () => {
    try {
      await api.updateProfile(personalForm)
      const updated = await api.getProfile()
      setUser(updated)
      setPersonalForm({
        full_name: updated?.full_name || '',
        username: updated?.username || '',
        phone_number: updated?.phone_number || updated?.mobile_number || '',
        dob: updated?.dob || updated?.date_of_birth || '',
        gender: updated?.gender || '',
        bio: updated?.bio || '',
      })
      setAvatarBuster(Date.now())
      await loadProfile()
      toast.success('Profile saved successfully')
    } catch (error) {
      console.error(error)
      toast.error(error.message || 'Failed to update profile')
    }
  }

  const handlePasswordChange = async () => {
    if (!securityForm.old_password || !securityForm.new_password) {
      toast.warning('Please fill old and new password')
      return
    }
    try {
      await api.changePassword({
        old_password: securityForm.old_password,
        new_password: securityForm.new_password,
      })
      setSecurityForm((prev) => ({ ...prev, old_password: '', new_password: '' }))
      toast.success('Password changed successfully')
    } catch (error) {
      console.error(error)
      toast.error(error.message || 'Failed to change password')
    }
  }

  const handleSecurityToggle = async (value) => {
    setSecurityForm((prev) => ({ ...prev, two_factor_enabled: value }))
    try {
      await api.updateSecurity({ two_factor_enabled: value })
      const updated = await api.getProfile()
      setUser(updated)
      setSecurityForm((prev) => ({
        ...prev,
        two_factor_enabled: Boolean(updated?.two_factor_enabled ?? updated?.is_2fa_enabled ?? false),
      }))
      toast.success(value ? 'Two-factor authentication enabled' : 'Two-factor authentication disabled')
    } catch (error) {
      console.error(error)
      toast.error(error.message || 'Failed to update security settings')
    }
  }

  const handlePhotoUpload = async (file) => {
    if (!file) return
    try {
      const form = new FormData()
      form.append('file', file)
      await api.uploadProfilePhoto(form)
      const updated = await api.getProfile()
      setUser(updated)
      setAvatarBuster(Date.now())
      toast.success('Profile photo uploaded successfully')
    } catch (error) {
      console.error(error)
      toast.error(error.message || 'Failed to upload photo')
    }
  }

  const handlePlanUpgrade = async (planId) => {
    if (!paymentsEnabled) {
      toast.error('Configure VITE_RAZORPAY_KEY_ID (rzp_test_...) in drive-clone/.env to enable checkout')
      return
    }

    const targetPlan = PLAN_CARDS.find((plan) => plan.id === planId)
    if (!targetPlan) {
      toast.error('Invalid plan selected')
      return
    }

    try {
      setUpgradingPlan(planId)
      await loadRazorpayCheckout()
      const order = await api.createOrder({ plan: planId })

      await new Promise((resolve, reject) => {
        if (!window.Razorpay) {
          reject(new Error('Razorpay checkout is not available'))
          return
        }

        const checkout = new window.Razorpay({
          key: razorpayKeyId,
          amount: order.amount,
          currency: order.currency || 'INR',
          name: 'My Cloud Drive',
          description: `${targetPlan.name} storage upgrade`,
          order_id: order.order_id,
          prefill: {
            name: user?.full_name || user?.username || '',
            email: user?.email || '',
            contact: user?.mobile_number || user?.phone_number || '',
          },
          theme: {
            color: '#0284c7',
          },
          modal: {
            ondismiss: () => reject(new Error('Payment cancelled by user')),
          },
          handler: async (response) => {
            try {
              await api.verifyPayment({
                payment_id: response.razorpay_payment_id,
                order_id: response.razorpay_order_id || order.order_id,
                plan: planId,
              })
              await loadProfile({ silent: true })
              toast.success(`${targetPlan.name} plan activated successfully`)
              resolve()
            } catch (error) {
              reject(error)
            }
          },
        })

        checkout.on('payment.failed', (response) => {
          reject(new Error(response?.error?.description || 'Payment failed'))
        })

        checkout.open()
      })
    } catch (error) {
      console.error(error)
      if (error?.message === 'Payment cancelled by user') {
        toast.warning('Payment cancelled')
      } else {
        toast.error(error?.message || 'Unable to complete payment')
      }
    } finally {
      setUpgradingPlan('')
    }
  }

  if (loading) {
    return <div className="p-6 text-lg">Loading Profile...</div>
  }

  if (profileError) {
    return (
      <div className="flex min-h-screen flex-col bg-white dark:bg-slate-900">
        <Header />
        <main className="mx-auto w-full max-w-4xl flex-1 p-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Profile unavailable</h1>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{profileError}</p>
          <button
            type="button"
            onClick={loadProfile}
            className="mt-4 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
          >
            Retry
          </button>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-slate-900">
      <Header />

      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Account</p>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Manage Profile</h1>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl px-4 py-2 text-sm transition ${activeTab === tab ? 'bg-slate-900 text-white dark:bg-sky-700' : 'bg-white/70 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-900/60 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'Overview' ? (
          <section className="grid gap-5 md:grid-cols-2">
            <article className="rounded-2xl border border-white/40 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70">
              <div className="flex items-center gap-4">
                {user?.profile_picture ? (
                  <img
                    src={`${toAbsoluteFileUrl(user.profile_picture)}?t=${avatarBuster}`}
                    key={user?.profile_picture}
                    alt="Profile"
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <img
                    src="/default-avatar.png"
                    key={user?.profile_picture}
                    alt="Profile"
                    className="h-16 w-16 rounded-full object-cover"
                  />
                )}
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{user?.full_name || 'User'}</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{user?.email}</p>
                  <p className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {user?.account_type || 'Free'}
                  </p>
                </div>
              </div>
            </article>

            <article className="rounded-2xl border border-white/40 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Storage</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{formatBytes(used)} used of {formatBytes(total)}</p>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-600" style={{ width: `${storagePct}%` }} />
              </div>
            </article>
          </section>
        ) : null}

        {activeTab === 'Personal Info' ? (
          <section className="rounded-2xl border border-white/40 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm text-slate-700 dark:text-slate-200">
                Full Name
                <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" value={personalForm.full_name} onChange={(e) => setPersonalForm((p) => ({ ...p, full_name: e.target.value }))} />
              </label>
              <label className="text-sm text-slate-700 dark:text-slate-200">
                Username
                <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" value={personalForm.username} onChange={(e) => setPersonalForm((p) => ({ ...p, username: e.target.value }))} />
              </label>
              <label className="text-sm text-slate-700 dark:text-slate-200">
                Phone
                <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" value={personalForm.phone_number} onChange={(e) => setPersonalForm((p) => ({ ...p, phone_number: e.target.value }))} />
              </label>
              <label className="text-sm text-slate-700 dark:text-slate-200">
                DOB
                <input type="date" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" value={personalForm.dob?.slice(0, 10) || ''} onChange={(e) => setPersonalForm((p) => ({ ...p, dob: e.target.value }))} />
              </label>
              <label className="text-sm text-slate-700 dark:text-slate-200">
                Gender
                <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" value={personalForm.gender} onChange={(e) => setPersonalForm((p) => ({ ...p, gender: e.target.value }))} />
              </label>
              <label className="text-sm text-slate-700 dark:text-slate-200 md:col-span-2">
                Bio
                <textarea rows={3} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" value={personalForm.bio} onChange={(e) => setPersonalForm((p) => ({ ...p, bio: e.target.value }))} />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={handlePersonalSave} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">Save</button>
              <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition text-sm">
                Upload Photo
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    handlePhotoUpload(file)
                  }}
                />
              </label>
            </div>
          </section>
        ) : null}

        {activeTab === 'Security' ? (
          <section className="rounded-2xl border border-white/40 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm text-slate-700 dark:text-slate-200">
                Old Password
                <input type="password" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" value={securityForm.old_password} onChange={(e) => setSecurityForm((p) => ({ ...p, old_password: e.target.value }))} />
              </label>
              <label className="text-sm text-slate-700 dark:text-slate-200">
                New Password
                <input type="password" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" value={securityForm.new_password} onChange={(e) => setSecurityForm((p) => ({ ...p, new_password: e.target.value }))} />
              </label>
            </div>
            <button type="button" onClick={handlePasswordChange} className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-sky-700">Change Password</button>
            <div className="mt-6 flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <span className="text-sm text-slate-700 dark:text-slate-200">Enable 2FA</span>
              <button type="button" onClick={() => handleSecurityToggle(!securityForm.two_factor_enabled)} className={`rounded-full px-3 py-1 text-xs ${securityForm.two_factor_enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                {securityForm.two_factor_enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Last login: {user?.last_login ? new Date(user.last_login).toLocaleString() : 'N/A'}</p>
          </section>
        ) : null}

        {activeTab === 'Storage' ? (
          <section className="rounded-2xl border border-white/40 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-xs text-slate-500">Total</p><p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatStorageGb(total)}</p></div>
              <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-xs text-slate-500">Used</p><p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatBytes(used)}</p></div>
              <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-xs text-slate-500">Remaining</p><p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatBytes(remaining)}</p></div>
              <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-xs text-slate-500">Files</p><p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{fileCount}</p></div>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-600" style={{ width: `${storagePct}%` }} />
            </div>
            <div className="mt-5 rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-950/40">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Current Plan</p>
                  <h3 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{user?.account_type || 'Free'}</h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {formatBytes(used)} used of {formatBytes(total)}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-100 px-4 py-3 text-right dark:bg-slate-800">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Plan Status</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {user?.is_premium ? 'Premium active' : 'Free tier'}
                  </p>
                </div>
              </div>
            </div>
            <SubscriptionPlans
              currentPlan={currentPlan}
              paymentsEnabled={paymentsEnabled}
              upgradingPlan={upgradingPlan}
              onUpgrade={handlePlanUpgrade}
            />
          </section>
        ) : null}

        {activeTab === 'Settings' ? (
          <section className="rounded-2xl border border-white/40 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <span className="text-sm text-slate-700 dark:text-slate-200">Dark / Light Theme</span>
                <button type="button" onClick={toggleTheme} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white dark:bg-sky-700">{isDark ? 'Dark' : 'Light'}</button>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <span className="text-sm text-slate-700 dark:text-slate-200">Email notifications</span>
                <button type="button" onClick={() => setSettingsForm((p) => ({ ...p, email_notifications: !p.email_notifications }))} className={`rounded-full px-3 py-1 text-xs ${settingsForm.email_notifications ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{settingsForm.email_notifications ? 'On' : 'Off'}</button>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <span className="text-sm text-slate-700 dark:text-slate-200">Auto trash delete (UI only)</span>
                <button type="button" onClick={() => setSettingsForm((p) => ({ ...p, auto_trash_delete: !p.auto_trash_delete }))} className={`rounded-full px-3 py-1 text-xs ${settingsForm.auto_trash_delete ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{settingsForm.auto_trash_delete ? 'On' : 'Off'}</button>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div>
                  <span className="text-sm text-slate-700 dark:text-slate-200">Backup this device</span>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Device: {getCurrentDeviceName()}</p>
                </div>
                <button
                  type="button"
                  disabled={backupLoading}
                  onClick={() => handleBackupToggle(!backupEnabled)}
                  className={`rounded-full px-3 py-1 text-xs ${backupEnabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {backupLoading ? 'Saving...' : backupEnabled ? 'On' : 'Off'}
                </button>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Backup devices</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{backupDevices.length} connected</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {backupDevices.map((device) => (
                    <div key={device.name} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{device.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Last sync: {formatSyncTime(device.last_sync_at)}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Status: {device.status || 'Idle'}</p>
                    </div>
                  ))}
                  {!backupDevices.length ? (
                    <div className="text-sm text-slate-500 dark:text-slate-400">No backup devices connected.</div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </main>

      <Footer />
    </div>
  )
}

export default ProfilePage

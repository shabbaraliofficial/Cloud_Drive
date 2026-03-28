import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShell from '../components/auth/AuthShell'
import AuthInput from '../components/auth/AuthInput'
import { api } from '../lib/api'

const defaultForm = {
  fullName: '',
  dob: '',
  email: '',
  mobile: '',
  username: '',
  password: '',
  confirmPassword: '',
}

function RegisterPage() {
  const [form, setForm] = useState(defaultForm)
  const [errors, setErrors] = useState({})
  const [otpSent, setOtpSent] = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const [otpInput, setOtpInput] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()

  const canCreateAccount = useMemo(() => otpSent && otpVerified, [otpSent, otpVerified])

  const onFieldChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: '' }))
  }

  const validate = () => {
    const nextErrors = {}

    Object.entries(form).forEach(([key, value]) => {
      if (!value.trim()) {
        nextErrors[key] = 'This field is required.'
      }
    })

    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) {
      nextErrors.email = 'Enter a valid email address.'
    }

    if (form.mobile && !/^\+?[0-9]{10,15}$/.test(form.mobile)) {
      nextErrors.mobile = 'Enter a valid mobile number.'
    }

    if (form.password && form.password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters.'
    }

    if (form.confirmPassword && form.password !== form.confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match.'
    }

    return nextErrors
  }

  const handleRegisterSubmit = async (event) => {
    event.preventDefault()
    setStatusMessage('')
    const validationErrors = validate()

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    try {
      setIsSubmitting(true)
      await api.register({
        full_name: form.fullName.trim(),
        date_of_birth: form.dob,
        email: form.email.trim(),
        mobile_number: form.mobile.trim(),
        username: form.username.trim(),
        password: form.password,
      })
      setOtpSent(true)
      setOtpVerified(false)
      setOtpInput('')
      setStatusMessage('OTP sent to your email. Check inbox/spam and verify below.')
    } catch (error) {
      setStatusMessage(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const verifyOtp = async () => {
    setErrors((prev) => ({ ...prev, otp: '' }))
    try {
      await api.verifyOtp({
        email: form.email.trim(),
        otp_code: otpInput.trim(),
        purpose: 'register',
      })
      setOtpVerified(true)
      setStatusMessage('OTP verified successfully. You can now create your account.')
      return
    } catch (error) {
      setErrors((prev) => ({ ...prev, otp: error.message }))
    }
  }

  const createAccount = () => {
    navigate('/login', { state: { username: form.username } })
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Fill all required fields to register and verify via OTP before creating your account."
      sideText="Register once, verify quickly, and keep all your work folders in one secure cloud workspace."
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleRegisterSubmit}>
        <div className="sm:col-span-2">
          <AuthInput label="Full Name" name="fullName" value={form.fullName} onChange={onFieldChange} error={errors.fullName} />
        </div>
        <AuthInput label="Date of Birth" type="date" name="dob" value={form.dob} onChange={onFieldChange} error={errors.dob} />
        <AuthInput
          label="Email Address"
          type="email"
          name="email"
          value={form.email}
          onChange={onFieldChange}
          error={errors.email}
          placeholder="name@company.com"
          autoComplete="email"
        />
        <AuthInput
          label="Mobile Number"
          name="mobile"
          value={form.mobile}
          onChange={onFieldChange}
          error={errors.mobile}
          placeholder="+1 555 010 4433"
          autoComplete="tel"
        />
        <AuthInput
          label="Username"
          name="username"
          value={form.username}
          onChange={onFieldChange}
          error={errors.username}
          autoComplete="username"
        />
        <AuthInput
          label="Password"
          type="password"
          name="password"
          value={form.password}
          onChange={onFieldChange}
          error={errors.password}
          autoComplete="new-password"
        />
        <AuthInput
          label="Confirm Password"
          type="password"
          name="confirmPassword"
          value={form.confirmPassword}
          onChange={onFieldChange}
          error={errors.confirmPassword}
          autoComplete="new-password"
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="sm:col-span-2 mt-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-sky-700 dark:hover:bg-sky-600"
        >
          {isSubmitting ? 'Submitting...' : 'Submit and Send OTP'}
        </button>
      </form>

      <div className="text-center mt-4">
        <p className="text-gray-400">
          Already have an account?
          <Link
            to="/login"
            className="text-blue-400 hover:text-blue-300 font-semibold ml-1"
          >
            Login
          </Link>
        </p>
      </div>

      {statusMessage ? <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{statusMessage}</p> : null}

      {otpSent ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/80">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">OTP sent to {form.email} and {form.mobile}</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={otpInput}
              onChange={(event) => {
                setOtpInput(event.target.value)
                setErrors((prev) => ({ ...prev, otp: '' }))
              }}
              maxLength={6}
              placeholder="Enter 6-digit OTP"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
            />
            <button
              type="button"
              onClick={verifyOtp}
              className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              Verify OTP
            </button>
          </div>
          {errors.otp ? <p className="mt-2 text-xs text-rose-600">{errors.otp}</p> : null}

          {canCreateAccount ? (
            <button
              type="button"
              onClick={createAccount}
              className="mt-4 w-full rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-500"
            >
              Create Account
            </button>
          ) : null}
        </div>
      ) : null}
    </AuthShell>
  )
}

export default RegisterPage

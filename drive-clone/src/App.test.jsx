import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'

function fillRegistrationForm() {
  return {
    fill: async () => {
      await userEvent.type(screen.getByLabelText('Full Name'), 'QA Tester')
      await userEvent.type(screen.getByLabelText('Date of Birth'), '1999-12-30')
      await userEvent.type(screen.getByLabelText('Email Address'), 'qa@example.com')
      await userEvent.type(screen.getByLabelText('Mobile Number'), '+15550104433')
      await userEvent.type(screen.getByLabelText('Username'), 'qa_user')
      await userEvent.type(screen.getByLabelText('Password'), 'Password123!')
      await userEvent.type(screen.getByLabelText('Confirm Password'), 'Password123!')
    },
  }
}

describe('CloudDrive user flow tests', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.pushState({}, '', '/register')
  })

  afterEach(() => {
    cleanup()
  })

  it('shows validation errors when register form is submitted empty', async () => {
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /submit and send otp/i }))

    const errors = await screen.findAllByText('This field is required.')
    expect(errors.length).toBeGreaterThanOrEqual(7)
  })

  it('completes register + OTP verify + create account and redirects to login', async () => {
    render(<App />)

    await fillRegistrationForm().fill()
    await userEvent.click(screen.getByRole('button', { name: /submit and send otp/i }))

    expect(await screen.findByText(/otp sent to/i)).toBeInTheDocument()

    const otpLabel = screen.getByText(/demo otp:/i).textContent
    const otpCode = otpLabel.match(/(\d{6})/)[1]

    await userEvent.type(screen.getByPlaceholderText(/enter 6-digit otp/i), otpCode)
    await userEvent.click(screen.getByRole('button', { name: /verify otp/i }))

    const createAccountBtn = await screen.findByRole('button', { name: /create account/i })
    expect(createAccountBtn).toBeInTheDocument()

    await userEvent.click(createAccountBtn)

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('qa_user')).toBeInTheDocument()
  })

  it('logs in and switches real dashboard sections correctly', async () => {
    window.history.pushState({}, '', '/login')
    render(<App />)

    await userEvent.type(screen.getByLabelText('Username'), 'qa_user')
    await userEvent.type(screen.getByLabelText('Password'), 'Password123!')
    await userEvent.click(screen.getByRole('button', { name: /login securely/i }))

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /shared with me/i }))
    expect(await screen.findByRole('heading', { name: 'Shared with Me' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^bin$/i }))
    expect(await screen.findByRole('heading', { name: 'Bin' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /restore/i }).length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: /^storage$/i }))
    await waitFor(() => {
      expect(screen.getByText(/large files consuming space/i)).toBeInTheDocument()
    })
  })
})

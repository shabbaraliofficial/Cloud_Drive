import { useEffect, useState, useSyncExternalStore } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

import {
  closeDialog,
  getPopupSnapshot,
  submitDialog,
  subscribePopupStore,
  toast,
} from '../../lib/popup'

const POSITION_CLASSES = {
  'top-right': 'top-0 right-0 items-end',
  'top-left': 'top-0 left-0 items-start',
  'bottom-right': 'bottom-0 right-0 items-end',
  'bottom-left': 'bottom-0 left-0 items-start',
}

const TOAST_THEMES = {
  default: {
    title: 'Notice',
    icon: Info,
    accent: 'bg-sky-500',
    border: 'border-slate-200 dark:border-slate-700',
    iconWrap: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  },
  success: {
    title: 'Success',
    icon: CheckCircle2,
    accent: 'bg-emerald-500',
    border: 'border-emerald-200 dark:border-emerald-900/50',
    iconWrap: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  error: {
    title: 'Something went wrong',
    icon: AlertCircle,
    accent: 'bg-rose-500',
    border: 'border-rose-200 dark:border-rose-900/50',
    iconWrap: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  },
  warning: {
    title: 'Attention',
    icon: AlertTriangle,
    accent: 'bg-amber-500',
    border: 'border-amber-200 dark:border-amber-900/50',
    iconWrap: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
}

const DIALOG_THEMES = {
  default: {
    badge: 'text-sky-600',
    iconWrap: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    button: 'bg-sky-600 hover:bg-sky-500 focus-visible:outline-sky-500',
  },
  danger: {
    badge: 'text-rose-600',
    iconWrap: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    button: 'bg-rose-600 hover:bg-rose-500 focus-visible:outline-rose-500',
  },
  warning: {
    badge: 'text-amber-600',
    iconWrap: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    button: 'bg-amber-600 hover:bg-amber-500 focus-visible:outline-amber-500',
  },
}

function Toaster({ position = 'top-right' }) {
  const { toasts, dialog } = useSyncExternalStore(
    subscribePopupStore,
    getPopupSnapshot,
    getPopupSnapshot
  )
  const [promptValue, setPromptValue] = useState('')

  useEffect(() => {
    setPromptValue(dialog?.kind === 'prompt' ? dialog.initialValue || '' : '')
  }, [dialog])

  useEffect(() => {
    if (!dialog) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeDialog()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [dialog])

  const positionClassName = POSITION_CLASSES[position] || POSITION_CLASSES['top-right']
  const dialogTheme = DIALOG_THEMES[dialog?.tone] || DIALOG_THEMES.default
  const isPrompt = dialog?.kind === 'prompt'

  const handleDialogSubmit = (event) => {
    event.preventDefault()

    if (!dialog) return
    if (isPrompt) {
      const nextValue = promptValue.trim()
      if (!nextValue) return
      submitDialog(nextValue)
      return
    }

    submitDialog(true)
  }

  return (
    <>
      <div
        aria-live="polite"
        aria-atomic="false"
        className={`pointer-events-none fixed z-[140] flex w-[calc(100vw-1rem)] max-w-sm flex-col gap-3 p-4 sm:w-[380px] sm:p-6 ${positionClassName}`}
      >
        {toasts.map((item) => {
          const theme = TOAST_THEMES[item.variant] || TOAST_THEMES.default
          const Icon = theme.icon

          return (
            <div
              key={item.id}
              role="status"
              className={`pointer-events-auto overflow-hidden rounded-[22px] border bg-white/95 shadow-[0_18px_60px_rgba(15,23,42,0.18)] backdrop-blur dark:bg-slate-900/95 ${theme.border} ${item.visible ? 'animate-[toast-enter_220ms_cubic-bezier(0.16,1,0.3,1)]' : 'animate-[toast-exit_180ms_ease-in_forwards]'}`}
            >
              <div className="flex items-start gap-3 p-4">
                <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${theme.iconWrap}`}>
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {item.title || theme.title}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                    {item.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toast.dismiss(item.id)}
                  className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  aria-label="Dismiss notification"
                >
                  <X size={14} />
                </button>
              </div>
              <div className={`h-1 w-full ${theme.accent}`} />
            </div>
          )
        })}
      </div>

      {dialog ? (
        <div
          className="fixed inset-0 z-[150] animate-[modal-fade-in_180ms_ease-out] bg-slate-950/55 p-4 backdrop-blur-sm"
          onClick={closeDialog}
        >
          <div className="flex min-h-full items-center justify-center">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="popup-dialog-title"
              className="w-full max-w-md animate-[modal-pop-in_220ms_cubic-bezier(0.16,1,0.3,1)] rounded-[28px] border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.35)] dark:border-slate-700 dark:bg-slate-900"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="p-6 sm:p-7">
                <div className="flex items-start gap-4">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${dialogTheme.iconWrap}`}>
                    <AlertTriangle size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${dialogTheme.badge}`}>
                      {isPrompt ? 'Input required' : 'Please confirm'}
                    </p>
                    <h2
                      id="popup-dialog-title"
                      className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100"
                    >
                      {dialog.title}
                    </h2>
                    {dialog.message ? (
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                        {dialog.message}
                      </p>
                    ) : null}
                  </div>
                </div>

                <form className="mt-6 space-y-4" onSubmit={handleDialogSubmit}>
                  {isPrompt ? (
                    <input
                      autoFocus
                      aria-label={dialog.title}
                      value={promptValue}
                      onChange={(event) => setPromptValue(event.target.value)}
                      placeholder={dialog.placeholder}
                      className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:ring-sky-900/40"
                    />
                  ) : null}

                  <div className="flex flex-wrap justify-end gap-3">
                    <button
                      type="button"
                      onClick={closeDialog}
                      className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {dialog.cancelLabel}
                    </button>
                    <button
                      type="submit"
                      disabled={isPrompt && !promptValue.trim()}
                      className={`inline-flex h-11 items-center justify-center rounded-2xl px-4 text-sm font-medium text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${dialogTheme.button}`}
                    >
                      {dialog.confirmLabel}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default Toaster

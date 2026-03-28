const INITIAL_STATE = {
  toasts: [],
  dialog: null,
}

let popupState = INITIAL_STATE
const listeners = new Set()
const toastTimers = new Map()
let toastIdCounter = 0
let dialogIdCounter = 0

function emitChange() {
  listeners.forEach((listener) => listener())
}

function setPopupState(nextState) {
  popupState = nextState
  emitChange()
}

function updatePopupState(updater) {
  popupState = updater(popupState)
  emitChange()
}

function clearToastTimer(id) {
  if (typeof window === 'undefined') return
  const timer = toastTimers.get(id)
  if (!timer) return
  window.clearTimeout(timer)
  toastTimers.delete(id)
}

function removeToast(id) {
  clearToastTimer(id)
  updatePopupState((current) => ({
    ...current,
    toasts: current.toasts.filter((item) => item.id !== id),
  }))
}

function dismissToast(id) {
  clearToastTimer(id)
  updatePopupState((current) => ({
    ...current,
    toasts: current.toasts.map((item) => (
      item.id === id ? { ...item, visible: false } : item
    )),
  }))

  if (typeof window !== 'undefined') {
    window.setTimeout(() => removeToast(id), 180)
  }
}

function dismissAllToasts() {
  popupState.toasts.forEach((item) => dismissToast(item.id))
}

function createToast(message, options = {}) {
  if (!message) return null

  const id = options.id || `toast-${++toastIdCounter}`
  const duration = Number.isFinite(options.duration) ? options.duration : 3000
  const nextToast = {
    id,
    duration,
    message,
    title: options.title || null,
    variant: options.variant || 'default',
    visible: true,
  }

  updatePopupState((current) => ({
    ...current,
    toasts: [...current.toasts, nextToast],
  }))

  if (typeof window !== 'undefined') {
    clearToastTimer(id)
    toastTimers.set(id, window.setTimeout(() => dismissToast(id), duration))
  }

  return id
}

function openDialog(config) {
  if (popupState.dialog) {
    popupState.dialog.resolve(popupState.dialog.kind === 'prompt' ? null : false)
  }

  setPopupState({
    ...popupState,
    dialog: config,
  })
}

function settleDialog(result) {
  if (!popupState.dialog) return

  const activeDialog = popupState.dialog
  setPopupState({
    ...popupState,
    dialog: null,
  })
  activeDialog.resolve(result)
}

export function getPopupSnapshot() {
  return popupState
}

export function subscribePopupStore(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const toast = Object.assign(
  (message, options = {}) => createToast(message, options),
  {
    success(message, options = {}) {
      return createToast(message, { ...options, variant: 'success' })
    },
    error(message, options = {}) {
      return createToast(message, { ...options, variant: 'error' })
    },
    warning(message, options = {}) {
      return createToast(message, { ...options, variant: 'warning' })
    },
    dismiss(id) {
      if (id) {
        dismissToast(id)
        return
      }
      dismissAllToasts()
    },
  }
)

export function confirmAction(options = {}) {
  return new Promise((resolve) => {
    openDialog({
      id: `dialog-${++dialogIdCounter}`,
      kind: 'confirm',
      title: options.title || 'Are you sure?',
      message: options.message || 'Please confirm this action.',
      confirmLabel: options.confirmLabel || 'Confirm',
      cancelLabel: options.cancelLabel || 'Cancel',
      tone: options.tone || 'default',
      resolve,
    })
  })
}

export function promptAction(options = {}) {
  return new Promise((resolve) => {
    openDialog({
      id: `dialog-${++dialogIdCounter}`,
      kind: 'prompt',
      title: options.title || 'Enter a value',
      message: options.message || '',
      confirmLabel: options.confirmLabel || 'Continue',
      cancelLabel: options.cancelLabel || 'Cancel',
      tone: options.tone || 'default',
      initialValue: options.initialValue || '',
      placeholder: options.placeholder || '',
      resolve,
    })
  })
}

export function closeDialog() {
  if (!popupState.dialog) return
  settleDialog(popupState.dialog.kind === 'prompt' ? null : false)
}

export function submitDialog(value) {
  if (!popupState.dialog) return
  settleDialog(value)
}

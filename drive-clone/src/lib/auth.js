const ACCESS_TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'
const LEGACY_ACCESS_TOKEN_KEY = 'token'
const AUTH_CHANGE_EVENT = 'auth-change'

function notifyAuthChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
}

export function setAuthTokens(accessToken, refreshToken) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, accessToken)
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  }
  notifyAuthChange()
}

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY)
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function clearAuthTokens() {
  const hadTokens = Boolean(
    localStorage.getItem(ACCESS_TOKEN_KEY)
    || localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY)
    || localStorage.getItem(REFRESH_TOKEN_KEY)
  )
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  if (hadTokens) {
    notifyAuthChange()
  }
}

export function isAuthenticated() {
  return Boolean(getAccessToken())
}

export function getAuthSnapshot() {
  return isAuthenticated()
}

export function subscribeAuth(listener) {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const onChange = () => listener()
  window.addEventListener(AUTH_CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)

  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

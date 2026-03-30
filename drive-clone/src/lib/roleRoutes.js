function normalizeRole(role) {
  return String(role || 'user').trim().toLowerCase()
}

export function isAdminRole(role) {
  return normalizeRole(role) === 'admin'
}

export function getHomeRouteForRole(role) {
  return isAdminRole(role) ? '/admin' : '/'
}

export function getLoginRouteForRole(role) {
  return isAdminRole(role) ? '/admin/login' : '/login'
}

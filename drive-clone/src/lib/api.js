import { clearAuthTokens, getAccessToken, getRefreshToken, setAuthTokens } from './auth'
import { toast } from './popup'
import { normalizeStoragePayload } from './storage'

function getRuntimeBaseUrl() {
  const configuredBaseUrl = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '')
  if (configuredBaseUrl) return configuredBaseUrl

  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://127.0.0.1:8000'
    }
    return origin.replace(/\/+$/, '')
  }

  return import.meta.env.DEV ? 'http://127.0.0.1:8000' : ''
}

export const BASE_URL = getRuntimeBaseUrl()
export const CHUNK_SIZE = 5 * 1024 * 1024

const MULTIPART_THRESHOLD = 25 * 1024 * 1024
const MAX_RESUMABLE_FILE_SIZE = 10 * 1024 * 1024 * 1024
const UPLOAD_SESSIONS_STORAGE_KEY = 'drive.multipart-upload-sessions'
const MONGO_OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i
const GENERIC_UPLOAD_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown'])
const EXTENSION_MIME_TYPES = Object.freeze({
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
})
let refreshRequest = null

function createApiError(message, status = null, options = {}) {
  const error = new Error(message)
  error.status = status
  error.notified = Boolean(options.notified)
  error.redirected = Boolean(options.redirected)
  return error
}

export function resolveApiUrl(path = '') {
  if (!path) return BASE_URL
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

function isBrowser() {
  return typeof window !== 'undefined'
}

function getLoginRoute() {
  if (!isBrowser()) return '/login'
  return window.location.pathname.startsWith('/admin') ? '/admin/login' : '/login'
}

function notifyNetworkError(message = 'Network error. Unable to reach the backend right now.') {
  toast.error(message, {
    id: 'network-error',
    title: 'Network error',
  })
  return createApiError(message, 0, { notified: true })
}

function notifyServerError(message = 'Server error. Please try again in a moment.', status = 500) {
  toast.error(message, {
    id: `server-error-${status}`,
    title: 'Server error',
  })
  return createApiError(message, status, { notified: true })
}

function handleUnauthorized(message = 'Session expired. Please log in again.') {
  clearAuthTokens()
  toast.warning(message, {
    id: 'auth-error',
    title: 'Authentication required',
  })

  if (isBrowser()) {
    const target = getLoginRoute()
    if (window.location.pathname !== target) {
      window.location.assign(target)
    }
  }

  return createApiError(message, 401, { notified: true, redirected: true })
}

async function parseJsonResponse(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function getRequestToken(authMode) {
  const token = getAccessToken()
  if (authMode === true || authMode === 'required') {
    if (!token) {
      throw handleUnauthorized('Please log in to continue.')
    }
    return token
  }

  if (authMode === 'optional') {
    return token || null
  }

  return null
}

async function refreshAccessToken() {
  if (refreshRequest) {
    return refreshRequest
  }

  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    throw handleUnauthorized('Session expired. Please log in again.')
  }

  refreshRequest = fetch(resolveApiUrl('/api/auth/refresh'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
    .then(async (response) => {
      const data = await parseJsonResponse(response)

      if (!response.ok || !data?.access_token) {
        const message = data?.detail || data?.message || 'Session expired. Please log in again.'

        if (response.status === 401) {
          throw createApiError(message, 401)
        }

        if (response.status >= 500) {
          throw notifyServerError(message, response.status)
        }

        throw createApiError(message, response.status || 400)
      }

      setAuthTokens(data.access_token, data.refresh_token || refreshToken)
      return data.access_token
    })
    .catch((error) => {
      if (error?.status === 401) {
        throw handleUnauthorized(error.message || 'Session expired. Please log in again.')
      }
      if (error?.status) {
        throw error
      }
      throw notifyNetworkError('Network error. Unable to refresh your session.')
    })
    .finally(() => {
      refreshRequest = null
    })

  return refreshRequest
}

function readUploadSessions() {
  if (typeof window === 'undefined') return {}

  try {
    const value = window.localStorage.getItem(UPLOAD_SESSIONS_STORAGE_KEY)
    if (!value) return {}
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function writeUploadSessions(sessions) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(UPLOAD_SESSIONS_STORAGE_KEY, JSON.stringify(sessions))
}

function normalizeUploadFolderId(folderId) {
  const value = String(folderId ?? '').trim()
  if (!value) return null

  const normalized = value.toLowerCase()
  if (['null', 'undefined', 'root', 'drive', 'my-drive'].includes(normalized)) {
    return null
  }

  return MONGO_OBJECT_ID_PATTERN.test(value) ? value : null
}

function guessMimeTypeFromFilename(filename = '') {
  const trimmed = String(filename || '').trim().toLowerCase()
  const extension = trimmed.includes('.') ? trimmed.split('.').pop() : ''
  return EXTENSION_MIME_TYPES[extension] || ''
}

function normalizeUploadContentType(contentType, filename = '') {
  const cleaned = String(contentType || '').trim().toLowerCase()
  if (cleaned && !GENERIC_UPLOAD_MIME_TYPES.has(cleaned)) {
    return cleaned
  }
  return guessMimeTypeFromFilename(filename) || 'application/octet-stream'
}

function prepareUploadFile(file) {
  if (!file) return file

  const normalizedType = normalizeUploadContentType(file.type, file.name)
  if (normalizedType === String(file.type || '').trim().toLowerCase()) {
    return file
  }

  try {
    return new File([file], file.name, {
      type: normalizedType,
      lastModified: file.lastModified,
    })
  } catch {
    return file
  }
}

function normalizeUploadPayloadMime(payload = {}) {
  const filename = payload?.filename || payload?.file_name || ''
  const normalizedContentType = normalizeUploadContentType(payload?.content_type, filename)
  const normalizedMimeType = normalizeUploadContentType(payload?.mime_type, filename)
  return {
    ...payload,
    content_type: normalizedContentType,
    mime_type: normalizedMimeType,
  }
}

function buildUploadFingerprint(file, folderId) {
  return [normalizeUploadFolderId(folderId) || 'root', file.name, file.size, file.lastModified].join(':')
}

function getStoredUploadSession(file, folderId) {
  const sessions = readUploadSessions()
  return sessions[buildUploadFingerprint(file, folderId)] || null
}

function setStoredUploadSession(file, folderId, value) {
  const sessions = readUploadSessions()
  sessions[buildUploadFingerprint(file, folderId)] = value
  writeUploadSessions(sessions)
}

function clearStoredUploadSession(file, folderId) {
  const sessions = readUploadSessions()
  delete sessions[buildUploadFingerprint(file, folderId)]
  writeUploadSessions(sessions)
}

function emitUploadProgress(onProgress, payload) {
  onProgress?.({
    progress: Math.max(0, Math.min(100, payload.progress ?? 0)),
    uploadedBytes: payload.uploadedBytes ?? 0,
    totalBytes: payload.totalBytes ?? 0,
    phase: payload.phase || 'uploading',
    partNumber: payload.partNumber ?? null,
    totalParts: payload.totalParts ?? null,
  })
}

function getFilenameFromDisposition(value) {
  if (!value) return ''

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/["']/g, ''))
    } catch {
      return utf8Match[1].replace(/["']/g, '')
    }
  }

  const basicMatch = value.match(/filename="?([^"]+)"?/i)
  return basicMatch?.[1] || ''
}

async function request(path, options = {}, authMode = false, allowRefresh = true) {
  const headers = {
    ...(options.headers || {}),
  }

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  const token = getRequestToken(authMode)
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let response
  try {
    response = await fetch(resolveApiUrl(path), {
      ...options,
      headers,
    })
  } catch {
    throw notifyNetworkError('Network error. Unable to reach the backend.')
  }

  const canAttemptRefresh = allowRefresh
    && path !== '/api/auth/refresh'
    && response.status === 401
    && (authMode === true || authMode === 'required' || authMode === 'optional')
    && getRefreshToken()

  if (canAttemptRefresh) {
    try {
      await refreshAccessToken()
      return request(path, options, authMode, false)
    } catch (error) {
      throw error
    }
  }

  const data = await parseJsonResponse(response)

  if (!response.ok) {
    const message = data?.detail || data?.message || 'Request failed'

    if (response.status === 401 && (authMode === true || authMode === 'required' || authMode === 'optional')) {
      throw handleUnauthorized(message || 'Session expired. Please log in again.')
    }

    if (response.status >= 500) {
      throw notifyServerError(message, response.status)
    }

    throw createApiError(message, response.status)
  }

  return data
}

async function requestBlob(path, options = {}, authMode = false, allowRefresh = true) {
  const headers = {
    ...(options.headers || {}),
  }

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  const token = getRequestToken(authMode)
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let response
  try {
    response = await fetch(resolveApiUrl(path), {
      ...options,
      headers,
    })
  } catch {
    throw notifyNetworkError('Network error. Unable to reach the backend.')
  }

  const canAttemptRefresh = allowRefresh
    && path !== '/api/auth/refresh'
    && response.status === 401
    && (authMode === true || authMode === 'required' || authMode === 'optional')
    && getRefreshToken()

  if (canAttemptRefresh) {
    try {
      await refreshAccessToken()
      return requestBlob(path, options, authMode, false)
    } catch (error) {
      throw error
    }
  }

  if (!response.ok) {
    const data = await parseJsonResponse(response)
    const message = data?.detail || data?.message || 'Request failed'

    if (response.status === 401 && (authMode === true || authMode === 'required' || authMode === 'optional')) {
      throw handleUnauthorized(message || 'Session expired. Please log in again.')
    }

    if (response.status >= 500) {
      throw notifyServerError(message, response.status)
    }

    throw createApiError(message, response.status)
  }

  return {
    blob: await response.blob(),
    filename: getFilenameFromDisposition(response.headers.get('Content-Disposition')) || '',
  }
}

function normalizeProfileResponse(profile) {
  if (!profile || typeof profile !== 'object') {
    return profile
  }
  return {
    ...profile,
    ...normalizeStoragePayload(profile),
  }
}

function uploadDirectFile(file, folderId = null, onProgress) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(createApiError('No file selected for upload.'))
      return
    }
    if (!String(file.name || '').trim()) {
      reject(createApiError('Filename is required.'))
      return
    }
    if (Number(file.size || 0) <= 0) {
      reject(createApiError('File is empty. Choose a file with content before uploading.'))
      return
    }

    const token = getRequestToken(true)
    const formData = new FormData()
    const xhr = new XMLHttpRequest()
    const normalizedFolderId = normalizeUploadFolderId(folderId)
    const preparedFile = prepareUploadFile(file)

    formData.append('file', preparedFile)
    if (normalizedFolderId) {
      formData.append('folder_id', normalizedFolderId)
    }

    xhr.open('POST', resolveApiUrl('/api/files/upload'))
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      emitUploadProgress(onProgress, {
        progress: Math.round((event.loaded / event.total) * 100),
        uploadedBytes: event.loaded,
        totalBytes: event.total,
        phase: 'uploading',
      })
    }

    xhr.onload = async () => {
      let data = null
      try {
        data = JSON.parse(xhr.responseText || 'null')
      } catch {
        data = null
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        emitUploadProgress(onProgress, {
          progress: 100,
          uploadedBytes: file.size,
          totalBytes: file.size,
          phase: 'completed',
        })
        resolve(data)
        return
      }

      const message = data?.detail || data?.message || 'File upload failed'

      if (import.meta.env.DEV) {
        console.error('Direct upload failed', {
          status: xhr.status,
          message,
          filename: file.name,
          size: file.size,
          folderId: normalizedFolderId,
          response: data,
        })
      }

      if (xhr.status === 401) {
        reject(handleUnauthorized(message))
        return
      }

      if (xhr.status >= 500) {
        reject(notifyServerError(message, xhr.status))
        return
      }

      reject(createApiError(message, xhr.status))
    }

    xhr.onerror = () => {
      reject(notifyNetworkError('Network error. File upload failed.'))
    }

    xhr.send(formData)
  })
}

function uploadBlobToPresignedUrl(uploadUrl, blob, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    if (contentType) {
      xhr.setRequestHeader('Content-Type', contentType)
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress?.(event.loaded, event.total)
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag')
        if (!etag) {
          reject(createApiError('S3 part upload succeeded but did not return ETag. Expose ETag in your bucket CORS settings.'))
          return
        }
        resolve({ etag })
        return
      }

      if (xhr.status >= 500) {
        reject(notifyServerError('Direct upload failed on the server.', xhr.status))
        return
      }

      reject(createApiError('Direct S3 upload failed', xhr.status))
    }

    xhr.onerror = () => reject(notifyNetworkError('Network error. Direct upload failed.'))
    xhr.send(blob)
  })
}

async function uploadMultipartFile(file, folderId = null, onProgress) {
  const normalizedFolderId = normalizeUploadFolderId(folderId)
  const contentType = normalizeUploadContentType(file.type, file.name)

  if (file.size > MAX_RESUMABLE_FILE_SIZE) {
    throw new Error('Files larger than 10 GB are not supported yet.')
  }

  const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
  let uploadSession = getStoredUploadSession(file, normalizedFolderId)
  let uploadStatus = null

  if (uploadSession?.uploadId) {
    try {
      uploadStatus = await request(`/api/files/multipart/status/${uploadSession.uploadId}`, { method: 'GET' }, true)
      if (uploadStatus?.status === 'completed') {
        clearStoredUploadSession(file, normalizedFolderId)
        uploadSession = null
        uploadStatus = null
      }
    } catch {
      clearStoredUploadSession(file, normalizedFolderId)
      uploadSession = null
      uploadStatus = null
    }
  }

  if (!uploadSession) {
    const started = await request('/api/files/multipart/start', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        content_type: contentType,
        folder_id: normalizedFolderId,
        file_size: file.size,
        total_parts: totalParts,
      }),
    }, true)

    uploadSession = {
      uploadId: started.upload_id,
      key: started.key,
      fileUrl: started.file_url,
      totalParts,
    }
    setStoredUploadSession(file, normalizedFolderId, uploadSession)
    uploadStatus = {
      uploaded_parts: [],
      total_parts: totalParts,
      status: 'in_progress',
    }
  }

  const uploadedParts = new Map(
    (uploadStatus?.uploaded_parts || []).map((part) => [Number(part.PartNumber), part.ETag])
  )

  let completedBytes = 0
  uploadedParts.forEach((_, partNumber) => {
    const start = (partNumber - 1) * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    completedBytes += Math.max(0, end - start)
  })

  emitUploadProgress(onProgress, {
    progress: file.size ? Math.round((completedBytes / file.size) * 100) : 0,
    uploadedBytes: completedBytes,
    totalBytes: file.size,
    phase: completedBytes > 0 ? 'resuming' : 'starting',
    totalParts,
  })

  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    if (uploadedParts.has(partNumber)) {
      continue
    }

    const start = (partNumber - 1) * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const blob = file.slice(start, end)

    const partData = await request('/api/files/multipart/upload-part', {
      method: 'POST',
      body: JSON.stringify({
        upload_id: uploadSession.uploadId,
        key: uploadSession.key,
        part_number: partNumber,
      }),
    }, true)

    const { etag } = await uploadBlobToPresignedUrl(partData.upload_url, blob, contentType, (loaded) => {
      emitUploadProgress(onProgress, {
        progress: file.size ? Math.round(((completedBytes + loaded) / file.size) * 100) : 0,
        uploadedBytes: completedBytes + loaded,
        totalBytes: file.size,
        phase: 'uploading',
        partNumber,
        totalParts,
      })
    })

    const ackData = await request('/api/files/multipart/ack-part', {
      method: 'POST',
      body: JSON.stringify({
        upload_id: uploadSession.uploadId,
        key: uploadSession.key,
        part_number: partNumber,
        etag,
      }),
    }, true)

    uploadedParts.clear()
    ;(ackData?.uploaded_parts || []).forEach((part) => {
      uploadedParts.set(Number(part.PartNumber), part.ETag)
    })

    completedBytes += blob.size
    emitUploadProgress(onProgress, {
      progress: file.size ? Math.round((completedBytes / file.size) * 100) : 100,
      uploadedBytes: completedBytes,
      totalBytes: file.size,
      phase: 'uploading',
      partNumber,
      totalParts,
    })
  }

  const sortedParts = [...uploadedParts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([PartNumber, ETag]) => ({ PartNumber, ETag }))

  emitUploadProgress(onProgress, {
    progress: 100,
    uploadedBytes: file.size,
    totalBytes: file.size,
    phase: 'finishing',
    totalParts,
  })

  try {
    const completed = await request('/api/files/multipart/complete', {
      method: 'POST',
      body: JSON.stringify({
        upload_id: uploadSession.uploadId,
        key: uploadSession.key,
        filename: file.name,
        mime_type: contentType,
        file_size: file.size,
        folder_id: normalizedFolderId,
        parts: sortedParts,
      }),
    }, true)

    clearStoredUploadSession(file, normalizedFolderId)
    emitUploadProgress(onProgress, {
      progress: 100,
      uploadedBytes: file.size,
      totalBytes: file.size,
      phase: 'completed',
      totalParts,
    })
    return completed
  } catch (error) {
    setStoredUploadSession(file, normalizedFolderId, uploadSession)
    throw error
  }
}

export const api = {
  register(payload) {
    return request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  verifyOtp(payload) {
    return request('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  login(payload) {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  socialLogin(provider) {
    return request(`/api/auth/social/${provider}`, {
      method: 'POST',
      body: JSON.stringify({ provider }),
    })
  },

  refreshToken() {
    return request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: getRefreshToken() }),
    })
  },

  logout() {
    const refreshToken = getRefreshToken()
    return request('/api/auth/logout', {
      method: 'POST',
      headers: refreshToken ? { 'X-Refresh-Token': refreshToken } : {},
    }, true, false)
  },

  getProfile() {
    return request('/api/user/profile', { method: 'GET' }, true).then(normalizeProfileResponse)
  },

  getAdminStats() {
    return request('/api/admin/stats', { method: 'GET' }, true)
  },

  getAdminAnalytics() {
    return request('/api/admin/analytics', { method: 'GET' }, true)
  },

  getAdminUsers() {
    return request('/api/admin/users', { method: 'GET' }, true)
  },

  getAdminUserProfile(userId) {
    return request(`/api/admin/user/${userId}`, { method: 'GET' }, true)
  },

  deleteAdminUser(userId) {
    return request(`/api/admin/user/${userId}`, { method: 'DELETE' }, true)
  },

  toggleAdminUserBan(userId) {
    return request(`/api/admin/user/${userId}/ban`, { method: 'PATCH' }, true)
  },

  removeAdminUserPremium(userId) {
    return request(`/api/admin/user/${userId}/plan/free`, { method: 'PATCH' }, true)
  },

  getAdminFiles() {
    return request('/api/admin/files', { method: 'GET' }, true)
  },

  deleteAdminFile(fileId) {
    return request(`/api/admin/file/${fileId}`, { method: 'DELETE' }, true)
  },

  createOrder(payload) {
    return request('/api/create-order', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, true)
  },

  verifyPayment(payload) {
    return request('/api/verify-payment', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, true)
  },

  updateProfile(payload) {
    return request('/api/user/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, true).then(normalizeProfileResponse)
  },

  getFiles() {
    return request('/api/drive/files', { method: 'GET' }, true)
  },

  getFolderContents(folderId) {
    return request(`/api/storage/folder/${folderId}`, { method: 'GET' }, true)
  },

  getMedia() {
    return request('/api/media', { method: 'GET' }, true)
  },

  getRecentFiles() {
    return request('/api/drive/recent', { method: 'GET' }, true)
  },

  getStarredFiles() {
    return request('/api/drive/starred', { method: 'GET' }, true)
  },

  getFolders() {
    return request('/api/folders', { method: 'GET' }, true)
  },

  getFoldersBySection(section) {
    return request(`/api/folders?section=${encodeURIComponent(section)}`, { method: 'GET' }, true)
  },

  createFolder(payload) {
    return request('/api/folders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, true)
  },

  async uploadFile(file, folderId = null, options = {}) {
    const onProgress = options?.onProgress
    if (file.size > MULTIPART_THRESHOLD) {
      return uploadMultipartFile(file, folderId, onProgress)
    }
    return uploadDirectFile(file, folderId, onProgress)
  },

  getUploadUrl(payload) {
    const normalizedPayload = normalizeUploadPayloadMime(payload)
    return request('/api/files/get-upload-url', {
      method: 'POST',
      body: JSON.stringify(normalizedPayload),
    }, true)
  },

  completeDirectUpload(payload) {
    const normalizedPayload = normalizeUploadPayloadMime(payload)
    return request('/api/files/complete-upload', {
      method: 'POST',
      body: JSON.stringify(normalizedPayload),
    }, true)
  },

  startMultipartUpload(payload) {
    const normalizedPayload = normalizeUploadPayloadMime(payload)
    return request('/api/files/multipart/start', {
      method: 'POST',
      body: JSON.stringify(normalizedPayload),
    }, true)
  },

  getMultipartUploadStatus(uploadId) {
    return request(`/api/files/multipart/status/${uploadId}`, { method: 'GET' }, true)
  },

  getMultipartPartUploadUrl(payload) {
    return request('/api/files/multipart/upload-part', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, true)
  },

  ackMultipartPart(payload) {
    return request('/api/files/multipart/ack-part', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, true)
  },

  completeMultipartUpload(payload) {
    const normalizedPayload = normalizeUploadPayloadMime(payload)
    return request('/api/files/multipart/complete', {
      method: 'POST',
      body: JSON.stringify(normalizedPayload),
    }, true)
  },

  async uploadToPresignedUrl(uploadUrl, file, contentType, onProgress) {
    return uploadBlobToPresignedUrl(uploadUrl, file, contentType, onProgress)
  },

  createShareLink(fileId, payload = {}) {
    return request(`/api/files/${fileId}/share`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, true)
  },

  shareItem(payload) {
    return request('/api/share', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, true)
  },

  getSharedFile(token) {
    return request(`/api/files/share/${token}`, { method: 'GET' }, 'optional')
  },

  getFile(fileId) {
    return request(`/api/files/${fileId}`, { method: 'GET' }, true)
  },

  getFileVersions(fileId) {
    return request(`/api/files/${fileId}/versions`, { method: 'GET' }, true)
  },

  restoreFileVersion(fileId, versionId) {
    return request(`/api/files/${fileId}/restore-version`, {
      method: 'POST',
      body: JSON.stringify({ version_id: versionId }),
    }, true)
  },

  downloadFilesZip(fileIds = []) {
    return requestBlob('/api/files/download-zip', {
      method: 'POST',
      body: JSON.stringify({ file_ids: fileIds }),
    }, true)
  },

  getTrash() {
    return request('/api/trash', { method: 'GET' }, true)
  },

  restoreTrashItem(itemId) {
    return request(`/api/trash/restore/${itemId}`, { method: 'POST' }, true)
  },

  permanentlyDeleteTrashItem(itemId) {
    return request(`/api/trash/delete/${itemId}`, { method: 'POST' }, true)
  },

  emptyTrash() {
    return request('/api/trash/empty', { method: 'POST' }, true)
  },

  deleteFile(fileId) {
    return request(`/api/files/${fileId}`, { method: 'DELETE' }, true)
  },

  deleteFolder(folderId) {
    return request(`/api/folders/${folderId}`, { method: 'DELETE' }, true)
  },

  renameFile(fileId, name) {
    return request(`/api/files/${fileId}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ new_name: name }),
    }, true)
  },

  renameFolder(folderId, name) {
    return request(`/api/folders/${folderId}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ new_name: name }),
    }, true)
  },

  moveStorageItem(fileId, folderId) {
    return request('/api/storage/move', {
      method: 'PUT',
      body: JSON.stringify({
        file_id: fileId,
        folder_id: folderId,
      }),
    }, true)
  },

  moveFileToFolder(fileId, folderId) {
    return request(`/api/files/${fileId}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ folder_id: folderId }),
    }, true)
  },

  searchDrive(params = {}) {
    const search = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return
      if (typeof value === 'boolean') {
        if (value) search.set(key, 'true')
        return
      }
      search.set(key, String(value))
    })
    const query = search.toString()
    return request(`/api/search${query ? `?${query}` : ''}`, { method: 'GET' }, true)
  },

  getUserDirectory() {
    return request('/api/user/directory', { method: 'GET' }, true)
  },

  async toggleStar(fileId, isStarred = true) {
    try {
      return await request(
        `/api/drive/${fileId}/star`,
        { method: 'PATCH', body: JSON.stringify({ is_starred: isStarred }) },
        true
      )
    } catch {
      return request(
        `/api/files/${fileId}/star`,
        { method: 'PUT' },
        true
      )
    }
  },

  uploadProfilePhoto(formData) {
    return request('/api/profile/upload-photo', {
      method: 'POST',
      body: formData,
    }, true)
  },

  getStorageUsage() {
    return request('/api/storage/usage', { method: 'GET' }, true).then((data) => normalizeStoragePayload(data))
  },

  changePassword(payload) {
    return request('/api/profile/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, true)
  },

  updateSecurity(payload) {
    return request('/api/profile/security', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, true)
  },

  getBackupSettings() {
    return request('/api/profile/backup', { method: 'GET' }, true)
  },

  updateBackupSettings(payload) {
    return request('/api/profile/backup', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, true)
  },
}

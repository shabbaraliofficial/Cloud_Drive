import { API_BASE_URL } from './api'

export function toAbsoluteFileUrl(url) {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  return `${API_BASE_URL}${url}`
}

export function detectFileKind(mime = '', filename = '') {
  const lowerMime = mime.toLowerCase()
  const lowerName = filename.toLowerCase()

  if (lowerMime.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(lowerName)) return 'image'
  if (lowerMime.includes('pdf') || lowerName.endsWith('.pdf')) return 'pdf'
  if (lowerMime.startsWith('video/') || /\.(mp4|webm|ogg|mov|mkv|avi)$/.test(lowerName)) return 'video'
  if (lowerMime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(lowerName)) return 'audio'
  if (
    lowerMime.startsWith('text/')
    || /\.(txt|md|json|csv|xml|log|py|js|jsx|ts|tsx|html|css)$/.test(lowerName)
  ) return 'text'

  return 'other'
}

export function isMediaFile(file) {
  const kind = typeof file === 'string'
    ? file
    : file?.kind || detectFileKind(file?.mimeType || file?.mime_type || '', file?.name || file?.file_name || '')
  return kind === 'image' || kind === 'video'
}

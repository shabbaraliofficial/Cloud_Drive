function toSafeByteValue(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }
  return Math.round(parsed)
}

export function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function formatStorageGb(bytes = 0) {
  const safeBytes = toSafeByteValue(bytes, 0)
  return `${(safeBytes / (1024 ** 3)).toFixed(1)} GB`
}

export function normalizeStoragePayload(payload = {}) {
  const used = toSafeByteValue(payload.used ?? payload.used_bytes ?? payload.storage_used, 0)
  const total = toSafeByteValue(
    payload.total ?? payload.quota_bytes ?? payload.storage_limit ?? payload.limit,
    0
  )
  const remaining = toSafeByteValue(
    payload.remaining ?? payload.available_bytes,
    Math.max(total - used, 0)
  )

  const rawUsedPercent = Number(payload.usedPercent ?? payload.used_percent)
  const usedPercent = Number.isFinite(rawUsedPercent)
    ? Math.min(100, Math.max(0, Math.round(rawUsedPercent)))
    : total
      ? Math.min(100, Math.max(0, Math.round((used / total) * 100)))
      : 0

  const fileCount = toSafeByteValue(payload.fileCount ?? payload.file_count, 0)

  return {
    ...payload,
    used,
    total,
    remaining,
    usedPercent,
    fileCount,
    storage_used: used,
    storage_limit: total,
    used_bytes: used,
    quota_bytes: total,
    available_bytes: remaining,
    used_percent: usedPercent,
    limit: total,
    file_count: fileCount,
  }
}

export function formatStorageSummary(payload = {}) {
  const storage = normalizeStoragePayload(payload)
  return `${formatBytes(storage.used)} used of ${formatBytes(storage.total)}`
}

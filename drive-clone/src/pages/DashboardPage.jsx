import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText as FileTextIcon,
  Folder as FolderIcon,
  LayoutGrid,
  List,
  MoreHorizontal,
  Music4,
  Presentation,
  Sparkles,
  Video as VideoIcon,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import {
  BulkFileActionsBar,
  FilesTable,
  FolderGrid,
  SidebarNav,
  StoragePanel,
  ViewHeader,
} from '../components/dashboard/DashboardSections'
import DriveFilterBar from '../components/dashboard/DriveFilterBar'
import MediaGallery from '../components/dashboard/MediaGallery'
import TrashView from '../components/dashboard/TrashView'
import FilePreviewModal from '../components/file/FilePreviewModal'
import ContextMenu from '../components/file/ContextMenu'
import ShareDialog from '../components/file/ShareDialog'
import VersionHistoryDialog from '../components/file/VersionHistoryDialog'
import Footer from '../components/layout/Footer'
import Header from '../components/layout/Header'
import Breadcrumbs from '../components/navigation/Breadcrumbs'
import AdvancedSearchModal from '../components/search/AdvancedSearchModal'
import UploadManager from '../components/upload/UploadManager'
import { DriveProvider, useDrive } from '../context/DriveContext'
import useProfile from '../hooks/useProfile'
import { clearAuthTokens } from '../lib/auth'
import { confirmAction, promptAction, toast } from '../lib/popup'
import { detectFileKind, isMediaFile, toAbsoluteFileUrl } from '../lib/filePreview'
import { api } from '../lib/api'
import {
  buildSearchRequestParams,
  createAdvancedSearchFilters,
  createAdvancedSearchFormValues,
  hasAdvancedSearchFilters,
} from '../lib/search'
import { formatBytes, normalizeStoragePayload } from '../lib/storage'

const FOLDER_COLORS = [
  'from-sky-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-orange-500 to-amber-600',
  'from-cyan-500 to-sky-600',
  'from-indigo-500 to-blue-600',
]

const EMPTY_STORAGE = normalizeStoragePayload()
const DEFAULT_DRIVE_VIEW_FILTERS = Object.freeze({
  type: 'all',
  people: 'anyone',
  modified: 'any_time',
  source: 'all',
})
const RELATIVE_TIME_UNITS = [
  ['year', 1000 * 60 * 60 * 24 * 365],
  ['month', 1000 * 60 * 60 * 24 * 30],
  ['week', 1000 * 60 * 60 * 24 * 7],
  ['day', 1000 * 60 * 60 * 24],
  ['hour', 1000 * 60 * 60],
  ['minute', 1000 * 60],
]
const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function isAuthFailure(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('missing bearer token')
    || message.includes('please log in again')
    || message.includes('unauthorized')
    || message.includes('invalid credentials')
}

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Updated recently'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'Updated recently'
  return `Updated ${date.toLocaleDateString()}`
}

function createDriveViewFilters(overrides = {}) {
  return {
    ...DEFAULT_DRIVE_VIEW_FILTERS,
    ...overrides,
  }
}

function countDriveViewFilters(filters = {}) {
  const normalized = createDriveViewFilters(filters)
  return Object.entries(DEFAULT_DRIVE_VIEW_FILTERS).reduce(
    (count, [key, defaultValue]) => (normalized[key] !== defaultValue ? count + 1 : count),
    0
  )
}

function parseSafeDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function matchesModifiedFilter(item, modifiedFilter) {
  if (!modifiedFilter || modifiedFilter === 'any_time') return true

  const date = parseSafeDate(item.updatedAt || item.createdAt || item.lastAccessedAt)
  if (!date) return false

  const now = new Date()
  if (modifiedFilter === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return date >= start && date <= now
  }
  if (modifiedFilter === 'last_7_days') {
    return date >= new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000))
  }
  if (modifiedFilter === 'last_30_days') {
    return date >= new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000))
  }
  return true
}

function isDocsItem(item) {
  const name = String(item.name || '').toLowerCase()
  const mimeType = String(item.mimeType || '').toLowerCase()
  return /\.(pdf|doc|docx|txt|rtf|odt|ppt|pptx|xls|xlsx|csv|md)$/i.test(name)
    || /(pdf|msword|officedocument|text\/|spreadsheet|presentation)/i.test(mimeType)
}

function matchesTypeFilter(item, typeFilter, itemKind = 'file') {
  if (!typeFilter || typeFilter === 'all') return true
  if (typeFilter === 'folders') return itemKind === 'folder'
  if (typeFilter === 'files') return itemKind === 'file'
  if (itemKind === 'folder') return false
  if (typeFilter === 'docs') return isDocsItem(item)
  return item.kind === typeFilter
}

function matchesPeopleFilter(item, peopleFilter, currentUserId) {
  if (!peopleFilter || peopleFilter === 'anyone') return true

  const ownerId = String(item.ownerId || '')
  const currentId = String(currentUserId || '')
  const isMine = Boolean(currentId) && ownerId === currentId
  const hasSharing = Array.isArray(item.sharedWith) && item.sharedWith.length > 0

  if (peopleFilter === 'me') return isMine
  if (peopleFilter === 'others') return currentId ? !isMine : Boolean(ownerId)
  if (peopleFilter === 'shared') return currentId ? (hasSharing || !isMine) : hasSharing
  return true
}

function matchesSourceFilter(item, sourceFilter, currentUserId, itemKind = 'file') {
  if (!sourceFilter || sourceFilter === 'all') return true

  const ownerId = String(item.ownerId || '')
  const currentId = String(currentUserId || '')
  const isMine = Boolean(currentId) && ownerId === currentId
  const hasSharing = Array.isArray(item.sharedWith) && item.sharedWith.length > 0
  const isNested = itemKind === 'folder' ? Boolean(item.parentId) : Boolean(item.folderId)

  if (sourceFilter === 'drive') return !isNested
  if (sourceFilter === 'folder') return isNested
  if (sourceFilter === 'shared') return currentId ? (hasSharing || !isMine) : hasSharing
  return true
}

function normalizeFolders(rawFolders = [], rawFiles = []) {
  const filesPerFolder = rawFiles.reduce((acc, file) => {
    if (!file.folder_id) return acc
    acc.set(file.folder_id, (acc.get(file.folder_id) || 0) + 1)
    return acc
  }, new Map())

  return rawFolders.map((folder, index) => ({
    id: folder.id,
    name: folder.name || 'Untitled folder',
    files: filesPerFolder.get(folder.id) || 0,
    updated: formatTimestamp(folder.updated_at),
    updatedAt: folder.updated_at || null,
    createdAt: folder.created_at || null,
    lastAccessedAt: folder.last_accessed || folder.last_accessed_at || folder.accessed_at || null,
    parentId: folder.parent_folder_id || folder.parent_folder || null,
    ownerId: folder.owner_id || null,
    sharedWith: Array.isArray(folder.shared_with) ? folder.shared_with : [],
    permission: folder.permission || 'write',
    color: FOLDER_COLORS[index % FOLDER_COLORS.length],
  }))
}

function filterFoldersByParent(rawFolders = [], parentId = null) {
  return rawFolders.filter((folder) => {
    const folderParent = folder.parent_folder_id || folder.parent_folder || null
    return String(folderParent || '') === String(parentId || '')
  })
}

function buildFolderTree(rawFolders = []) {
  const byId = new Map()
  const roots = []

  rawFolders.forEach((folder) => {
    byId.set(String(folder.id), {
      id: folder.id,
      name: folder.name || 'Untitled folder',
      parentId: folder.parent_folder_id || folder.parent_folder || null,
      children: [],
    })
  })

  byId.forEach((node) => {
    if (node.parentId && byId.has(String(node.parentId))) {
      byId.get(String(node.parentId)).children.push(node)
    } else {
      roots.push(node)
    }
  })

  return roots
}

function normalizeFiles(rawFiles = [], rawFolders = []) {
  const folderNameById = new Map(rawFolders.map((folder) => [folder.id, folder.name]))

  return rawFiles.map((file) => {
    const name = file.file_name || file.name || 'Untitled file'
    const bytes = file.file_size || file.size || 0
    const mimeType = file.mime_type || file.file_type || file.content_type || 'application/octet-stream'
    const fileUrl = toAbsoluteFileUrl(file.file_url || file.storage_path || '')
    const thumbnailUrl = toAbsoluteFileUrl(file.thumbnail_url || file.file_url || file.storage_path || '')

    return {
      id: file.id,
      name,
      activity: formatTimestamp(file.updated_at),
      owner: file.owner_name || file.owner || 'You',
      ownerId: file.owner_id || null,
      location: file.folder_id ? folderNameById.get(file.folder_id) || 'Folder' : 'My Drive',
      size: formatBytes(bytes),
      sizeBytes: bytes,
      mimeType,
      storagePath: fileUrl,
      fileUrl,
      thumbnailUrl,
      folderId: file.folder_id || null,
      starred: !!file.is_starred,
      deleted: !!file.is_deleted,
      deletedAt: file.deleted_at || null,
      createdAt: file.created_at || null,
      updatedAt: file.updated_at || null,
      lastOpenedAt: file.last_opened || file.last_opened_at || file.opened_at || null,
      lastAccessedAt: file.last_accessed || file.last_accessed_at || file.accessed_at || null,
      sharedWith: Array.isArray(file.shared_with) ? file.shared_with : [],
      tags: Array.isArray(file.tags) ? file.tags : [],
      versionCount: Number(file.version_count || 0),
      kind: detectFileKind(mimeType, name),
    }
  })
}

function normalizeTrashFileItems(rawFiles = [], rawFolders = []) {
  return normalizeFiles(rawFiles, rawFolders).map((file) => ({
    ...file,
    type: 'file',
  }))
}

function normalizeTrashFolderItems(rawFolders = []) {
  return rawFolders.map((folder, index) => ({
    id: folder.id,
    type: 'folder',
    name: folder.name || 'Untitled folder',
    deletedAt: folder.deleted_at || folder.updated_at || null,
    size: '',
    kind: 'folder',
    thumbnailUrl: '',
    color: FOLDER_COLORS[index % FOLDER_COLORS.length],
  }))
}

function sortTrashItems(items = []) {
  return [...items].sort((a, b) => {
    const left = new Date(a.deletedAt || 0).getTime()
    const right = new Date(b.deletedAt || 0).getTime()
    return right - left
  })
}

function getFolderIdFromSearch(search) {
  const value = new URLSearchParams(search).get('folder')
  return value || null
}

function getFolderIdFromPath(pathname) {
  const dedicatedMatch = pathname.match(/^\/folder\/([^/]+)$/)
  if (dedicatedMatch?.[1]) return dedicatedMatch[1]
  const match = pathname.match(/^\/dashboard\/folder\/([^/]+)$/)
  return match?.[1] || null
}

function getViewMeta(selectedNav, selectedFolder) {
  if (selectedFolder) {
    return {
      title: selectedFolder.name || 'Folder',
      subtitle: null,
    }
  }

  switch (selectedNav) {
    case 'home':
      return {
        title: 'Welcome to Cloud Drive',
        subtitle: null,
      }
    case 'my-drive':
      return {
        title: 'My Drive',
        subtitle: null,
      }
    case 'media':
    case 'photos':
      return {
        title: 'Media',
        subtitle: null,
      }
    case 'recent':
      return {
        title: 'Recent',
        subtitle: null,
      }
    case 'starred':
      return {
        title: 'Starred',
        subtitle: null,
      }
    case 'bin':
      return {
        title: 'Trash',
        subtitle: null,
      }
    case 'storage':
      return {
        title: 'Storage',
        subtitle: null,
      }
    default:
      return {
        title: 'My Drive',
        subtitle: null,
      }
  }
}

function getFirstValidTimestamp(...values) {
  for (const value of values) {
    if (!value) continue
    const timestamp = typeof value === 'number' ? value : new Date(value).getTime()
    if (!Number.isNaN(timestamp) && timestamp > 0) {
      return timestamp
    }
  }
  return 0
}

function formatRelativeTime(value) {
  const timestamp = getFirstValidTimestamp(value)
  if (!timestamp) return 'recently'

  const difference = timestamp - Date.now()
  if (Math.abs(difference) < 45 * 1000) {
    return 'just now'
  }

  for (const [unit, unitMs] of RELATIVE_TIME_UNITS) {
    if (Math.abs(difference) >= unitMs || unit === 'minute') {
      return RELATIVE_TIME_FORMATTER.format(Math.round(difference / unitMs), unit)
    }
  }

  return 'recently'
}

function compareSuggestedFolders(left, right) {
  const leftTimestamp = getFirstValidTimestamp(left.lastAccessedAt, left.updatedAt, left.createdAt)
  const rightTimestamp = getFirstValidTimestamp(right.lastAccessedAt, right.updatedAt, right.createdAt)
  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp
  }
  if ((left.files || 0) !== (right.files || 0)) {
    return (right.files || 0) - (left.files || 0)
  }
  return String(left.name || '').localeCompare(String(right.name || ''))
}

function compareSuggestedFiles(left, right) {
  const leftTimestamp = getFirstValidTimestamp(left.lastOpenedAt, left.lastAccessedAt, left.updatedAt, left.createdAt)
  const rightTimestamp = getFirstValidTimestamp(right.lastOpenedAt, right.lastAccessedAt, right.updatedAt, right.createdAt)
  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp
  }
  if ((left.sizeBytes || 0) !== (right.sizeBytes || 0)) {
    return (right.sizeBytes || 0) - (left.sizeBytes || 0)
  }
  return String(left.name || '').localeCompare(String(right.name || ''))
}

function getFileExtension(name = '') {
  const segments = String(name).split('.')
  return segments.length > 1 ? segments.pop().toLowerCase() : ''
}

function getFileVisual(file) {
  const extension = getFileExtension(file.name)

  if (file.kind === 'image') {
    return { Icon: FileImage, tone: 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300' }
  }

  if (file.kind === 'video') {
    return { Icon: VideoIcon, tone: 'bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-300' }
  }

  if (file.kind === 'audio') {
    return { Icon: Music4, tone: 'bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-950/30 dark:text-fuchsia-300' }
  }

  if (file.kind === 'pdf') {
    return { Icon: FileTextIcon, tone: 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300' }
  }

  if (['xls', 'xlsx', 'csv'].includes(extension)) {
    return { Icon: FileSpreadsheet, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-300' }
  }

  if (['ppt', 'pptx', 'key'].includes(extension)) {
    return { Icon: Presentation, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-300' }
  }

  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) {
    return { Icon: FileArchive, tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' }
  }

  if (['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'py'].includes(extension)) {
    return { Icon: FileCode2, tone: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300' }
  }

  return { Icon: FileTextIcon, tone: 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300' }
}

function getFileActivityMeta(file) {
  const openedTimestamp = getFirstValidTimestamp(file.lastOpenedAt, file.lastAccessedAt)
  if (openedTimestamp) {
    return `You opened - ${formatRelativeTime(openedTimestamp)}`
  }

  const updatedTimestamp = getFirstValidTimestamp(file.updatedAt)
  if (updatedTimestamp) {
    return `Updated - ${formatRelativeTime(updatedTimestamp)}`
  }

  const createdTimestamp = getFirstValidTimestamp(file.createdAt)
  if (createdTimestamp) {
    return `Uploaded - ${formatRelativeTime(createdTimestamp)}`
  }

  return 'Updated - recently'
}

function getFolderActivityMeta(folder) {
  const accessedTimestamp = getFirstValidTimestamp(folder.lastAccessedAt)
  if (accessedTimestamp) {
    return `Opened ${formatRelativeTime(accessedTimestamp)}`
  }

  const updatedTimestamp = getFirstValidTimestamp(folder.updatedAt)
  if (updatedTimestamp) {
    return `Updated ${formatRelativeTime(updatedTimestamp)}`
  }

  const createdTimestamp = getFirstValidTimestamp(folder.createdAt)
  if (createdTimestamp) {
    return `Created ${formatRelativeTime(createdTimestamp)}`
  }

  return 'Updated recently'
}

function getItemOwnerLabel(item, currentUser) {
  if (item.ownerId && currentUser?.id && String(item.ownerId) !== String(currentUser.id)) {
    return 'Shared'
  }
  return item.owner || 'You'
}

function getFileLocationLabel(file, currentUser) {
  if (file.folderId && file.location && file.location !== 'Folder') {
    return file.location
  }
  if (file.ownerId && currentUser?.id && String(file.ownerId) !== String(currentUser.id)) {
    return 'Shared with me'
  }
  return file.location || 'My Drive'
}

function getFolderLocationLabel(folder, currentUser) {
  if (folder.ownerId && currentUser?.id && String(folder.ownerId) !== String(currentUser.id)) {
    return 'Shared with me'
  }
  return 'in My Drive'
}

function getInitials(value = '') {
  const words = String(value).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return 'Y'
  return words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join('')
}

function HomeEmptyState({ text }) {
  return (
    <div className="rounded-[12px] border border-dashed border-slate-300 bg-white/80 px-6 py-10 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400">
      {text}
    </div>
  )
}

function HomeDashboard({
  currentUser,
  suggestedFolders,
  suggestedFiles,
  filesView,
  onChangeFilesView,
  onOpenFolder,
  onOpenFile,
  onOpenItemMenu,
}) {
  const fileViewOptions = [
    { id: 'list', label: 'List view', Icon: List },
    { id: 'grid', label: 'Grid view', Icon: LayoutGrid },
  ]

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[12px] border border-slate-200 bg-gradient-to-br from-white via-sky-50/80 to-slate-100 p-6 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 sm:p-8">
        <div className="max-w-3xl">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-sky-700 dark:text-sky-300">
            <Sparkles size={16} />
            Suggested based on your activity
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Welcome to Cloud Drive
          </h1>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 sm:text-base">
            Jump back into the folders and files you are most likely to need next.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Suggested folders</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Recently active folders and the spaces with the most momentum.
            </p>
          </div>
        </div>

        {suggestedFolders.length ? (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {suggestedFolders.map((folder) => (
              <article
                key={folder.id}
                className="min-w-[260px] flex-1 rounded-[12px] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenFolder?.(folder)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-br text-white ${folder.color}`}>
                      <FolderIcon size={20} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {folder.name}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                        {getFolderLocationLabel(folder, currentUser)}
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={(event) => onOpenItemMenu?.(event, folder, 'folder')}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label={`Open actions for ${folder.name}`}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span>{folder.files} {folder.files === 1 ? 'file' : 'files'}</span>
                  <span>{getFolderActivityMeta(folder)}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <HomeEmptyState text="No folders found" />
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Suggested files</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Recently opened, uploaded, or updated files from your drive.
            </p>
          </div>

          <div className="inline-flex items-center rounded-[12px] border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            {fileViewOptions.map(({ id, label, Icon }) => {
              const active = filesView === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChangeFilesView?.(id)}
                  className={`inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm font-medium transition ${
                    active
                      ? 'bg-slate-900 text-white dark:bg-sky-700'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                  aria-pressed={active}
                >
                  <Icon size={16} />
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {!suggestedFiles.length ? <HomeEmptyState text="No files found" /> : null}

        {suggestedFiles.length && filesView === 'list' ? (
          <div className="overflow-hidden rounded-[12px] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50/90 text-xs font-semibold tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-300">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Details</th>
                    <th className="px-5 py-3">Owner</th>
                    <th className="px-5 py-3">Location</th>
                    <th className="px-5 py-3 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {suggestedFiles.map((file) => {
                    const ownerLabel = getItemOwnerLabel(file, currentUser)
                    const { Icon, tone } = getFileVisual(file)

                    return (
                      <tr
                        key={file.id}
                        className="border-t border-slate-100 transition hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-800/60"
                      >
                        <td className="px-5 py-4">
                          <button
                            type="button"
                            onClick={() => onOpenFile?.(file)}
                            className="flex items-center gap-3 text-left"
                          >
                            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${tone}`}>
                              <Icon size={18} />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-slate-900 dark:text-slate-100">
                                {file.name}
                              </span>
                              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400 md:hidden">
                                {getFileActivityMeta(file)}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-5 py-4 text-slate-600 dark:text-slate-300">
                          <p>{getFileActivityMeta(file)}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{file.size}</p>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {getInitials(ownerLabel)}
                            </span>
                            <span>{ownerLabel}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-slate-600 dark:text-slate-300">
                          {getFileLocationLabel(file, currentUser)}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={(event) => onOpenItemMenu?.(event, file, 'file')}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            aria-label={`Open actions for ${file.name}`}
                          >
                            <MoreHorizontal size={18} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {suggestedFiles.length && filesView === 'grid' ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {suggestedFiles.map((file) => {
              const ownerLabel = getItemOwnerLabel(file, currentUser)
              const { Icon, tone } = getFileVisual(file)

              return (
                <article
                  key={file.id}
                  className="rounded-[12px] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => onOpenFile?.(file)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] ${tone}`}>
                        <Icon size={18} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {file.name}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                          {getFileActivityMeta(file)}
                        </span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={(event) => onOpenItemMenu?.(event, file, 'file')}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      aria-label={`Open actions for ${file.name}`}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </div>

                  <div className="mt-4 flex items-center gap-3 rounded-[12px] bg-slate-50 px-3 py-2.5 dark:bg-slate-800/80">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">
                      {getInitials(ownerLabel)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{ownerLabel}</p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{getFileLocationLabel(file, currentUser)}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>{file.size}</span>
                    <span>{getFileExtension(file.name).toUpperCase() || 'FILE'}</span>
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function DashboardContent({
  selectedNav,
  onSelectNav,
  selectedFolderId,
  storage,
  setStorage,
  navigate,
  searchValue,
  searchFilters,
  onSearchStatusChange,
}) {
  const { files: rawFiles, folders: rawFolders, currentFolder, breadcrumbs, refreshFiles, refreshFolders, loading } = useDrive()
  const { user: currentUser } = useProfile()

  const [previewFile, setPreviewFile] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [shareFile, setShareFile] = useState(null)
  const [trashFiles, setTrashFiles] = useState([])
  const [trashFolders, setTrashFolders] = useState([])
  const [trashLoading, setTrashLoading] = useState(false)
  const [trashBusy, setTrashBusy] = useState(false)
  const [trashSelection, setTrashSelection] = useState(new Set())
  const [searchResults, setSearchResults] = useState({ files: [], folders: [] })
  const [searching, setSearching] = useState(false)
  const [selectedFileIds, setSelectedFileIds] = useState(new Set())
  const [zipBusy, setZipBusy] = useState(false)
  const [versionHistoryFile, setVersionHistoryFile] = useState(null)
  const [homeFilesView, setHomeFilesView] = useState('list')
  const [driveViewFilters, setDriveViewFilters] = useState(() => createDriveViewFilters())
  const deferredSearchValue = useDeferredValue(searchValue)
  const searchRequest = useMemo(
    () => buildSearchRequestParams(deferredSearchValue, searchFilters),
    [deferredSearchValue, searchFilters]
  )
  const hasActiveSearch = Object.keys(searchRequest).length > 0
  const showBinSearchResults = hasActiveSearch && searchFilters.inBin

  const handleAsyncError = useCallback((error, fallbackMessage) => {
    console.error(error)
    if (isAuthFailure(error)) {
      clearAuthTokens()
      navigate('/login', { replace: true })
      return
    }
    toast.error(error?.message || fallbackMessage)
  }, [navigate])

  useEffect(() => {
    onSearchStatusChange?.(searching)
  }, [onSearchStatusChange, searching])

  useEffect(() => {
    if (!hasActiveSearch) {
      setSearchResults({ files: [], folders: [] })
      setSearching(false)
      return undefined
    }

    let active = true
    setSearching(true)

    const timer = window.setTimeout(() => {
      api.searchDrive(searchRequest)
        .then((results) => {
          if (!active) return
          setSearchResults({
            files: Array.isArray(results?.files) ? results.files : [],
            folders: Array.isArray(results?.folders) ? results.folders : [],
          })
        })
        .catch((error) => {
          if (!active) return
          handleAsyncError(error, 'Search failed')
        })
        .finally(() => {
          if (active) setSearching(false)
        })
    }, 250)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [handleAsyncError, hasActiveSearch, searchRequest])

  const folderReference = useMemo(() => {
    const byId = new Map()
    ;[...rawFolders, ...searchResults.folders].forEach((folder) => {
      if (folder?.id) {
        byId.set(String(folder.id), folder)
      }
    })
    return [...byId.values()]
  }, [rawFolders, searchResults.folders])

  const sourceFiles = hasActiveSearch ? searchResults.files : rawFiles
  const sourceFolders = hasActiveSearch ? searchResults.folders : rawFolders

  const files = useMemo(() => normalizeFiles(sourceFiles, folderReference), [folderReference, sourceFiles])
  const folderTree = useMemo(() => buildFolderTree(rawFolders), [rawFolders])
  const folders = useMemo(() => {
    if (showBinSearchResults) {
      return []
    }
    if (hasActiveSearch) {
      return normalizeFolders(sourceFolders, sourceFiles)
    }
    const scopedFolders = filterFoldersByParent(rawFolders, selectedFolderId)
    return normalizeFolders(scopedFolders, rawFiles)
  }, [hasActiveSearch, rawFiles, rawFolders, selectedFolderId, showBinSearchResults, sourceFiles, sourceFolders])
  const allFolders = useMemo(() => normalizeFolders(rawFolders, rawFiles), [rawFiles, rawFolders])

  const sidebarFolders = useMemo(() => {
    if (selectedNav === 'bin' || selectedNav === 'media') return []
    return folderTree
  }, [folderTree, selectedNav])

  const viewMeta = useMemo(() => {
    if (hasActiveSearch) {
      return {
        title: showBinSearchResults ? 'Search Results in Bin' : 'Search Results',
        subtitle: searching
          ? 'Searching your drive...'
          : showBinSearchResults
            ? 'Matching deleted files and folders from your bin.'
            : 'Matches across files and folders in your drive.',
      }
    }
    return getViewMeta(selectedNav, currentFolder)
  }, [currentFolder, hasActiveSearch, searching, selectedNav, showBinSearchResults])

  const showHomeView = !hasActiveSearch && !selectedFolderId && selectedNav === 'home'
  const showTrashView = (selectedNav === 'bin' && !hasActiveSearch) || showBinSearchResults
  const showMediaView = selectedNav === 'media' && !hasActiveSearch
  const showStorageOnlyView = selectedNav === 'storage' && !hasActiveSearch
  const showDriveFilterBar = selectedNav === 'my-drive' && !selectedFolderId && !hasActiveSearch
  const showFolderGrid = hasActiveSearch
    ? folders.length > 0
    : selectedNav === 'my-drive' || Boolean(selectedFolderId)
  const showFilesTable = !showHomeView && !showTrashView && !showMediaView && !showStorageOnlyView

  const refreshStorage = useCallback(async () => {
    const storageRes = await api.getStorageUsage()
    setStorage(normalizeStoragePayload(storageRes))
  }, [setStorage])

  const refreshTrash = useCallback(async () => {
    setTrashLoading(true)
    try {
      const data = await api.getTrash()
      setTrashFiles(Array.isArray(data?.files) ? data.files : [])
      setTrashFolders(Array.isArray(data?.folders) ? data.folders : [])
      setTrashSelection(new Set())
      return data
    } finally {
      setTrashLoading(false)
    }
  }, [])

  const refreshDashboard = useCallback(async () => {
    if (selectedNav === 'bin') {
      await Promise.all([refreshTrash(), refreshStorage()])
      return
    }

    await Promise.all([
      refreshFolders(),
      refreshFiles({ selectedNav, folderId: selectedFolderId }),
      refreshStorage(),
    ])
  }, [refreshFiles, refreshFolders, refreshStorage, refreshTrash, selectedFolderId, selectedNav])

  useEffect(() => {
    refreshStorage().catch((error) => {
      handleAsyncError(error, 'Failed to load storage information')
    })
  }, [handleAsyncError, refreshStorage])

  useEffect(() => {
    if (selectedNav !== 'bin') return undefined

    refreshTrash().catch((error) => {
      handleAsyncError(error, 'Failed to load trash')
    })

    return undefined
  }, [handleAsyncError, refreshTrash, selectedNav])

  useEffect(() => {
    const onClick = () => setContextMenu(null)
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [])

  const onOpenFolder = (folder) => {
    navigate(`/folder/${folder.id}`)
  }

  const openUploadPicker = useCallback(() => {
    window.dispatchEvent(new CustomEvent('drive:open-upload-picker', {
      detail: { folderId: selectedFolderId || null },
    }))
  }, [selectedFolderId])

  const createFolderFromSidebar = useCallback(async () => {
    const name = await promptAction({
      title: 'Create folder',
      message: 'Enter a name for the new folder.',
      confirmLabel: 'Create',
      placeholder: 'Folder name',
    })
    const trimmedName = name?.trim()
    if (!trimmedName) return

    try {
      await api.createFolder({
        name: trimmedName,
        parent_folder_id: selectedFolderId || null,
      })
      await refreshDashboard()
      toast.success(`Folder "${trimmedName}" created`)
    } catch (error) {
      handleAsyncError(error, 'Failed to create folder')
    }
  }, [handleAsyncError, refreshDashboard, selectedFolderId])

  const onDeleteFolder = async (folderId) => {
    const folder = rawFolders.find((item) => String(item.id) === String(folderId))
    const confirmed = await confirmAction({
      title: 'Delete folder?',
      message: `Are you sure you want to delete "${folder?.name || 'this folder'}"?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    if (!confirmed) return

    try {
      await api.deleteFolder(folderId)
      if (String(selectedFolderId || '') === String(folderId)) {
        navigate('/drive')
      }
      await refreshDashboard()
      toast.success(folder?.name ? `Deleted "${folder.name}"` : 'Folder deleted')
    } catch (error) {
      handleAsyncError(error, 'Failed to delete folder')
    }
  }

  const onOpenFile = (file) => {
    setPreviewFile(file)
  }

  const onDeleteFile = async (fileId) => {
    const file = files.find((item) => String(item.id) === String(fileId))
    const confirmed = await confirmAction({
      title: 'Delete file?',
      message: `Are you sure you want to delete "${file?.name || 'this file'}"?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    if (!confirmed) return

    try {
      await api.deleteFile(fileId)
      await refreshDashboard()
      toast.success(file?.name ? `Deleted "${file.name}"` : 'File deleted')
    } catch (error) {
      handleAsyncError(error, 'Failed to delete file')
    }
  }

  const onToggleStar = async (file) => {
    try {
      await api.toggleStar(file.id, !file.starred)
      await refreshDashboard()
    } catch (error) {
      handleAsyncError(error, 'Failed to update star')
    }
  }

  const onRenameItem = async (item, name, type) => {
    try {
      if (type === 'folder') {
        await api.renameFolder(item.id, name)
      } else {
        await api.renameFile(item.id, name)
      }
      await refreshDashboard()
      toast.success(type === 'folder' ? 'Folder renamed' : 'File renamed')
    } catch (error) {
      handleAsyncError(error, 'Rename failed')
    }
  }

  const moveFileToFolder = useCallback(async (file, folder) => {
    if (!file?.id || !folder?.id || String(file.folderId || '') === String(folder.id)) return
    try {
      await api.moveStorageItem(file.id, folder.id)
    } catch {
      await api.moveFileToFolder(file.id, folder.id)
    }
    await refreshDashboard()
    toast.success(`Moved "${file.name}" to "${folder.name}"`)
  }, [refreshDashboard])

  const onDeleteItem = async (item, type) => {
    if (!item?.id) return
    if (type === 'folder') {
      await onDeleteFolder(item.id)
      return
    }
    await onDeleteFile(item.id)
  }

  const onStarItem = async (item, type) => {
    if (type !== 'file') return
    await onToggleStar(item)
  }

  const onDownloadItem = async (item, type) => {
    if (type !== 'file') return
    if (item.fileUrl || item.storagePath) {
      window.open(item.fileUrl || item.storagePath, '_blank', 'noopener,noreferrer')
      return
    }
    toast.warning('Download link not available for this item')
  }

  const toggleFileSelection = useCallback((fileId) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev)
      const normalizedId = String(fileId)
      if (next.has(normalizedId)) {
        next.delete(normalizedId)
      } else {
        next.add(normalizedId)
      }
      return next
    })
  }, [])

  const onOpenVersionHistory = useCallback((file) => {
    setVersionHistoryFile(file)
  }, [])

  const onMoveItem = async (item, type) => {
    if (type !== 'file') {
      toast.warning('Folder move is not available yet')
      return
    }

    const targetFolderId = await promptAction({
      title: 'Move file',
      message: 'Enter the target folder ID.',
      confirmLabel: 'Move',
      placeholder: 'Folder ID',
    })
    if (!targetFolderId) return

    const targetFolder = rawFolders.find((folder) => String(folder.id) === String(targetFolderId))
    if (!targetFolder) {
      toast.warning('Target folder not found')
      return
    }

    try {
      await moveFileToFolder(item, targetFolder)
    } catch (error) {
      handleAsyncError(error, 'Move failed')
    }
  }

  const onShareItem = async (item, type) => {
    setShareFile({ ...item, itemType: type })
  }

  const onVersionRestored = useCallback(async (restoredFile) => {
    await refreshDashboard()

    if (!restoredFile?.id) return

    setVersionHistoryFile((current) => (
      current && String(current.id) === String(restoredFile.id)
        ? {
            ...current,
            name: restoredFile.file_name || current.name,
            mimeType: restoredFile.mime_type || current.mimeType,
            tags: restoredFile.tags || current.tags,
            versionCount: restoredFile.version_count ?? current.versionCount,
          }
        : current
    ))

    setPreviewFile((current) => (
      current && String(current.id) === String(restoredFile.id)
        ? {
            ...current,
            name: restoredFile.file_name || current.name,
            mimeType: restoredFile.mime_type || current.mimeType,
            tags: restoredFile.tags || current.tags,
            versionCount: restoredFile.version_count ?? current.versionCount,
            kind: detectFileKind(restoredFile.mime_type || current.mimeType || '', restoredFile.file_name || current.name || ''),
          }
        : current
    ))
  }, [refreshDashboard])

  const activeFiles = useMemo(() => files.filter((file) => !file.deleted), [files])
  const mediaFiles = useMemo(() => activeFiles.filter((file) => isMediaFile(file.kind)), [activeFiles])
  const suggestedFolders = useMemo(() => {
    return [...allFolders]
      .sort(compareSuggestedFolders)
      .slice(0, 5)
  }, [allFolders])
  const suggestedFiles = useMemo(() => {
    return [...activeFiles]
      .sort(compareSuggestedFiles)
      .slice(0, 8)
  }, [activeFiles])
  const activeDriveViewFilterCount = useMemo(
    () => countDriveViewFilters(driveViewFilters),
    [driveViewFilters]
  )

  const visibleFiles = useMemo(() => {
    const source = selectedNav === 'media' ? mediaFiles : activeFiles
    if (hasActiveSearch || !selectedFolderId || selectedNav === 'media') {
      return source
    }
    return source.filter((file) => String(file.folderId) === String(selectedFolderId))
  }, [activeFiles, hasActiveSearch, mediaFiles, selectedFolderId, selectedNav])

  const renderedFolders = useMemo(() => {
    if (!showDriveFilterBar) return folders
    return folders.filter((folder) => (
      matchesTypeFilter(folder, driveViewFilters.type, 'folder')
      && matchesPeopleFilter(folder, driveViewFilters.people, currentUser?.id)
      && matchesModifiedFilter(folder, driveViewFilters.modified)
      && matchesSourceFilter(folder, driveViewFilters.source, currentUser?.id, 'folder')
    ))
  }, [currentUser?.id, driveViewFilters, folders, showDriveFilterBar])

  const renderedFiles = useMemo(() => {
    if (!showDriveFilterBar) return visibleFiles
    return visibleFiles.filter((file) => (
      matchesTypeFilter(file, driveViewFilters.type, 'file')
      && matchesPeopleFilter(file, driveViewFilters.people, currentUser?.id)
      && matchesModifiedFilter(file, driveViewFilters.modified)
      && matchesSourceFilter(file, driveViewFilters.source, currentUser?.id, 'file')
    ))
  }, [currentUser?.id, driveViewFilters, showDriveFilterBar, visibleFiles])

  useEffect(() => {
    const visibleIds = new Set(renderedFiles.map((file) => String(file.id)))
    setSelectedFileIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(String(id))))
      const unchanged = next.size === prev.size && [...next].every((id) => prev.has(id))
      return unchanged ? prev : next
    })
  }, [renderedFiles])

  const selectedVisibleFiles = useMemo(() => {
    return renderedFiles.filter((file) => selectedFileIds.has(String(file.id)))
  }, [renderedFiles, selectedFileIds])

  const allVisibleFilesSelected = useMemo(() => {
    return renderedFiles.length > 0 && renderedFiles.every((file) => selectedFileIds.has(String(file.id)))
  }, [renderedFiles, selectedFileIds])

  const toggleSelectAllVisibleFiles = useCallback(() => {
    const visibleIds = renderedFiles.map((file) => String(file.id))
    setSelectedFileIds((prev) => {
      const next = new Set(prev)
      const shouldClear = visibleIds.length > 0 && visibleIds.every((id) => next.has(id))

      visibleIds.forEach((id) => {
        if (shouldClear) {
          next.delete(id)
        } else {
          next.add(id)
        }
      })

      return next
    })
  }, [renderedFiles])

  const clearSelectedFiles = useCallback(() => {
    setSelectedFileIds(new Set())
  }, [])

  const downloadSelectedAsZip = useCallback(async () => {
    if (!selectedVisibleFiles.length) return

    try {
      setZipBusy(true)
      const { blob, filename } = await api.downloadFilesZip(selectedVisibleFiles.map((file) => file.id))
      const objectUrl = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = filename || 'drive-files.zip'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(objectUrl)
      toast.success(
        selectedVisibleFiles.length === 1
          ? 'ZIP download is ready'
          : `${selectedVisibleFiles.length} files downloaded as ZIP`
      )
    } catch (error) {
      handleAsyncError(error, 'Failed to download ZIP')
    } finally {
      setZipBusy(false)
    }
  }, [handleAsyncError, selectedVisibleFiles])

  const largestFiles = useMemo(() => {
    return [...activeFiles]
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
      .slice(0, 5)
  }, [activeFiles])

  const trashFileCards = useMemo(() => {
    return normalizeTrashFileItems(trashFiles, trashFolders)
  }, [trashFiles, trashFolders])

  const trashFolderCards = useMemo(() => {
    return normalizeTrashFolderItems(trashFolders)
  }, [trashFolders])

  const trashItems = useMemo(() => {
    return sortTrashItems([...trashFolderCards, ...trashFileCards])
  }, [trashFileCards, trashFolderCards])

  const searchTrashItems = useMemo(() => {
    return sortTrashItems([
      ...normalizeTrashFolderItems(searchResults.folders),
      ...normalizeTrashFileItems(searchResults.files, searchResults.folders),
    ])
  }, [searchResults.files, searchResults.folders])

  const visibleTrashItems = useMemo(() => {
    return showBinSearchResults ? searchTrashItems : trashItems
  }, [searchTrashItems, showBinSearchResults, trashItems])

  const selectedTrashItems = useMemo(() => {
    return visibleTrashItems.filter((item) => trashSelection.has(`${item.type}:${item.id}`))
  }, [trashSelection, visibleTrashItems])

  const toggleTrashSelection = useCallback((item) => {
    const key = `${item.type}:${item.id}`
    setTrashSelection((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const toggleTrashSelectionAll = useCallback(() => {
    setTrashSelection((prev) => {
      if (prev.size === visibleTrashItems.length) {
        return new Set()
      }
      return new Set(visibleTrashItems.map((item) => `${item.type}:${item.id}`))
    })
  }, [visibleTrashItems])

  useEffect(() => {
    const visibleKeys = new Set(visibleTrashItems.map((item) => `${item.type}:${item.id}`))
    setTrashSelection((prev) => {
      const next = new Set([...prev].filter((key) => visibleKeys.has(key)))
      const unchanged = next.size === prev.size && [...next].every((key) => prev.has(key))
      return unchanged ? prev : next
    })
  }, [visibleTrashItems])

  const restoreTrashItem = useCallback(async (item) => {
    try {
      setTrashBusy(true)
      await api.restoreTrashItem(item.id)
      await refreshDashboard()
      toast.success(item?.name ? `Restored "${item.name}"` : 'Item restored')
    } catch (error) {
      handleAsyncError(error, 'Failed to restore item')
    } finally {
      setTrashBusy(false)
    }
  }, [handleAsyncError, refreshDashboard])

  const permanentlyDeleteTrashItem = useCallback(async (item) => {
    const confirmed = await confirmAction({
      title: 'Delete forever?',
      message: `Are you sure you want to permanently delete "${item.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    if (!confirmed) return

    try {
      setTrashBusy(true)
      await api.permanentlyDeleteTrashItem(item.id)
      await refreshDashboard()
      toast.success(item?.name ? `Deleted "${item.name}" forever` : 'Item permanently deleted')
    } catch (error) {
      handleAsyncError(error, 'Failed to permanently delete item')
    } finally {
      setTrashBusy(false)
    }
  }, [handleAsyncError, refreshDashboard])

  const restoreSelectedTrash = useCallback(async () => {
    if (!selectedTrashItems.length) return

    try {
      setTrashBusy(true)
      await Promise.all(selectedTrashItems.map((item) => api.restoreTrashItem(item.id)))
      await refreshDashboard()
      toast.success(
        selectedTrashItems.length === 1
          ? '1 item restored'
          : `${selectedTrashItems.length} items restored`
      )
    } catch (error) {
      handleAsyncError(error, 'Failed to restore selected items')
    } finally {
      setTrashBusy(false)
    }
  }, [handleAsyncError, refreshDashboard, selectedTrashItems])

  const deleteSelectedTrash = useCallback(async () => {
    if (!selectedTrashItems.length) return

    const confirmed = await confirmAction({
      title: 'Delete selected items?',
      message: `Are you sure you want to permanently delete ${selectedTrashItems.length} selected item(s)? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    if (!confirmed) return

    try {
      setTrashBusy(true)
      await Promise.all(selectedTrashItems.map((item) => api.permanentlyDeleteTrashItem(item.id)))
      await refreshDashboard()
      toast.success(
        selectedTrashItems.length === 1
          ? '1 item permanently deleted'
          : `${selectedTrashItems.length} items permanently deleted`
      )
    } catch (error) {
      handleAsyncError(error, 'Failed to permanently delete selected items')
    } finally {
      setTrashBusy(false)
    }
  }, [handleAsyncError, refreshDashboard, selectedTrashItems])

  const emptyTrash = useCallback(async () => {
    if (!trashItems.length) return

    const confirmed = await confirmAction({
      title: 'Empty trash?',
      message: 'Are you sure you want to permanently delete everything in the trash? This cannot be undone.',
      confirmLabel: 'Empty trash',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    if (!confirmed) return

    try {
      setTrashBusy(true)
      await api.emptyTrash()
      await refreshDashboard()
      toast.success('Trash emptied successfully')
    } catch (error) {
      handleAsyncError(error, 'Failed to empty trash')
    } finally {
      setTrashBusy(false)
    }
  }, [handleAsyncError, refreshDashboard, trashItems.length])

  const onTableContextMenu = (event, directFile = null) => {
    event.preventDefault()
    const file = directFile || (() => {
      const row = event.target.closest('tbody tr')
      if (!row) return null
      const bodyRows = Array.from(row.parentElement.children)
      const index = bodyRows.indexOf(row)
      return renderedFiles[index]
    })()
    if (!file) return
    setContextMenu({ x: event.clientX, y: event.clientY, item: file, type: 'file' })
  }

  const onFolderContextMenu = (event, folder) => {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, item: folder, type: 'folder' })
  }

  const openContextMenuFromButton = useCallback((event, item, type) => {
    event.preventDefault()
    event.stopPropagation()

    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = 180
    const estimatedHeight = type === 'folder' ? 260 : 320
    const left = Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12))
    const shouldOpenAbove = window.innerHeight - rect.bottom < estimatedHeight
    const top = shouldOpenAbove
      ? Math.max(12, rect.top - estimatedHeight - 8)
      : Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - estimatedHeight - 12))

    setContextMenu({ x: left, y: top, item, type })
  }, [])

  const onDragFileStart = (event, file) => {
    event.dataTransfer.setData('application/json', JSON.stringify(file))
    event.dataTransfer.effectAllowed = 'move'
  }

  const onFileDropToFolder = async (event, folder) => {
    try {
      const payload = event.dataTransfer.getData('application/json')
      if (!payload) return
      const draggedFile = JSON.parse(payload)
      await moveFileToFolder(draggedFile, folder)
    } catch (error) {
      handleAsyncError(error, 'Move failed')
    }
  }

  if ((selectedNav !== 'bin' && loading) || (selectedNav === 'bin' && trashLoading && !trashItems.length)) {
    return <div className="p-6 text-lg">Loading Dashboard...</div>
  }

  return (
    <>
      <div className="flex flex-1">
        <SidebarNav
          collapsed={false}
          selected={selectedNav}
          onSelect={onSelectNav}
          storage={storage}
          showNewButton={selectedNav !== 'home'}
          folders={sidebarFolders}
          currentFolderId={selectedNav === 'bin' || selectedNav === 'media' ? null : selectedFolderId}
          onOpenFolder={onOpenFolder}
          onOpenUpload={openUploadPicker}
          onCreateFolder={createFolderFromSidebar}
        />

        <main className="flex-1">
          <section className="px-6 pb-6 pt-7 lg:px-8">
            {selectedFolderId && !hasActiveSearch ? (
              <Breadcrumbs
                items={breadcrumbs}
                onNavigate={(item, index) => {
                  if (index === 0 || !item.id) {
                    navigate('/drive')
                    return
                  }
                  navigate(`/folder/${item.id}`)
                }}
              />
            ) : null}

            {showHomeView ? (
              <HomeDashboard
                currentUser={currentUser}
                suggestedFolders={suggestedFolders}
                suggestedFiles={suggestedFiles}
                filesView={homeFilesView}
                onChangeFilesView={setHomeFilesView}
                onOpenFolder={onOpenFolder}
                onOpenFile={onOpenFile}
                onOpenItemMenu={openContextMenuFromButton}
              />
            ) : (
              <ViewHeader title={viewMeta.title} subtitle={viewMeta.subtitle} />
            )}

            {showDriveFilterBar ? (
              <DriveFilterBar
                filters={driveViewFilters}
                activeCount={activeDriveViewFilterCount}
                onChange={(key, value) => {
                  setDriveViewFilters((current) => createDriveViewFilters({
                    ...current,
                    [key]: value,
                  }))
                }}
                onReset={() => setDriveViewFilters(createDriveViewFilters())}
              />
            ) : null}

            {showTrashView ? (
              <TrashView
                items={showBinSearchResults ? visibleTrashItems : trashItems}
                selectedIds={trashSelection}
                onToggleSelect={toggleTrashSelection}
                onToggleSelectAll={toggleTrashSelectionAll}
                onRestoreItem={restoreTrashItem}
                onDeleteItem={permanentlyDeleteTrashItem}
                onRestoreSelected={restoreSelectedTrash}
                onDeleteSelected={deleteSelectedTrash}
                onEmptyTrash={emptyTrash}
                busy={trashBusy}
                title={null}
                subtitle={null}
                emptyText={showBinSearchResults ? 'No items in the bin match your search.' : 'Trash is empty.'}
                showEmptyTrashAction={selectedNav === 'bin' && !hasActiveSearch}
              />
            ) : null}

            {showMediaView ? (
              <MediaGallery files={mediaFiles} onOpenFile={onOpenFile} />
            ) : null}

            {showFolderGrid || showFilesTable || showStorageOnlyView ? (
              <>
                {showFolderGrid ? (
                  <FolderGrid
                    title="Folders"
                    folders={renderedFolders}
                    onOpenFolder={onOpenFolder}
                    onDeleteFolder={onDeleteFolder}
                    onFolderContextMenu={onFolderContextMenu}
                    onFileDropToFolder={onFileDropToFolder}
                  />
                ) : null}

                {showFilesTable ? (
                  <>
                    <BulkFileActionsBar
                      selectedCount={selectedVisibleFiles.length}
                      busy={zipBusy}
                      onDownloadZip={downloadSelectedAsZip}
                      onClearSelection={clearSelectedFiles}
                    />
                    <div onContextMenu={onTableContextMenu}>
                      <FilesTable
                        title={selectedNav === 'my-drive' && !selectedFolderId && !hasActiveSearch ? 'Files' : null}
                        files={renderedFiles}
                        selectedFileIds={selectedFileIds}
                        allVisibleSelected={allVisibleFilesSelected}
                        onToggleFileSelection={toggleFileSelection}
                        onToggleSelectAll={toggleSelectAllVisibleFiles}
                        onOpenFile={onOpenFile}
                        onDeleteFile={onDeleteFile}
                        onToggleStar={onToggleStar}
                        onVersionHistory={onOpenVersionHistory}
                        onFileContextMenu={onTableContextMenu}
                        onDragFileStart={onDragFileStart}
                      />
                    </div>
                  </>
                ) : null}

                {showStorageOnlyView ? (
                  <StoragePanel
                    storage={storage}
                    largestFiles={largestFiles}
                    heading={null}
                  />
                ) : null}
              </>
            ) : null}
          </section>
        </main>
      </div>

      <UploadManager
        currentFolderId={selectedFolderId}
        onUploaded={refreshDashboard}
      />

      <FilePreviewModal
        open={Boolean(previewFile)}
        file={previewFile}
        onClose={() => setPreviewFile(null)}
      />

      <ShareDialog
        open={Boolean(shareFile)}
        file={shareFile}
        onClose={() => setShareFile(null)}
      />

      <VersionHistoryDialog
        open={Boolean(versionHistoryFile)}
        file={versionHistoryFile}
        onClose={() => setVersionHistoryFile(null)}
        onRestored={onVersionRestored}
      />

      {selectedNav !== 'bin' || (hasActiveSearch && !showBinSearchResults) ? (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpen={(item, type) => {
            if (type === 'folder') {
              onOpenFolder(item)
              return
            }
            setPreviewFile(item)
          }}
          onDelete={onDeleteItem}
          onRename={onRenameItem}
          onMove={onMoveItem}
          onStar={onStarItem}
          onDownload={onDownloadItem}
          onVersionHistory={onOpenVersionHistory}
          onShare={onShareItem}
        />
      ) : null}
    </>
  )
}

function DashboardPage({ forcedFolderId = null, forcedNav = null }) {
  const navigate = useNavigate()
  const location = useLocation()

  const [storage, setStorage] = useState(EMPTY_STORAGE)
  const [selectedNav, setSelectedNav] = useState(forcedNav || (forcedFolderId ? 'my-drive' : 'home'))
  const [searchValue, setSearchValue] = useState('')
  const [searchFilters, setSearchFilters] = useState(() => createAdvancedSearchFilters())
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false)
  const [searching, setSearching] = useState(false)

  const pathFolderId = useMemo(() => getFolderIdFromPath(location.pathname), [location.pathname])
  const searchFolderId = useMemo(() => getFolderIdFromSearch(location.search), [location.search])
  const selectedFolderId = forcedFolderId || pathFolderId || searchFolderId
  const activeNav = forcedNav || selectedNav
  const hasAdvancedFilters = useMemo(() => hasAdvancedSearchFilters(searchFilters), [searchFilters])
  const advancedSearchInitialValues = useMemo(
    () => createAdvancedSearchFormValues({ name: searchValue, ...searchFilters }),
    [searchFilters, searchValue]
  )

  const onSelectNav = async (navId) => {
    setSelectedNav(navId)

    if (navId === 'home') {
      navigate('/')
      return
    }

    if (navId === 'my-drive') {
      navigate('/drive')
      return
    }

    if (navId === 'bin') {
      navigate('/trash')
      return
    }

    if (navId === 'media') {
      navigate('/media')
      return
    }

    if (navId === 'recent') {
      navigate('/recent')
      return
    }

    if (navId === 'starred') {
      navigate('/starred')
      return
    }

    if (navId === 'storage') {
      navigate('/storage')
      return
    }

    navigate('/')
  }

  const applyAdvancedSearch = useCallback((values) => {
    const { name, ...nextFilters } = values
    setSearchValue(name || '')
    setSearchFilters(createAdvancedSearchFilters(nextFilters))
    setAdvancedSearchOpen(false)
  }, [])

  const onAuthError = (error) => {
    console.error('Dashboard error:', error)
    if (isAuthFailure(error)) {
      clearAuthTokens()
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-slate-900">
      <Header
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder="Search files..."
        onOpenAdvancedSearch={() => setAdvancedSearchOpen(true)}
        searchHasFilters={hasAdvancedFilters}
        searching={searching}
      />

      <DriveProvider
        selectedNav={activeNav}
        folderId={selectedFolderId}
        onAuthError={onAuthError}
      >
        <DashboardContent
          selectedNav={activeNav}
          onSelectNav={onSelectNav}
          selectedFolderId={selectedFolderId}
          storage={storage}
          setStorage={setStorage}
          navigate={navigate}
          searchValue={searchValue}
          searchFilters={searchFilters}
          onSearchStatusChange={setSearching}
        />
      </DriveProvider>

      {advancedSearchOpen ? (
        <AdvancedSearchModal
          initialValues={advancedSearchInitialValues}
          onClose={() => setAdvancedSearchOpen(false)}
          onSearch={applyAdvancedSearch}
        />
      ) : null}

      <Footer />
    </div>
  )
}

export default DashboardPage

import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  ChevronRight,
  ChevronDown,
  Database,
  Download,
  FileText,
  Folder,
  FolderPlus,
  History,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings,
  Shield,
  Star,
  Sun,
  Upload,
  UserRound,
} from 'lucide-react'
import * as Icons from 'lucide-react'
import { api } from '../../lib/api'
import { promptAction, toast } from '../../lib/popup'
import { formatBytes, normalizeStoragePayload } from '../../lib/storage'

function FolderTree({ items, currentFolderId, onOpenFolder, level = 0 }) {
  const [expandedIds, setExpandedIds] = useState({})

  if (!items.length) return null

  const toggle = (id) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="space-y-0.5">
      {items.map((node) => {
        const isExpanded = expandedIds[node.id] ?? true
        const isActive = String(currentFolderId || '') === String(node.id)
        const hasChildren = node.children.length > 0
        return (
          <div key={node.id}>
            <div className={`flex items-center rounded-lg text-sm ${isActive ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' : 'text-slate-600 dark:text-slate-300'}`}>
              <button
                type="button"
                onClick={() => hasChildren && toggle(node.id)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                {hasChildren ? (
                  <ChevronRight size={14} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                ) : (
                  <span className="inline-block w-[14px]" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onOpenFolder?.(node)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-r-lg py-1.5 pr-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                style={{ paddingLeft: `${Math.max(level * 12, 0)}px` }}
              >
                <Folder size={14} />
                <span className="truncate">{node.name}</span>
              </button>
            </div>
            {hasChildren && isExpanded ? (
              <FolderTree
                items={node.children}
                currentFolderId={currentFolderId}
                onOpenFolder={onOpenFolder}
                level={level + 1}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function SidebarNav({
  collapsed,
  selected,
  onSelect,
  storage,
  showNewButton = true,
  folders = [],
  currentFolderId = null,
  onOpenFolder,
  onOpenUpload,
  onCreateFolder,
}) {
  const storageMetrics = normalizeStoragePayload(storage)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const newMenuRef = useRef(null)

  const items = [
    { id: 'home', label: 'Home', icon: Icons.House },
    { id: 'my-drive', label: 'My Drive', icon: Icons.HardDrive },
    { id: 'media', label: 'Media', icon: Icons.Images },
    { id: 'recent', label: 'Recent', icon: Icons.Clock3 },
    { id: 'starred', label: 'Starred', icon: Icons.Star },
    { id: 'bin', label: 'Bin', icon: Icons.Trash2 },
    { id: 'storage', label: 'Storage', icon: Icons.Database },
  ]

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (newMenuRef.current && !newMenuRef.current.contains(event.target)) {
        setNewMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <aside className={`flex h-full flex-col border-r border-slate-200 bg-white/85 backdrop-blur transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/90 ${collapsed ? 'w-[86px]' : 'w-[280px]'}`}>
      {showNewButton ? (
        <div className="px-3 pt-4" ref={newMenuRef}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setNewMenuOpen((prev) => !prev)}
              className={`flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900 ${collapsed ? 'px-0' : ''}`}
            >
              <Plus size={18} />
              {collapsed ? null : 'New'}
            </button>

            {newMenuOpen && !collapsed ? (
              <div className="absolute top-full left-0 z-30 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => {
                    setNewMenuOpen(false)
                    onOpenUpload?.()
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Upload size={16} />
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewMenuOpen(false)
                    onCreateFolder?.()
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <FolderPlus size={16} />
                  New folder
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <nav className={`space-y-1 px-3 ${showNewButton ? '' : 'pt-4'}`}>
        {items.map((item) => {
          const Icon = item.icon
          const active = selected === item.id
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active ? 'bg-slate-900 text-white dark:bg-sky-700' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'} ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <Icon size={16} />
              {collapsed ? null : item.label}
            </button>
          )
        })}
      </nav>

      {!collapsed && folders.length ? (
        <div className="mt-3 px-3">
          <p className="mb-2 px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">Folders</p>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
            <FolderTree
              items={folders}
              currentFolderId={currentFolderId}
              onOpenFolder={onOpenFolder}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-auto p-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80">
          <p className={`text-xs text-slate-600 dark:text-slate-300 ${collapsed ? 'text-center' : ''}`}>{collapsed ? 'Storage' : 'Storage usage'}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-600" style={{ width: `${storageMetrics.usedPercent}%` }} />
          </div>
          {!collapsed ? (
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              <p>{formatBytes(storageMetrics.used)} used</p>
              <p>{formatBytes(storageMetrics.remaining)} available of {formatBytes(storageMetrics.total)}</p>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}

function TopBar({ username, email, authEnabled, setAuthEnabled, onLogout, isDark, toggleTheme }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur sm:px-6 dark:border-slate-800 dark:bg-slate-900/90">
      <div className="relative min-w-[220px] max-w-xl flex-1">
        <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input
          placeholder="Search in Drive"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-3 pl-10 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
        />
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <button className="rounded-xl p-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" title="Settings">
          <Settings size={18} />
        </button>
        <button className="rounded-xl p-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" title="Toggle theme" onClick={toggleTheme}>
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="rounded-xl p-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" title="Notifications">
          <Bell size={18} />
        </button>

        <div className="group relative">
          <button className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white dark:bg-sky-700">
              {username?.slice(0, 2).toUpperCase() || 'US'}
            </span>
            <ChevronDown size={16} />
          </button>

          <div className="invisible absolute top-12 right-0 z-20 w-72 rounded-2xl border border-slate-200 bg-white p-4 opacity-0 shadow-xl transition-all group-hover:visible group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 border-b border-slate-100 pb-3 dark:border-slate-700">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{username}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{email}</p>
            </div>
            <button className="mb-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
              <UserRound size={16} />
              Forgot Password
            </button>
            <button
              className="mb-2 flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={() => setAuthEnabled((prev) => !prev)}
            >
              <span className="flex items-center gap-2">
                <Shield size={16} />
                Authentication
              </span>
              <span className={`rounded-full px-2 py-1 text-xs ${authEnabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                {authEnabled ? 'On' : 'Off'}
              </span>
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose-600 transition hover:bg-rose-50 dark:hover:bg-rose-900/20"
              onClick={onLogout}
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}

function ViewHeader({ title, subtitle }) {
  return (
    <div className="mb-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        ) : null}
      </div>
    </div>
  )
}

function BulkFileActionsBar({ selectedCount, busy, onDownloadZip, onClearSelection }) {
  if (!selectedCount) return null

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm shadow-sm dark:border-sky-900/40 dark:bg-sky-950/30">
      <div>
        <p className="font-semibold text-sky-900 dark:text-sky-100">
          {selectedCount} {selectedCount === 1 ? 'file selected' : 'files selected'}
        </p>
        <p className="text-xs text-sky-700 dark:text-sky-300">
          Download the current selection as a ZIP archive.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onDownloadZip}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download size={16} />
          {busy ? 'Preparing ZIP...' : 'Download as ZIP'}
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-medium text-sky-800 transition hover:bg-sky-100 dark:border-sky-900/40 dark:bg-slate-900 dark:text-sky-200 dark:hover:bg-slate-800"
        >
          Clear selection
        </button>
      </div>
    </div>
  )
}

function FolderGrid({ title = 'Folders', folders, onOpenFolder, onDeleteFolder, onFolderContextMenu, onFileDropToFolder }) {
  if (!folders.length) return null

  return (
    <section>
      {title ? (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {folders.map((folder) => (
          <article
            key={folder.id}
            className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
            onContextMenu={(event) => onFolderContextMenu?.(event, folder)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              onFileDropToFolder?.(event, folder)
            }}
          >
            <button
              type="button"
              onClick={() => onOpenFolder?.(folder)}
              className="w-full text-left"
            >
              <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white ${folder.color}`}>
                <Folder size={18} />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{folder.name}</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{folder.files} files</p>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{folder.updated}</p>
            </button>
            <button
              type="button"
              onClick={() => onDeleteFolder?.(folder.id)}
              className="mt-3 rounded-lg bg-rose-100 px-2 py-1 text-xs text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
            >
              Delete
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

function FilesTable({
  title = 'Files',
  files,
  selectedFileIds = new Set(),
  onToggleFileSelection,
  onToggleSelectAll,
  onOpenFile,
  onDeleteFile,
  onToggleStar,
  onVersionHistory,
  onFileContextMenu,
  onDragFileStart,
}) {
  const allSelected = files.length > 0 && files.every((file) => selectedFileIds.has(String(file.id)))
  const showHeading = Boolean(title)

  return (
    <section className={showHeading ? 'mt-8' : ''}>
      {showHeading ? (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => onToggleSelectAll?.()}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    aria-label="Select all files"
                  />
                </th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Details</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.length ? (
                files.map((file) => (
                  <tr
                    key={file.id}
                    draggable
                    onDragStart={(event) => onDragFileStart?.(event, file)}
                    onContextMenu={(event) => onFileContextMenu?.(event, file)}
                    className={`border-t border-slate-100 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60 ${
                      selectedFileIds.has(String(file.id)) ? 'bg-sky-50/60 dark:bg-sky-950/20' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedFileIds.has(String(file.id))}
                        onChange={() => onToggleFileSelection?.(file.id)}
                        onClick={(event) => event.stopPropagation()}
                        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        aria-label={`Select ${file.name}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onOpenFile?.(file)}
                        className="flex items-start gap-2 text-left font-medium text-slate-800 hover:underline dark:text-slate-100"
                      >
                        <FileText size={16} className="text-sky-600" />
                        <span>
                          <span>{file.name}</span>
                          {(file.tags?.length || file.versionCount) ? (
                            <span className="mt-1 flex flex-wrap gap-1 text-[11px] font-normal">
                              {file.tags?.slice(0, 3).map((tag) => (
                                <span key={`${file.id}-${tag}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  #{tag}
                                </span>
                              ))}
                              {file.versionCount ? (
                                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                                  {file.versionCount} {file.versionCount === 1 ? 'version' : 'versions'}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <p>{file.activity}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{file.size}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{file.owner}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{file.location}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenFile?.(file)}
                          className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleStar?.(file)}
                          className="rounded-lg bg-amber-100 px-2 py-1 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                        >
                          <span className="inline-flex items-center gap-1">
                            <Star size={12} />
                            {file.starred ? 'Unstar' : 'Star'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onVersionHistory?.(file)}
                          className="rounded-lg bg-sky-100 px-2 py-1 text-xs text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                        >
                          <span className="inline-flex items-center gap-1">
                            <History size={12} />
                            History
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteFile?.(file.id)}
                          className="rounded-lg bg-rose-100 px-2 py-1 text-xs text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    No files found in this section.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function QuickActions({ selectedFolderId, onRefresh }) {
  const [creatingFolder, setCreatingFolder] = useState(false)

  const handleCreateFolder = async () => {
    const name = await promptAction({
      title: 'Create folder',
      message: 'Enter a name for the new folder.',
      confirmLabel: 'Create',
      placeholder: 'Folder name',
    })
    const trimmedName = name?.trim()
    if (!trimmedName) return

    try {
      setCreatingFolder(true)
      await api.createFolder({
        name: trimmedName,
        parent_folder_id: selectedFolderId || null,
      })
      await onRefresh?.()
      toast.success(`Folder "${trimmedName}" created`)
    } catch (error) {
      console.error(error)
      toast.error(error.message || 'Failed to create folder')
    } finally {
      setCreatingFolder(false)
    }
  }

  const handleUploadClick = () => {
    window.dispatchEvent(new CustomEvent('drive:open-upload-picker', {
      detail: { folderId: selectedFolderId || null },
    }))
  }

  return (
    <section className="mt-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Quick Actions</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          onClick={handleUploadClick}
          className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm font-medium text-slate-700 transition hover:border-sky-400 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Upload size={16} />
          Upload File
        </button>
        <button
          onClick={handleCreateFolder}
          disabled={creatingFolder}
          className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Folder size={16} />
          {creatingFolder ? 'Creating...' : 'Create Folder'}
        </button>
      </div>
    </section>
  )
}

function StoragePanel({ storage, largestFiles, heading = 'Storage' }) {
  const storageMetrics = normalizeStoragePayload(storage)

  return (
    <section className="grid gap-5 xl:grid-cols-3">
      <article className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-1 dark:border-slate-700 dark:bg-slate-900">
        {heading ? (
          <div className="mb-3 flex items-center gap-2">
            <Database size={18} className="text-sky-600" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{heading}</h2>
          </div>
        ) : null}
        <p className="text-sm text-slate-500 dark:text-slate-400">{formatBytes(storageMetrics.used)} used</p>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-600" style={{ width: `${storageMetrics.usedPercent}%` }} />
        </div>
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{formatBytes(storageMetrics.remaining)} available of {formatBytes(storageMetrics.total)}</p>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-2 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Large files consuming space</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
          {largestFiles.map((file) => (
            <li key={file.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
              <span>{file.name}</span>
              <span className="text-xs">{file.size}</span>
            </li>
          ))}
        </ul>
      </article>
    </section>
  )
}

export { SidebarNav, TopBar, ViewHeader, BulkFileActionsBar, FolderGrid, FilesTable, QuickActions, StoragePanel }

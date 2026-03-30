import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { api } from '../lib/api'

const DriveContext = createContext(null)

function normalizeResponse(payload) {
  if (Array.isArray(payload)) return payload
  return payload?.data || payload?.files || []
}

function normalizeFolders(payload) {
  if (Array.isArray(payload)) return payload
  return payload?.data || payload?.folders || []
}

function DriveProvider({ children, selectedNav, folderId, onAuthError }) {
  const [files, setFiles] = useState([])
  const [folders, setFolders] = useState([])
  const [currentFolder, setCurrentFolder] = useState(null)
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: null, name: 'My Drive' }])
  const [loading, setLoading] = useState(true)

  const refreshFolders = useCallback(async () => {
    const response = await api.getFolders()
    const list = normalizeFolders(response)
    setFolders(list)
    return list
  }, [])

  const refreshFiles = useCallback(async (override = {}) => {
    const nav = override.selectedNav ?? selectedNav
    const targetFolderId = override.folderId === undefined ? folderId : override.folderId

    if (nav === 'media' || nav === 'photos') {
      const data = await api.getMedia()
      const list = normalizeResponse(data)
      setFiles(list)
      return list
    }

    if (nav === 'recent') {
      const data = await api.getRecentFiles()
      const list = normalizeResponse(data)
      setFiles(list)
      return list
    }

    if (nav === 'starred') {
      const data = await api.getStarredFiles()
      const list = normalizeResponse(data)
      setFiles(list)
      return list
    }

    if (targetFolderId) {
      const data = await api.getFolderContents(targetFolderId)
      const list = normalizeResponse(data?.files)
      setFiles(list)
      return list
    }

    const data = await api.getFiles()
    const list = normalizeResponse(data)
    setFiles(list)
    return list
  }, [folderId, selectedNav])

  const rebuildBreadcrumbs = useCallback((targetFolderId, allFolders) => {
    const trail = [{ id: null, name: 'My Drive' }]
    if (!targetFolderId) return trail

    const byId = new Map(allFolders.map((item) => [String(item.id), item]))
    const chain = []
    let cursor = byId.get(String(targetFolderId))

    while (cursor) {
      chain.push({ id: cursor.id, name: cursor.name || 'Folder' })
      const parentId = cursor.parent_folder_id || cursor.parent_folder
      if (!parentId) break
      cursor = byId.get(String(parentId))
    }

    return [...trail, ...chain.reverse()]
  }, [])

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      try {
        const folderList = await refreshFolders()
        await refreshFiles({ folderId })

        if (!active) return

        if (folderId) {
          const folder = folderList.find((item) => String(item.id) === String(folderId)) || null
          setCurrentFolder(folder)
        } else {
          setCurrentFolder(null)
        }

        setBreadcrumbs(rebuildBreadcrumbs(folderId, folderList))
      } catch (error) {
        if (onAuthError) {
          onAuthError(error)
        } else {
          if (import.meta.env.DEV) console.error(error)
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    load()

    return () => {
      active = false
    }
  }, [folderId, rebuildBreadcrumbs, refreshFiles, refreshFolders, onAuthError])

  const openFolder = useCallback((folder) => {
    setCurrentFolder(folder)
    setBreadcrumbs([
      { id: null, name: 'My Drive' },
      { id: folder?.id ?? null, name: folder?.name || 'Folder' },
    ])
  }, [])

  const value = useMemo(() => ({
    files,
    setFiles,
    folders,
    currentFolder,
    breadcrumbs,
    setBreadcrumbs,
    openFolder,
    refreshFiles,
    refreshFolders,
    loading,
  }), [files, folders, currentFolder, breadcrumbs, openFolder, refreshFiles, refreshFolders, loading])

  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>
}

function useDrive() {
  const context = useContext(DriveContext)
  if (!context) {
    throw new Error('useDrive must be used within DriveProvider')
  }
  return context
}

export { DriveProvider, useDrive }
export default DriveContext

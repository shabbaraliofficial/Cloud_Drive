import { useEffect, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'

import { api } from '../../lib/api'
import { toast } from '../../lib/popup'
import ProgressBar from './ProgressBar'

function createQueueItem(file) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    filename: file.name,
    progress: 0,
    status: 'queued',
    detail: 'Queued',
  }
}

function UploadManager({ currentFolderId, onUploaded }) {
  const [uploadQueue, setUploadQueue] = useState([])
  const [visible, setVisible] = useState(false)

  const runSingleUpload = async (file, queueId) => {
    const formatDetail = (progressEvent) => {
      switch (progressEvent?.phase) {
        case 'starting':
          return 'Preparing resumable upload'
        case 'resuming':
          return `Resuming at ${progressEvent.progress}%`
        case 'finishing':
          return 'Finalizing upload'
        case 'completed':
          return 'Uploaded'
        case 'uploading':
          if (progressEvent?.partNumber && progressEvent?.totalParts) {
            return `Chunk ${progressEvent.partNumber}/${progressEvent.totalParts}`
          }
          return 'Uploading'
        default:
          return 'Uploading'
      }
    }

    try {
      setUploadQueue((prev) => prev.map((item) => (
        item.id === queueId
          ? { ...item, status: 'uploading', detail: 'Preparing upload' }
          : item
      )))

      await api.uploadFile(file, currentFolderId, {
        onProgress: (progressEvent) => {
          setUploadQueue((prev) => prev.map((item) => (
            item.id === queueId
              ? {
                  ...item,
                  progress: progressEvent.progress,
                  status: progressEvent.phase === 'completed' ? 'done' : 'uploading',
                  detail: formatDetail(progressEvent),
                }
              : item
          )))
        },
      })

      setUploadQueue((prev) => prev.map((item) => (
        item.id === queueId
          ? { ...item, progress: 100, status: 'done', detail: 'Uploaded' }
          : item
      )))
      return true
    } catch (error) {
      setUploadQueue((prev) => prev.map((item) => (
        item.id === queueId
          ? { ...item, status: 'error', detail: error?.message || 'Upload failed' }
          : item
      )))
      return false
    }
  }

  const uploadFiles = async (files) => {
    if (!files.length) return

    const queueItems = files.map((file) => createQueueItem(file))
    setUploadQueue((prev) => [...queueItems, ...prev])
    setVisible(true)

    let successCount = 0
    let failureCount = 0
    for (let i = 0; i < files.length; i += 1) {
      const ok = await runSingleUpload(files[i], queueItems[i].id)
      if (ok) {
        successCount += 1
      } else {
        failureCount += 1
      }
    }

    if (successCount > 0) {
      await onUploaded?.()
      toast.success(successCount === 1 ? 'File uploaded successfully' : `${successCount} files uploaded successfully`)
    }

    if (failureCount > 0) {
      toast.error(failureCount === 1 ? 'Upload failed' : `${failureCount} uploads failed`)
    }
  }

  useEffect(() => {
    if (!uploadQueue.length) return
    const allDone = uploadQueue.every((item) => item.status === 'done' || item.status === 'error')
    if (!allDone) return

    const timer = window.setTimeout(() => {
      setVisible(false)
      setUploadQueue([])
    }, 2000)

    return () => window.clearTimeout(timer)
  }, [uploadQueue])

  const activeCount = useMemo(() => uploadQueue.filter((item) => item.status === 'uploading' || item.status === 'queued').length, [uploadQueue])
  const { getRootProps, getInputProps, open } = useDropzone({
    noClick: true,
    multiple: true,
    onDrop: (acceptedFiles) => {
      uploadFiles(acceptedFiles)
    },
  })

  useEffect(() => {
    const handleOpenPicker = () => {
      open()
    }

    window.addEventListener('drive:open-upload-picker', handleOpenPicker)
    return () => window.removeEventListener('drive:open-upload-picker', handleOpenPicker)
  }, [open])

  return (
    <>
      <div {...getRootProps()} className="hidden">
        <input {...getInputProps()} />
      </div>

      {visible ? (
        <div className="fixed right-6 bottom-6 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Uploading</h4>
            <span className="text-xs text-slate-500 dark:text-slate-400">{activeCount} active</span>
          </div>

          <div className="max-h-60 space-y-3 overflow-auto">
            {uploadQueue.map((item) => (
              <div key={item.id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-slate-700 dark:text-slate-200">{item.filename}</span>
                  <span className={`font-medium ${item.status === 'error' ? 'text-rose-600' : 'text-slate-500 dark:text-slate-400'}`}>
                    {item.status === 'done' ? 'Done' : item.status === 'error' ? 'Failed' : `${item.progress}%`}
                  </span>
                </div>
                <ProgressBar value={item.progress} tone={item.status === 'error' ? 'danger' : 'brand'} />
                <p className={`mt-1 text-[11px] ${item.status === 'error' ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}`}>
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}

export default UploadManager

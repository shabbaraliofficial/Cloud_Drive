import { useEffect, useState } from 'react'

function ContextMenu({ menu, onClose, onOpen, onDelete, onRename, onMove, onStar, onDownload, onShare, onVersionHistory }) {
  const [renameTargetId, setRenameTargetId] = useState(null)
  const [name, setName] = useState('')
  const item = menu?.item || menu?.file || null
  const itemType = menu?.type || (menu?.file ? 'file' : 'file')
  const renaming = Boolean(item && renameTargetId === item.id)
  const menuClassName = 'fixed z-[70] w-[180px] rounded-lg border border-slate-800 bg-slate-950 p-1.5 text-slate-100 shadow-[0_12px_32px_rgba(2,6,23,0.38)]'
  const itemClassName = 'flex h-9 w-full items-center rounded-md px-3 text-left text-sm font-medium text-slate-100 transition-colors hover:bg-white/5'
  const dangerItemClassName = 'flex h-9 w-full items-center rounded-md px-3 text-left text-sm font-medium text-rose-400 transition-colors hover:bg-rose-500/10'

  useEffect(() => {
    if (!menu) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setRenameTargetId(null)
        onClose?.()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menu, onClose])

  if (!menu) return null

  const submitRename = async () => {
    const nextName = name.trim()
    if (!item || !nextName || nextName === item.name) {
      setRenameTargetId(null)
      return
    }
    await onRename?.(item, nextName, itemType)
    setRenameTargetId(null)
    onClose?.()
  }

  return (
    <div
      className={menuClassName}
      style={{ top: menu.y, left: menu.x }}
      onClick={(event) => event.stopPropagation()}
    >
      {renaming ? (
        <div className="space-y-2 p-1">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitRename()
              if (event.key === 'Escape') setRenameTargetId(null)
            }}
            className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitRename}
              className="flex h-8 flex-1 items-center justify-center rounded-md bg-sky-600 px-3 text-xs font-medium text-white transition-colors hover:bg-sky-500"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setRenameTargetId(null)}
              className="flex h-8 flex-1 items-center justify-center rounded-md bg-slate-800 px-3 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => { setRenameTargetId(null); onOpen?.(item, itemType); onClose?.() }} className={itemClassName}>Open</button>
          <button type="button" onClick={() => { setName(item?.name || ''); setRenameTargetId(item?.id || null) }} className={itemClassName}>Rename</button>
          <button type="button" onClick={() => { setRenameTargetId(null); onDelete?.(item, itemType); onClose?.() }} className={dangerItemClassName}>Delete</button>
          <button type="button" onClick={() => { setRenameTargetId(null); onMove?.(item, itemType); onClose?.() }} className={itemClassName}>Move</button>
          <button
            type="button"
            onClick={() => { setRenameTargetId(null); onStar?.(item, itemType); onClose?.() }}
            className={itemClassName}
          >
            Star
          </button>
          <button
            type="button"
            onClick={() => { setRenameTargetId(null); onDownload?.(item, itemType); onClose?.() }}
            className={itemClassName}
          >
            Download
          </button>
          {itemType === 'file' ? (
            <button
              type="button"
              onClick={() => { setRenameTargetId(null); onVersionHistory?.(item); onClose?.() }}
              className={itemClassName}
            >
              Version History
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => { setRenameTargetId(null); onShare?.(item, itemType); onClose?.() }}
            className={itemClassName}
          >
            Share
          </button>
        </>
      )}
    </div>
  )
}

export default ContextMenu

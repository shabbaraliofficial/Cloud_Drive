import {
  CheckSquare,
  FileText,
  Folder,
  Image as ImageIcon,
  RotateCcw,
  Square,
  Trash2,
  Video,
} from 'lucide-react'

function formatDeletedAt(value) {
  if (!value) return 'Deleted recently'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Deleted recently'
  return `Deleted ${date.toLocaleDateString()}`
}

function ItemPreview({ item }) {
  if (item.type === 'folder') {
    return (
      <div className="flex h-28 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white">
        <Folder size={34} />
      </div>
    )
  }

  if (item.kind === 'image' && item.thumbnailUrl) {
    return <img src={item.thumbnailUrl} alt={item.name} className="h-28 w-full rounded-2xl object-cover" />
  }

  if (item.kind === 'video' && item.thumbnailUrl) {
    return <img src={item.thumbnailUrl} alt={item.name} className="h-28 w-full rounded-2xl object-cover" />
  }

  const Icon = item.kind === 'video' ? Video : item.kind === 'image' ? ImageIcon : FileText
  return (
    <div className="flex h-28 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
      <Icon size={32} />
    </div>
  )
}

function TrashView({
  items,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRestoreItem,
  onDeleteItem,
  onRestoreSelected,
  onDeleteSelected,
  onEmptyTrash,
  busy = false,
  title = 'Trash actions',
  subtitle = 'Select items to restore or delete permanently',
  emptyText = 'Trash is empty.',
  showEmptyTrashAction = true,
}) {
  const selectedCount = selectedIds.size
  const allSelected = items.length > 0 && selectedCount === items.length
  const showSummary = Boolean(selectedCount || title || subtitle)

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        {showSummary ? (
          <div>
            {title ? <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p> : null}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {selectedCount ? `${selectedCount} selected` : subtitle}
            </p>
          </div>
        ) : <div />}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onToggleSelectAll}
            disabled={!items.length || busy}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
          >
            {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
            {allSelected ? 'Clear selection' : 'Select all'}
          </button>
          <button
            type="button"
            onClick={onRestoreSelected}
            disabled={!selectedCount || busy}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw size={16} />
            Restore selected
          </button>
          <button
            type="button"
            onClick={onDeleteSelected}
            disabled={!selectedCount || busy}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={16} />
            Delete selected
          </button>
          {showEmptyTrashAction ? (
            <button
              type="button"
              onClick={onEmptyTrash}
              disabled={!items.length || busy}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/40 dark:text-rose-300"
            >
              <Trash2 size={16} />
              Empty trash
            </button>
          ) : null}
        </div>
      </div>

      {items.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const selected = selectedIds.has(`${item.type}:${item.id}`)
            return (
              <article
                key={`${item.type}:${item.id}`}
                className={`rounded-3xl border bg-white p-4 shadow-sm transition dark:bg-slate-900 ${
                  selected
                    ? 'border-sky-500 ring-2 ring-sky-100 dark:border-sky-400 dark:ring-sky-900/40'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onToggleSelect(item)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                    aria-label={`Select ${item.name}`}
                  >
                    {selected ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    {item.type}
                  </span>
                </div>

                <ItemPreview item={item} />

                <div className="mt-4">
                  <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{item.name}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDeletedAt(item.deletedAt)}</p>
                  {item.size ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.size}</p> : null}
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onRestoreItem(item)}
                    disabled={busy}
                    className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteItem(item)}
                    disabled={busy}
                    className="flex-1 rounded-xl bg-rose-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete forever
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          {emptyText}
        </div>
      )}
    </section>
  )
}

export default TrashView

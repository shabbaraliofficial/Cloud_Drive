import { format, isThisMonth, isToday, isYesterday } from 'date-fns'
import { Image as ImageIcon, PlayCircle } from 'lucide-react'

function groupMedia(files = []) {
  const groups = {
    Today: [],
    Yesterday: [],
    'This Month': [],
    Earlier: [],
  }

  files.forEach((file) => {
    const rawDate = file.createdAt || file.updatedAt || null
    const parsedDate = rawDate ? new Date(rawDate) : null
    if (parsedDate && !Number.isNaN(parsedDate.getTime())) {
      if (isToday(parsedDate)) {
        groups.Today.push(file)
        return
      }
      if (isYesterday(parsedDate)) {
        groups.Yesterday.push(file)
        return
      }
      if (isThisMonth(parsedDate)) {
        groups['This Month'].push(file)
        return
      }
    }
    groups.Earlier.push(file)
  })

  return Object.entries(groups).filter(([, items]) => items.length)
}

function MediaCard({ file, onOpenFile }) {
  const mediaDate = file.createdAt || file.updatedAt || null
  const parsedDate = mediaDate ? new Date(mediaDate) : null
  const dateLabel = parsedDate && !Number.isNaN(parsedDate.getTime())
    ? format(parsedDate, 'MMM d, yyyy')
    : 'Unknown date'

  return (
    <button
      type="button"
      onClick={() => onOpenFile?.(file)}
      className="group overflow-hidden rounded-3xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100 dark:bg-slate-800">
        {file.thumbnailUrl ? (
          <img
            src={file.thumbnailUrl}
            alt={file.name}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : null}

        {!file.thumbnailUrl && file.kind === 'video' && file.fileUrl ? (
          <video
            muted
            playsInline
            preload="metadata"
            src={file.fileUrl}
            className="h-full w-full object-cover"
          />
        ) : null}

        {!file.thumbnailUrl ? (
          <div className="flex h-full items-center justify-center text-slate-400 dark:text-slate-500">
            <ImageIcon size={34} />
          </div>
        ) : null}

        {file.kind === 'video' ? (
          <span className="absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white">
            <PlayCircle size={14} />
            Video
          </span>
        ) : null}
      </div>

      <div className="p-4">
        <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{file.name}</h3>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="truncate">{file.size}</span>
          <span className="truncate">{dateLabel}</span>
        </div>
      </div>
    </button>
  )
}

function MediaGallery({ files, onOpenFile }) {
  const groupedMedia = groupMedia(files)

  return (
    <section className="space-y-8">
      {groupedMedia.length ? (
        groupedMedia.map(([label, items]) => (
          <section key={label} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</h3>
              <span className="text-xs text-slate-400 dark:text-slate-500">{items.length} item{items.length === 1 ? '' : 's'}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {items.map((file) => (
                <MediaCard key={file.id} file={file} onOpenFile={onOpenFile} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No media files found yet.
        </div>
      )}
    </section>
  )
}

export default MediaGallery

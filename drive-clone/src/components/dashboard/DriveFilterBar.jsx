import { CalendarRange, FolderTree, Layers3, RotateCcw, Users } from 'lucide-react'

const FILTER_CONFIG = [
  {
    key: 'type',
    label: 'Type',
    Icon: Layers3,
    options: [
      { value: 'all', label: 'All types' },
      { value: 'folders', label: 'Folders' },
      { value: 'files', label: 'Files' },
      { value: 'image', label: 'Images' },
      { value: 'video', label: 'Videos' },
      { value: 'pdf', label: 'PDF' },
      { value: 'docs', label: 'Docs' },
    ],
  },
  {
    key: 'people',
    label: 'People',
    Icon: Users,
    options: [
      { value: 'anyone', label: 'Anyone' },
      { value: 'me', label: 'Me' },
      { value: 'others', label: 'Others' },
      { value: 'shared', label: 'Shared' },
    ],
  },
  {
    key: 'modified',
    label: 'Modified',
    Icon: CalendarRange,
    options: [
      { value: 'any_time', label: 'Any time' },
      { value: 'today', label: 'Today' },
      { value: 'last_7_days', label: 'Last 7 days' },
      { value: 'last_30_days', label: 'Last 30 days' },
    ],
  },
  {
    key: 'source',
    label: 'Source',
    Icon: FolderTree,
    options: [
      { value: 'all', label: 'All sources' },
      { value: 'drive', label: 'Drive root' },
      { value: 'folder', label: 'Folders' },
      { value: 'shared', label: 'Shared' },
    ],
  },
]

function DriveFilterField({ label, Icon, value, options, onChange }) {
  return (
    <label className="min-w-[180px] flex-1">
      <span className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon size={14} />
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function DriveFilterBar({ filters, activeCount = 0, onChange, onReset }) {
  return (
    <section className="mb-6 rounded-[28px] border border-slate-200 bg-white/92 p-4 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/88">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Refine My Drive</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Filter files and folders the same way you would in a modern drive workspace.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {activeCount} active filter{activeCount === 1 ? '' : 's'}
          </span>
          {activeCount ? (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCcw size={14} />
              Reset
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {FILTER_CONFIG.map(({ key, label, Icon, options }) => (
          <DriveFilterField
            key={key}
            label={label}
            Icon={Icon}
            value={filters[key]}
            options={options}
            onChange={(value) => onChange(key, value)}
          />
        ))}
      </div>
    </section>
  )
}

export default DriveFilterBar

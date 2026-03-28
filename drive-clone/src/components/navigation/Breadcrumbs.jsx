function Breadcrumbs({ items = [], onNavigate }) {
  if (!items.length) {
    return null
  }

  return (
    <nav className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300" aria-label="Breadcrumb">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <div key={`${item.id ?? 'root'}-${index}`} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate?.(item, index)}
              disabled={isLast}
              className={`rounded px-1 py-0.5 ${isLast ? 'cursor-default font-semibold text-slate-900 dark:text-slate-100' : 'hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100'}`}
            >
              {item.name}
            </button>
            {!isLast ? <span className="text-slate-400">/</span> : null}
          </div>
        )
      })}
    </nav>
  )
}

export default Breadcrumbs

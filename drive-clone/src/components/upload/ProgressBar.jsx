function ProgressBar({ value = 0, tone = 'brand' }) {
  const width = Math.max(0, Math.min(100, value))
  const fillClassName = tone === 'danger' ? 'bg-rose-500' : 'bg-sky-600'

  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div
        className={`h-full transition-all duration-300 ${fillClassName}`}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}

export default ProgressBar

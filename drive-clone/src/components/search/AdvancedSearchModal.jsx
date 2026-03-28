import { useEffect, useMemo, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'

import { createAdvancedSearchFormValues } from '../../lib/search'

function FieldLabel({ children }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
      {children}
    </span>
  )
}

function TextField({ label, ...props }) {
  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <input
        {...props}
        className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
      />
    </div>
  )
}

function SelectField({ label, children, ...props }) {
  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <select
        {...props}
        className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
      >
        {children}
      </select>
    </div>
  )
}

function CheckboxField({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
      />
      <span>{label}</span>
    </label>
  )
}

function AdvancedSearchModal({ initialValues, onClose, onSearch }) {
  const [formState, setFormState] = useState(() => createAdvancedSearchFormValues(initialValues))

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const hasFilters = useMemo(
    () => Object.values(formState).some((value) => (typeof value === 'boolean' ? value : String(value).trim())),
    [formState]
  )

  const updateField = (key, value) => {
    setFormState((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    onSearch?.(createAdvancedSearchFormValues(formState))
  }

  const handleReset = () => {
    setFormState(createAdvancedSearchFormValues())
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-4xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-700">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              <SlidersHorizontal size={14} />
              Search
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">Advanced Search</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Refine files and folders with Google Drive style filters.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Close advanced search"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Item Name"
              placeholder="Enter file name"
              value={formState.name}
              onChange={(event) => updateField('name', event.target.value)}
            />
            <TextField
              label="Includes Words"
              placeholder="Search inside file"
              value={formState.includesWords}
              onChange={(event) => updateField('includesWords', event.target.value)}
            />
            <TextField
              label="Shared To"
              type="email"
              placeholder="name@example.com"
              value={formState.sharedTo}
              onChange={(event) => updateField('sharedTo', event.target.value)}
            />
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-950">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-sky-100 p-3 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                  <Search size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Live search</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Applying search closes this modal and refreshes results instantly.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SelectField
              label="Type"
              value={formState.type}
              onChange={(event) => updateField('type', event.target.value)}
            >
              <option value="any">Any</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="pdf">PDF</option>
              <option value="document">Document</option>
            </SelectField>

            <SelectField
              label="Owner"
              value={formState.owner}
              onChange={(event) => updateField('owner', event.target.value)}
            >
              <option value="anyone">Anyone</option>
              <option value="me">Me</option>
              <option value="others">Others</option>
            </SelectField>

            <SelectField
              label="Location"
              value={formState.location}
              onChange={(event) => updateField('location', event.target.value)}
            >
              <option value="anywhere">Anywhere</option>
              <option value="my_drive">My Drive</option>
              <option value="folder">Folder</option>
            </SelectField>

            <SelectField
              label="Date Modified"
              value={formState.dateModified}
              onChange={(event) => updateField('dateModified', event.target.value)}
            >
              <option value="any_time">Any time</option>
              <option value="today">Today</option>
              <option value="last_7_days">Last 7 days</option>
              <option value="last_30_days">Last 30 days</option>
            </SelectField>
          </div>

          <div className="mt-5">
            <FieldLabel>Flags</FieldLabel>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <CheckboxField label="In Bin" checked={formState.inBin} onChange={(checked) => updateField('inBin', checked)} />
              <CheckboxField label="Starred" checked={formState.starred} onChange={(checked) => updateField('starred', checked)} />
              <CheckboxField label="Encrypted" checked={formState.encrypted} onChange={(checked) => updateField('encrypted', checked)} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {hasFilters ? 'Filters are ready to apply.' : 'No filters selected yet.'}
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Reset
            </button>
            <button
              type="submit"
              className="rounded-2xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500"
            >
              Search
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

export default AdvancedSearchModal

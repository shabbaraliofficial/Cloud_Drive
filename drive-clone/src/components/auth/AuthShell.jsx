import { Moon, Sun } from 'lucide-react'
import useTheme from '../../context/useTheme'

function AuthShell({ title, subtitle, children, sideText }) {
  const { isDark, toggleTheme } = useTheme()

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto mb-3 flex max-w-6xl justify-end">
        <button
          type="button"
          onClick={toggleTheme}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white/80 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-white dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-900"
        >
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
          {isDark ? 'Light Mode' : 'Dark Mode'}
        </button>
      </div>
      <div className="mx-auto grid min-h-[88vh] max-w-6xl overflow-hidden rounded-3xl border border-white/60 bg-white/75 shadow-2xl backdrop-blur lg:grid-cols-2 dark:border-slate-700 dark:bg-slate-900/85">
        <div className="relative hidden overflow-hidden bg-slate-900 p-10 text-white lg:block dark:bg-slate-950">
          <div className="absolute -top-10 -left-16 h-48 w-48 rounded-full bg-sky-500/30 blur-2xl" />
          <div className="absolute right-0 bottom-0 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="relative z-10 flex h-full flex-col justify-between">
            <p className="text-sm uppercase tracking-[0.3em] text-slate-300">CloudDrive</p>
            <div>
              <h2 className="text-4xl leading-tight font-semibold">Secure file management, built for fast teams.</h2>
              <p className="mt-5 max-w-md text-slate-300">{sideText}</p>
            </div>
            <p className="text-xs text-slate-400">Modern workspace inspired by professional cloud suites.</p>
          </div>
        </div>
        <div className="flex items-center justify-center p-5 sm:p-10">
          <div className="w-full max-w-xl">
            <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{subtitle}</p>
            <div className="mt-8">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AuthShell


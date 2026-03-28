import { useEffect, useMemo, useState } from 'react'
import ThemeContext from './theme-context'

function ThemeProvider({ children }) {

  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('theme-mode')
    if (stored) return stored === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('theme-mode', isDark ? 'dark' : 'light')
  }, [isDark])

  const value = useMemo(() => ({
    isDark,
    toggleTheme: () => setIsDark(prev => !prev)
  }), [isDark])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export default ThemeProvider
import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Local-only light/dark toggle: plain component state, no IPC/persistence
 * by design - a relaunch simply re-reads the OS preference again. Applies
 * the `dark` class Tailwind's custom `dark:` variant looks for (see
 * src/renderer/styles/index.css) to <html>, so every screen in the app
 * reacts without each one holding its own theme state.
 *
 * `absolute` (not viewport-`fixed`) within App.tsx's `relative` content
 * region - anchors to that region's own top-right corner rather than the
 * raw viewport, so it can never drift over the separate network banner
 * above it. Screen headers still reserve space for it (see MessageScreen/
 * ChatListScreen) so a long title truncates before running underneath.
 */
export function ThemeToggle(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return (
    <button
      type="button"
      onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
      className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-base shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
    </button>
  )
}

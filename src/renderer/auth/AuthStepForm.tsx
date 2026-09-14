import { useState, type FormEvent, type HTMLInputTypeAttribute } from 'react'

export interface AuthStepFormProps {
  prompt: string
  label: string
  inputType?: HTMLInputTypeAttribute
  autoComplete?: string
  placeholder?: string
  submitting: boolean
  error: string | null
  onSubmit: (value: string) => void
  /** Password fields must not linger in React state after submit - see docs/tdlib-integration.md security notes. */
  clearOnSubmit?: boolean
}

export function AuthStepForm({
  prompt,
  label,
  inputType = 'text',
  autoComplete,
  placeholder,
  submitting,
  error,
  onSubmit,
  clearOnSubmit = false,
}: AuthStepFormProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const canSubmit = !submitting && value.trim().length > 0

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!canSubmit) return
    const submittedValue = value
    if (clearOnSubmit) setValue('')
    onSubmit(submittedValue)
  }

  return (
    <main className="flex h-full w-full items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="mb-1 text-center text-lg font-semibold text-slate-900 dark:text-slate-50">
          Telegram Desktop Client
        </h1>
        <p className="mb-6 text-center text-sm text-slate-500 dark:text-slate-400">{prompt}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {label}
            <input
              type={inputType}
              value={value}
              autoComplete={autoComplete}
              placeholder={placeholder}
              disabled={submitting}
              onChange={(event) => setValue(event.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:ring-offset-slate-900"
          >
            {error ? 'Попробовать снова' : 'Продолжить'}
          </button>
        </form>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400"
          >
            {error}
          </p>
        )}
      </div>
    </main>
  )
}

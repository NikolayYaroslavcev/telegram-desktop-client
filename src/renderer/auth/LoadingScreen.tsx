import type { AuthorizationStatus } from '../../shared/models'
import { loadingMessageFor } from './resolveAuthScreen'

export function LoadingScreen({ status }: { status: AuthorizationStatus }): React.JSX.Element {
  return (
    <main className="flex h-full w-full flex-col items-center justify-center gap-4 bg-slate-100 dark:bg-slate-950">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
        Telegram Desktop Client
      </h1>
      <div
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500 motion-reduce:animate-none dark:border-slate-700 dark:border-t-sky-400"
      />
      <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
        {loadingMessageFor(status)}
      </p>
    </main>
  )
}

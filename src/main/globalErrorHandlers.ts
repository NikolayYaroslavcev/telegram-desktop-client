import { describeErrorForLog, logger } from './logger'

export type FatalErrorSource = 'uncaughtException' | 'unhandledRejection'

/**
 * Logs an unexpected, unclassified main-process failure - the last-resort
 * safety net for anything that escaped every typed error boundary
 * (`handle()`, `runTdlibCall`, `MessageRepository`, ...). Pure and testable
 * on its own, separate from the actual `process.on(...)` wiring below.
 */
export function handleFatalProcessError(source: FatalErrorSource, err: unknown): void {
  const described = describeErrorForLog(err)
  logger.error({
    operation: `process.${source}`,
    errorCode: 'INTERNAL_ERROR',
    details: { name: described.name, message: described.message },
  })
}

interface ProcessLike {
  on(event: 'uncaughtException', listener: (err: Error) => void): unknown
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown
}

/**
 * Installs the top-level `uncaughtException`/`unhandledRejection` safety
 * net (Task 18). Per that task's rules: log the fatal failure (never a raw
 * stack/credentials to anything but this process's own logs), never try to
 * keep running past an unknown corrupted state, and never loop-restart -
 * so this always exits once, it does not retry or relaunch anything.
 *
 * `exit` and `target` are injectable so tests can observe the decision
 * without actually terminating the process or registering a listener on the
 * real global `process` - `node --test` installs its own `uncaughtException`
 * listener for crash detection, and emitting on the real `process` object
 * from a test would collide with that.
 */
export function installGlobalSafetyNet(
  exit: (code: number) => void = (code) => process.exit(code),
  target: ProcessLike = process,
): void {
  target.on('uncaughtException', (err) => {
    handleFatalProcessError('uncaughtException', err)
    exit(1)
  })

  target.on('unhandledRejection', (reason) => {
    handleFatalProcessError('unhandledRejection', reason)
    exit(1)
  })
}

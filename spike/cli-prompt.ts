import * as readline from 'node:readline'

type WithWriteToOutput = readline.Interface & { _writeToOutput?: (s: string) => void }

// A single readline interface is created lazily and reused for every
// prompt (phone, code, password) instead of creating/closing a fresh one
// per prompt. Root cause of the original bug: by the time the password
// prompt ran, two prior `readline.createInterface(...)` instances had
// already been created and `.close()`d on the same `process.stdin`. That
// close-then-recreate churn on the same TTY left stdin not accepting
// keyboard input at all for the third interface - regardless of which
// echo-masking technique was used (a manual `setRawMode` toggle and a
// `readline` instance with a substitute output stream were both tried and
// both failed the same way). Keeping one interface alive for the whole
// login flow avoids that churn entirely.
let sharedRl: WithWriteToOutput | null = null

function getRl(): WithWriteToOutput {
  if (!sharedRl) {
    sharedRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    }) as WithWriteToOutput
    // In raw/terminal mode, Ctrl+C arrives as a keypress rather than a
    // process-level SIGINT (that's up to readline to translate). Registered
    // once here, not per-question, so it doesn't stack across repeated
    // askHidden retries.
    sharedRl.on('SIGINT', () => {
      process.emit('SIGINT')
    })
  }
  return sharedRl
}

/** Closes the shared prompt interface, if one was created. Safe to call multiple times. */
export function closePrompts(): void {
  if (sharedRl) {
    sharedRl.close()
    sharedRl = null
  }
}

/**
 * Reads one line from stdin, echoed normally by the terminal. Used for
 * inputs that are not secret (phone number, OTP code) - per task 01.3 scope,
 * these must not be re-printed by us afterwards, but normal terminal echo
 * while typing is fine.
 */
export function askVisible(question: string): Promise<string> {
  return new Promise((resolve) => {
    getRl().question(question, (answer) => {
      resolve(answer.trim())
    })
  })
}

/**
 * Reads one line from stdin without echoing typed characters, for secrets
 * (the 2FA password). Uses the same shared `readline` interface as
 * `askVisible`; only the interface's internal line-render function is
 * swapped out for the duration of this one question, so nothing typed
 * (or the newline from Enter) gets echoed. This is the standard way to
 * mask input with core `readline`, without an extra dependency.
 *
 * Falls back to visible input if stdin is not a TTY (e.g. piped input),
 * since keypress-based masking requires a real terminal.
 */
export function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stdout.write('[standalone] warning: no TTY detected, input will be visible\n')
    return askVisible(question)
  }

  const rl = getRl()
  const originalWriteToOutput = rl._writeToOutput?.bind(rl)

  return new Promise((resolve) => {
    if (originalWriteToOutput) {
      rl._writeToOutput = (stringToWrite: string) => {
        // Let only the prompt text itself through; everything typed after
        // it (including the newline from Enter) is swallowed.
        if (stringToWrite === question) originalWriteToOutput(stringToWrite)
      }
    }

    rl.question(question, (answer) => {
      if (originalWriteToOutput) rl._writeToOutput = originalWriteToOutput
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

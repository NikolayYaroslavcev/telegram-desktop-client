/**
 * Domain user model - only the fields this project's private 1-on-1 chat
 * scope needs, not a copy of TDLib's `user` (~30 Telegram-account fields,
 * most irrelevant here). `firstName`/`lastName` are always strings (TDLib
 * itself represents "no last name" as `''`, never `undefined`) - the domain
 * model keeps that same convention instead of inventing a second one.
 */
export interface User {
  id: number
  firstName: string
  lastName: string
  isBot: boolean
}

import type { user as TdUser } from 'tdlib-types'
import type { User } from '../../../shared/models/user'

/**
 * Pure TDLib `user` -> domain `User` mapping. No I/O, no mutation of `tdUser`.
 */
export function mapTdlibUserToUser(tdUser: TdUser): User {
  return {
    id: tdUser.id,
    firstName: tdUser.first_name,
    lastName: tdUser.last_name,
    isBot: tdUser.type._ === 'userTypeBot',
  }
}

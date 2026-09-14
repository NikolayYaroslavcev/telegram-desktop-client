const DELETED_MARKER = 'Сообщение удалено'

/**
 * Fixed label shown next to a tombstoned message's preserved text (Task 16)
 * - kept out of `MessageScreen.tsx` the same way `messageSendFailure.ts`/
 * `replyPreview.ts` keep their own copy out of the component. Deliberately
 * distinct from `replyPreview.ts`'s "Ответ на удалённое сообщение": that one
 * labels a reply *pointing at* a deleted message, this one labels the
 * deleted message itself.
 */
export function formatDeletedMarker(): string {
  return DELETED_MARKER
}

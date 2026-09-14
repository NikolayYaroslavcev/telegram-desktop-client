import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type UIEvent,
} from 'react'
import type { AttachmentType, Chat, Message } from '../../shared/models'
import type { NetworkStatus } from '../../shared/ipc'
import { formatAttachmentSize } from './attachmentDisplay'
import { markMessageDeletedInList, mergeOlderMessages, upsertMessageInList } from './messageList'
import { mapMessageSendFailed } from './messageSendFailure'
import { formatReplyPreviewLabel, resolveReplyPreview } from './replyPreview'
import { formatDeletedMarker } from './tombstoneDisplay'
import { formatMessageTimestamp } from './timestampDisplay'

type AttachmentPreviewState = 'loading' | 'loaded' | 'failed'

export interface MessageScreenProps {
  chat: Chat
  onBack: () => void
}

/**
 * Minimal message screen (Task 12, replies added in Task 13): load history,
 * show it, send plain text with an optional reply. No attachments, unread
 * counters, typing indicator, or search - see docs/plan.md Task 12, "UI".
 *
 * Reply target (`replyToMessageId`) is plain component state, never
 * persisted (see docs/plan.md Task 13, "Reply state") - picking "Ответить"
 * on a message sets it, sending or cancelling clears it. Its display text is
 * resolved on every render via `resolveReplyPreview` against the currently
 * loaded `messages` list - no dedicated IPC/TDLib call per reply, and no
 * separate "is this still valid" state to keep in sync by hand.
 *
 * `messages.getHistory` returns TDLib's own newest-first page order (see
 * `historyService.ts`), so it is reversed once here for display; real-time
 * arrivals from `onNewMessage` are merged in oldest-first via
 * `upsertMessageInList` instead of re-fetching history on every event.
 * The caller (`ReadyScreen`) is expected to render this with `key={chat.id}`
 * so switching chats remounts it (fresh state) rather than this component
 * reset-on-prop-change logic in its own effect body.
 *
 * Sending is fire-and-forget from the UI's point of view: `sendText`
 * resolving only means TDLib accepted the request locally, not that it was
 * delivered (see `TdlibService.sendText`). The realtime router never
 * broadcasts a message still in TDLib's pending "sending" state (see
 * `realtimeUpdates.ts`), so this screen shows a sent message once TDLib has
 * actually confirmed it - there is no optimistic/pending row to get stuck
 * in "sending" forever. If TDLib later reports the send failed
 * (`events.onMessageSendFailed`, Task 12.1), the same alert banner used for
 * a failed `sendText` call is shown - there is no per-message row to remove
 * or mark, since none was ever shown for a still-pending send.
 */
export function MessageScreen({ chat, onBack }: MessageScreenProps): React.JSX.Element {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [replyToMessageId, setReplyToMessageId] = useState<number | null>(null)
  const [pickingAttachment, setPickingAttachment] = useState<AttachmentType | null>(null)

  // Pagination (Task 20 fix, plan.md Task 10 "порциями при скролле вверх"):
  // the initial load above only ever fetches one page. `hasMoreHistory`
  // starts optimistic and flips to false the first time an older-page fetch
  // comes back empty - there is no separate "total count" signal to check
  // against instead.
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Photo preview state (Task 14): a minimal per-message loading/loaded/failed
  // map, not a global state machine - see docs/plan.md Task 14, "Attachment
  // loading state". `requestedDownloads` (a ref, not state) tracks which
  // messages already triggered a download so the effect below never re-fires
  // for the same photo - including when TDLib already reported it downloaded
  // (the attempt still runs once, but `TdlibService.downloadFile` itself is a
  // no-op for an already-complete file, see fileDownload.ts).
  const [attachmentPreviewState, setAttachmentPreviewState] = useState<
    Record<number, AttachmentPreviewState>
  >({})
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<Record<number, string>>({})
  const requestedDownloads = useRef<Set<number>>(new Set())

  const [openingAttachment, setOpeningAttachment] = useState<Record<number, boolean>>({})
  const [attachmentOpenError, setAttachmentOpenError] = useState<Record<number, string>>({})

  // Composer auto-grow (Task 20 fix: plain <input> could never carry a line
  // break at all - HTML strips \n from an input's value outright). A
  // <textarea> can hold multi-line text; this effect just keeps its visible
  // height matched to content, capped so a very long draft scrolls instead
  // of pushing the rest of the layout around.
  const composerRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [draft])

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  useEffect(() => {
    let cancelled = false

    window.electronAPI.messages
      .getHistory(chat.id)
      .then((history) => {
        if (!cancelled) setMessages([...history].reverse())
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Не удалось загрузить историю сообщений')
      })

    const unsubscribe = window.electronAPI.events.onNewMessage((message) => {
      if (message.chatId !== chat.id) return
      setMessages((current) => upsertMessageInList(current ?? [], message))
    })

    const unsubscribeSendFailed = window.electronAPI.events.onMessageSendFailed((event) => {
      if (event.chatId !== chat.id) return
      setError(mapMessageSendFailed())
    })

    // Task 16: a message this screen already shows can be deleted by either
    // side while it's open. The event carries only { chatId, messageId,
    // deletedAt } - the tombstone's text is whatever this screen already
    // has locally, never re-fetched (see events.ts).
    const unsubscribeDeleted = window.electronAPI.events.onMessageDeleted((event) => {
      if (event.chatId !== chat.id) return
      setMessages((current) => (current ? markMessageDeletedInList(current, event) : current))
    })

    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeSendFailed()
      unsubscribeDeleted()
    }
  }, [chat.id])

  // Task 17 recovery: while this chat is open, TDLib's own realtime updates
  // (handled above) are relied on for anything that arrives after
  // reconnecting - but a gap can only be closed for certain by asking TDLib
  // again, not by waiting for more updates that may never come. On a
  // transition into a fully connected state (`'ready'`) from a state that
  // was genuinely not connected (not the initial `'unknown'` before the
  // first event - that's just startup, not a recovery, and this screen's
  // mount effect above already loads history once), this re-fetches the
  // open chat's first page straight from TDLib (`forceRefresh: true`) and
  // replaces the shown list with the result - which is always the freshly
  // re-read, tombstone-protected cache (see `refreshChatHistory`), never a
  // raw TDLib page, so a message deleted earlier is never resurrected on
  // screen. A failed refresh is logged and otherwise ignored: it must not
  // clear what's already shown, and any message it would have caught up on
  // still has a chance to arrive via the realtime stream once truly online.
  useEffect(() => {
    let cancelled = false
    const previousStatus = { current: null as NetworkStatus | null }

    const unsubscribe = window.electronAPI.events.onNetworkStateChanged((state) => {
      const previous = previousStatus.current
      const wasDisconnected = previous !== null && previous !== 'unknown' && previous !== 'ready'
      previousStatus.current = state.status
      if (state.status !== 'ready' || !wasDisconnected) return

      window.electronAPI.messages
        .getHistory(chat.id, 0, true)
        .then((history) => {
          if (!cancelled) setMessages([...history].reverse())
        })
        .catch((err: unknown) => {
          console.error(
            '[messages] recovery refresh failed:',
            err instanceof Error ? err.message : String(err),
          )
        })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [chat.id])

  /**
   * Downloads one photo's inline preview. Shared by the mount/new-message
   * effect below and `handleRetryPreview`: a `downloadAttachment` failure
   * right after sending is often transient (e.g. TDLib/the server hasn't
   * finished processing a just-uploaded photo's size variants yet) rather
   * than permanent, so unlike the once-only auto-fetch, a retry must be able
   * to run again for the same message id.
   */
  function loadPhotoPreview(messageId: number): void {
    setAttachmentPreviewState((state) => ({ ...state, [messageId]: 'loading' }))
    window.electronAPI.messages
      .downloadAttachment(chat.id, messageId)
      .then((result) => {
        setAttachmentPreviewState((state) => ({ ...state, [messageId]: 'loaded' }))
        if (result.previewDataUrl) {
          setAttachmentPreviewUrl((urls) => ({
            ...urls,
            [messageId]: result.previewDataUrl as string,
          }))
        }
      })
      .catch(() => {
        setAttachmentPreviewState((state) => ({ ...state, [messageId]: 'failed' }))
      })
  }

  // Fetches an inline preview for every photo message exactly once (Task
  // 14). Documents are never auto-downloaded here - they only download when
  // the user clicks "Открыть" (see handleOpenAttachment), since there is
  // nothing to preview.
  useEffect(() => {
    if (!messages) return
    for (const message of messages) {
      if (message.attachment?.type !== 'photo') continue
      // Task 16: a deleted message's attachment metadata may still be in
      // storage, but its binary media is never fetched for a tombstone -
      // the UI must show "message deleted", not attempt media recovery.
      if (message.isDeleted) continue
      if (requestedDownloads.current.has(message.id)) continue
      requestedDownloads.current.add(message.id)
      loadPhotoPreview(message.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, chat.id])

  function handleRetryPreview(messageId: number): void {
    loadPhotoPreview(messageId)
  }

  async function handlePickAttachment(type: AttachmentType): Promise<void> {
    if (sending || pickingAttachment) return

    setPickingAttachment(type)
    setError(null)
    try {
      const selected = await window.electronAPI.messages.selectAttachmentFile(type)
      if (!selected) return // user cancelled the dialog

      setSending(true)
      await window.electronAPI.messages.sendAttachment(
        chat.id,
        selected.filePath,
        replyToMessageId ?? undefined,
      )
      setReplyToMessageId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить вложение')
    } finally {
      setPickingAttachment(null)
      setSending(false)
    }
  }

  async function handleOpenAttachment(messageId: number): Promise<void> {
    setOpeningAttachment((state) => ({ ...state, [messageId]: true }))
    setAttachmentOpenError((errors) => {
      const next = { ...errors }
      delete next[messageId]
      return next
    })
    try {
      await window.electronAPI.messages.openAttachment(chat.id, messageId)
    } catch (err) {
      setAttachmentOpenError((errors) => ({
        ...errors,
        [messageId]: err instanceof Error ? err.message : 'Не удалось открыть файл',
      }))
    } finally {
      setOpeningAttachment((state) => ({ ...state, [messageId]: false }))
    }
  }

  /**
   * Fetches one older page via `messages.getHistory(chatId, oldestLoadedId)`
   * and prepends it (Task 20 fix). Scroll position is preserved across the
   * prepend by measuring how much the content height grew and applying that
   * delta to `scrollTop` in the same frame - otherwise the browser keeps
   * `scrollTop` fixed and the view visually jumps down to whatever content
   * now occupies the previously-topmost pixels.
   */
  async function loadOlderMessages(): Promise<void> {
    if (loadingOlder || !hasMoreHistory || !messages || messages.length === 0) return

    setLoadingOlder(true)
    const container = scrollContainerRef.current
    const previousScrollHeight = container?.scrollHeight ?? 0
    try {
      const oldestId = messages[0].id
      const olderPage = await window.electronAPI.messages.getHistory(chat.id, oldestId)
      if (olderPage.length === 0) {
        setHasMoreHistory(false)
        return
      }
      setMessages((current) => mergeOlderMessages(current ?? [], [...olderPage].reverse()))
      requestAnimationFrame(() => {
        if (!container) return
        container.scrollTop += container.scrollHeight - previousScrollHeight
      })
    } catch (err) {
      // Non-fatal: hasMoreHistory is left untouched so scrolling up again retries.
      console.error(
        '[messages] failed to load older history:',
        err instanceof Error ? err.message : String(err),
      )
    } finally {
      setLoadingOlder(false)
    }
  }

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    if (event.currentTarget.scrollTop < 80) void loadOlderMessages()
  }

  async function handleSend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (draft.trim().length === 0 || sending) return

    setSending(true)
    setError(null)
    try {
      await window.electronAPI.messages.sendText(chat.id, draft, replyToMessageId ?? undefined)
      setDraft('')
      setReplyToMessageId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить сообщение')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 flex-none items-center gap-3 border-b border-slate-200 pl-4 pr-14 dark:border-slate-800">
        <button
          type="button"
          onClick={onBack}
          aria-label="К списку чатов"
          className="-ml-1 flex h-8 w-8 flex-none items-center justify-center rounded-full text-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden"
        >
          <span aria-hidden="true">←</span>
        </button>
        <h1 className="min-w-0 truncate text-base font-semibold text-slate-900 dark:text-slate-50">
          {chat.title}
        </h1>
      </header>

      {error && (
        <p
          role="alert"
          className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400"
        >
          {error}
        </p>
      )}

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {messages === null ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Загрузка сообщений…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Сообщений пока нет</p>
        ) : (
          <>
            {loadingOlder && (
              <p className="mb-2 text-center text-xs text-slate-500 dark:text-slate-400">
                Загрузка истории…
              </p>
            )}
            <ul className="flex flex-col gap-3">
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={`flex ${message.isOutgoing ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm sm:max-w-[75%] md:max-w-[70%] ${
                      message.isDeleted
                        ? 'border border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500'
                        : message.isOutgoing
                          ? 'rounded-br-sm bg-sky-500 text-white'
                          : 'rounded-bl-sm border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                    }`}
                  >
                    {message.replyToMessageId !== undefined && (
                      <p
                        className={`mb-1 truncate border-l-2 pl-2 text-xs italic opacity-80 ${
                          message.isOutgoing && !message.isDeleted
                            ? 'border-white/60'
                            : 'border-sky-400'
                        }`}
                      >
                        {formatReplyPreviewLabel(
                          resolveReplyPreview(messages, message.replyToMessageId),
                        )}
                      </p>
                    )}

                    {message.isDeleted ? (
                      // Task 16 tombstone: the message never disappears - only
                      // its interaction is disabled (no "Ответить", no
                      // attachment download/open) and a neutral marker is
                      // shown next to the preserved text. Attachment metadata
                      // may still be in storage, but its media is deliberately
                      // never fetched here.
                      <p className="whitespace-pre-wrap break-words italic">
                        {message.text} <span className="opacity-80">· {formatDeletedMarker()}</span>
                      </p>
                    ) : (
                      <>
                        {message.text && (
                          <p className="whitespace-pre-wrap break-words">{message.text}</p>
                        )}

                        {message.attachment && message.attachment.type === 'photo' && (
                          <div className="mt-2">
                            {attachmentPreviewState[message.id] === 'loaded' &&
                            attachmentPreviewUrl[message.id] ? (
                              <>
                                <img
                                  src={attachmentPreviewUrl[message.id]}
                                  alt=""
                                  className="max-h-60 max-w-full rounded-lg object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleOpenAttachment(message.id)}
                                  disabled={openingAttachment[message.id]}
                                  className={`mt-1 rounded text-xs font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                                    message.isOutgoing
                                      ? 'text-white/90 focus-visible:ring-white'
                                      : 'text-sky-600 focus-visible:ring-sky-500 dark:text-sky-400'
                                  }`}
                                >
                                  {openingAttachment[message.id] ? 'Открываю…' : 'Открыть'}
                                </button>
                              </>
                            ) : attachmentPreviewState[message.id] === 'failed' ? (
                              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                                Не удалось загрузить изображение{' '}
                                <button
                                  type="button"
                                  onClick={() => handleRetryPreview(message.id)}
                                  className="rounded font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                                >
                                  Повторить
                                </button>
                              </p>
                            ) : (
                              <p className="text-xs opacity-75">Загрузка изображения…</p>
                            )}
                            {attachmentOpenError[message.id] && (
                              <p
                                role="alert"
                                className="mt-1 text-xs text-red-600 dark:text-red-400"
                              >
                                {attachmentOpenError[message.id]}
                              </p>
                            )}
                          </div>
                        )}

                        {message.attachment && message.attachment.type === 'document' && (
                          <div className="mt-2">
                            <div
                              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                                message.isOutgoing
                                  ? 'bg-white/15'
                                  : 'bg-slate-50 dark:bg-slate-900/60'
                              }`}
                            >
                              <span aria-hidden="true" className="text-base">
                                📎
                              </span>
                              <span className="min-w-0 flex-1 truncate text-xs">
                                {message.attachment.fileName ?? 'Файл'} (
                                {formatAttachmentSize(message.attachment.size)})
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleOpenAttachment(message.id)}
                                disabled={openingAttachment[message.id]}
                                className={`flex-none rounded text-xs font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                                  message.isOutgoing
                                    ? 'text-white/90 focus-visible:ring-white'
                                    : 'text-sky-600 focus-visible:ring-sky-500 dark:text-sky-400'
                                }`}
                              >
                                {openingAttachment[message.id] ? 'Открываю…' : 'Открыть'}
                              </button>
                            </div>
                            {attachmentOpenError[message.id] && (
                              <p
                                role="alert"
                                className="mt-1 text-xs text-red-600 dark:text-red-400"
                              >
                                {attachmentOpenError[message.id]}
                              </p>
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => setReplyToMessageId(message.id)}
                          className={`mt-1 block rounded text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 ${
                            message.isOutgoing
                              ? 'text-white/80 focus-visible:ring-white'
                              : 'text-slate-500 focus-visible:ring-sky-500 dark:text-slate-400'
                          }`}
                        >
                          Ответить
                        </button>
                      </>
                    )}

                    <span
                      className={`mt-1 block text-right text-xs ${
                        message.isDeleted
                          ? 'opacity-60'
                          : message.isOutgoing
                            ? 'text-white/75'
                            : 'opacity-60'
                      }`}
                    >
                      {formatMessageTimestamp(message.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex-none border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
        {replyToMessageId !== null && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border-l-2 border-sky-400 bg-sky-50 px-3 py-1.5 text-xs text-slate-600 dark:bg-sky-500/10 dark:text-slate-300">
            <span className="min-w-0 flex-1 truncate">
              {formatReplyPreviewLabel(resolveReplyPreview(messages ?? [], replyToMessageId))}
            </span>
            <button
              type="button"
              onClick={() => setReplyToMessageId(null)}
              aria-label="Отменить ответ"
              className="flex-none rounded font-medium text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-400 dark:hover:text-slate-200"
            >
              ✕
            </button>
          </div>
        )}
        <form onSubmit={(event) => void handleSend(event)} className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Сообщение</span>
            <textarea
              ref={composerRef}
              value={draft}
              disabled={sending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Написать сообщение…"
              rows={1}
              className="block max-h-[120px] w-full resize-none overflow-y-auto rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm leading-normal text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            className="flex-none rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:ring-offset-slate-950"
          >
            Отправить
          </button>
        </form>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handlePickAttachment('photo')}
            disabled={sending || pickingAttachment !== null}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {pickingAttachment === 'photo' ? 'Отправка…' : '🖼️ Изображение'}
          </button>
          <button
            type="button"
            onClick={() => void handlePickAttachment('document')}
            disabled={sending || pickingAttachment !== null}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {pickingAttachment === 'document' ? 'Отправка…' : '📎 Файл'}
          </button>
        </div>
      </div>
    </div>
  )
}

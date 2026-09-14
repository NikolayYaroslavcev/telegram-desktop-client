import { useEffect, useState } from 'react'
import type { Chat } from '../../shared/models'

export interface ChatListScreenProps {
  selectedChatId: number | null
  onOpenChat: (chat: Chat) => void
}

/**
 * Minimal private-chat list (Task 12 - just enough to select a chat and get
 * to `MessageScreen`; no unread counters, search, or grouping). Calls
 * `chats.open` before handing the chat off, mirroring the precondition
 * `chatsHandlers.ts` documents: it revalidates the chat server-side rather
 * than trusting this list's own (possibly stale) contents.
 */
export function ChatListScreen({
  selectedChatId,
  onOpenChat,
}: ChatListScreenProps): React.JSX.Element {
  const [chats, setChats] = useState<Chat[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI.chats
      .list()
      .then((result) => {
        if (!cancelled) setChats(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить чаты')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleOpen(chat: Chat): Promise<void> {
    setError(null)
    try {
      await window.electronAPI.chats.open(chat.id)
      onOpenChat(chat)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть чат')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 flex-none items-center border-b border-slate-200 pl-4 pr-14 dark:border-slate-800">
        <span className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">
          Telegram Desktop Client
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <p
            role="alert"
            className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400"
          >
            {error}
          </p>
        )}
        {chats === null ? (
          <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">Загрузка чатов…</p>
        ) : chats.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
            Нет доступных чатов
          </p>
        ) : (
          <ul>
            {chats.map((chat) => {
              const isSelected = chat.id === selectedChatId
              return (
                <li key={chat.id}>
                  <button
                    type="button"
                    onClick={() => void handleOpen(chat)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 ${
                      isSelected
                        ? 'bg-sky-50 dark:bg-sky-500/10'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-sky-500 text-sm font-semibold text-white"
                    >
                      {chat.title.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {chat.title}
                      </span>
                      {chat.lastMessagePreview && (
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                          {chat.lastMessagePreview}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

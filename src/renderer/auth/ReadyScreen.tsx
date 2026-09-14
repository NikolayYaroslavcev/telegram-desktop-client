import { useState } from 'react'
import type { Chat } from '../../shared/models'
import { ChatListScreen } from '../chats/ChatListScreen'
import { MessageScreen } from '../messages/MessageScreen'

/**
 * Post-authorization workspace (Task 12, UI polish pass): a persistent
 * desktop two-pane layout - chat list on the left, selected chat on the
 * right - collapsing to a single visible pane below the `md` breakpoint
 * (`onBack` then means "deselect", not "unmount a full-screen route"). Still
 * just enough state to hold which chat is open, not a real router/navigation
 * stack.
 */
export function ReadyScreen(): React.JSX.Element {
  const [openChat, setOpenChat] = useState<Chat | null>(null)

  return (
    <div className="flex h-full w-full overflow-hidden bg-white dark:bg-slate-950">
      <aside
        className={`w-full flex-col border-r border-slate-200 dark:border-slate-800 md:flex md:w-80 md:flex-none lg:w-96 ${
          openChat ? 'hidden' : 'flex'
        }`}
      >
        <ChatListScreen selectedChatId={openChat?.id ?? null} onOpenChat={setOpenChat} />
      </aside>
      <main className={`min-w-0 flex-1 flex-col ${openChat ? 'flex' : 'hidden md:flex'}`}>
        {openChat ? (
          <MessageScreen key={openChat.id} chat={openChat} onBack={() => setOpenChat(null)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
            <span aria-hidden="true" className="text-4xl">
              💬
            </span>
            <p className="text-sm">Выберите чат, чтобы начать переписку</p>
          </div>
        )}
      </main>
    </div>
  )
}

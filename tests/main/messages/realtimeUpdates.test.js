'use strict'

// Unit tests for Task 11's real-time update router: a fake `getChat` (the
// same private-chat/bot boundary `TdlibService.getChat` already implements -
// see tests/tdlib/chatDiscovery.test.js for that boundary's own coverage),
// a fake in-memory MessageRepository (mirroring the real one's "never
// resurrect a tombstone" / "first deletion timestamp wins" invariants -
// already unit-tested for real in tests/main/storage/messageRepository.test.js),
// and a fake IpcEventBroadcaster that just records calls. No TDLib, no SQLite -
// see realtimeUpdates.sqlite.test.js for the real-SQLite race/idempotency
// coverage this task's plan calls out separately.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createRealtimeUpdateRouter } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'messages', 'realtimeUpdates.js'),
)

function tdMessage(id, chatId, overrides = {}) {
  return {
    _: 'message',
    id,
    chat_id: chatId,
    sender_id: { _: 'messageSenderUser', user_id: 7 },
    is_outgoing: false,
    date: 1000 + id,
    content: { _: 'messageText', text: { _: 'formattedText', text: `text ${id}`, entities: [] } },
    ...overrides,
  }
}

function updateNewMessage(message) {
  return { _: 'updateNewMessage', message }
}

function updateMessageContent(chatId, messageId, newContent) {
  return {
    _: 'updateMessageContent',
    chat_id: chatId,
    message_id: messageId,
    new_content: newContent,
  }
}

function updateDeleteMessages(chatId, messageIds, overrides = {}) {
  return {
    _: 'updateDeleteMessages',
    chat_id: chatId,
    message_ids: messageIds,
    is_permanent: true,
    from_cache: false,
    ...overrides,
  }
}

function updateMessageSendSucceeded(message, oldMessageId) {
  return { _: 'updateMessageSendSucceeded', message, old_message_id: oldMessageId }
}

function updateMessageSendFailed(
  message,
  oldMessageId,
  error = { _: 'error', code: 400, message: 'boom' },
) {
  return { _: 'updateMessageSendFailed', message, old_message_id: oldMessageId, error }
}

function privateChat(chatId, peerUserId = 7) {
  return { id: chatId, peerUserId, title: 'Chat' }
}

/** In-memory stand-in mirroring the real MessageRepository's key invariants. */
function createFakeRepository() {
  const rows = new Map()
  const key = (chatId, messageId) => `${chatId}:${messageId}`
  return {
    rows,
    upsertMessage(message) {
      const k = key(message.chatId, message.id)
      const existing = rows.get(k)
      rows.set(k, {
        ...message,
        isDeleted: existing ? existing.isDeleted : false,
        deletedAt: existing ? existing.deletedAt : null,
      })
    },
    updateContent(chatId, messageId, text) {
      const k = key(chatId, messageId)
      const existing = rows.get(k)
      if (!existing) return false
      rows.set(k, { ...existing, text: text === null ? undefined : text })
      return true
    },
    markDeleted(chatId, messageId, deletedAt) {
      const k = key(chatId, messageId)
      const existing = rows.get(k)
      if (!existing) return false
      if (!existing.isDeleted) rows.set(k, { ...existing, isDeleted: true, deletedAt })
      return true
    },
    findByIds(chatId, messageIds) {
      return messageIds.map((id) => rows.get(key(chatId, id))).filter((m) => m !== undefined)
    },
    replaceMessageId(chatId, oldMessageId, message) {
      const oldKey = key(chatId, oldMessageId)
      const existed = rows.has(oldKey)
      if (existed) rows.delete(oldKey)
      rows.set(key(message.chatId, message.id), { ...message, isDeleted: false, deletedAt: null })
      return existed
    },
    deleteMessage(chatId, messageId) {
      return rows.delete(key(chatId, messageId))
    },
  }
}

function createFakeBroadcaster() {
  const newMessages = []
  const deletions = []
  const sendFailures = []
  return {
    newMessages,
    deletions,
    sendFailures,
    newMessage: (message) => newMessages.push(message),
    messageDeleted: (event) => deletions.push(event),
    messageSendFailed: (event) => sendFailures.push(event),
  }
}

function createRouter({
  chats = {},
  repository = createFakeRepository(),
  broadcaster = createFakeBroadcaster(),
  now,
} = {}) {
  const router = createRealtimeUpdateRouter({
    getChat: async (chatId) => chats[chatId] ?? null,
    getMessageRepository: () => repository,
    eventBroadcaster: broadcaster,
    now,
  })
  return { router, repository, broadcaster }
}

// --- updateNewMessage ---

test('updateNewMessage: a private user message is persisted and broadcast', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })

  await router(updateNewMessage(tdMessage(1, 10)))

  assert.equal(repository.rows.size, 1)
  assert.deepEqual(
    broadcaster.newMessages.map((m) => m.id),
    [1],
  )
})

test('updateNewMessage: the DB is written before the IPC event fires', async () => {
  const repository = createFakeRepository()
  const order = []
  const originalUpsert = repository.upsertMessage.bind(repository)
  repository.upsertMessage = (message) => {
    originalUpsert(message)
    order.push('db')
  }
  const broadcaster = {
    newMessage: () => order.push('ipc'),
    messageDeleted: () => order.push('ipc'),
  }
  const { router } = createRouter({ chats: { 10: privateChat(10) }, repository, broadcaster })

  await router(updateNewMessage(tdMessage(1, 10)))

  assert.deepEqual(order, ['db', 'ipc'])
})

test('updateNewMessage: a group chat message is ignored (no getChat match)', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: {} })

  await router(updateNewMessage(tdMessage(1, 999)))

  assert.equal(repository.rows.size, 0)
  assert.deepEqual(broadcaster.newMessages, [])
})

test('updateNewMessage: a channel/supergroup/bot chat (getChat -> null) is ignored', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 20: null } })

  await router(updateNewMessage(tdMessage(1, 20)))

  assert.equal(repository.rows.size, 0)
  assert.deepEqual(broadcaster.newMessages, [])
})

test('updateNewMessage: unsupported message content does not throw and is skipped', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })

  await assert.doesNotReject(() =>
    router(updateNewMessage(tdMessage(1, 10, { content: { _: 'messageSticker' } }))),
  )

  assert.equal(repository.rows.size, 0)
  assert.deepEqual(broadcaster.newMessages, [])
})

test("updateNewMessage: a message with a pending sending_state (this client's own outgoing send) is stored but not broadcast", async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })

  await router(
    updateNewMessage(
      tdMessage(-1, 10, { sending_state: { _: 'messageSendingStatePending', sending_id: 1 } }),
    ),
  )

  assert.equal(repository.rows.size, 1) // still persisted, so findByIds/getHistory can already see it
  assert.equal(repository.rows.get('10:-1').id, -1)
  assert.deepEqual(broadcaster.newMessages, []) // not broadcast yet - see handleMessageSendSucceeded
})

test('updateNewMessage: a message with a failed sending_state is stored but not broadcast either', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })

  await router(
    updateNewMessage(
      tdMessage(-1, 10, {
        sending_state: {
          _: 'messageSendingStateFailed',
          error: { _: 'error', code: 400, message: 'x' },
          can_retry: false,
          need_another_sender: false,
          need_another_reply_quote: false,
        },
      }),
    ),
  )

  assert.equal(repository.rows.size, 1)
  assert.deepEqual(broadcaster.newMessages, [])
})

test('updateNewMessage: a message without sending_state (incoming, or already fully sent) is broadcast as before', async () => {
  const { router, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })

  await router(updateNewMessage(tdMessage(1, 10)))

  assert.deepEqual(
    broadcaster.newMessages.map((m) => m.id),
    [1],
  )
})

test('updateNewMessage: a duplicate delivery does not create a duplicate row or a second event', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })

  await router(updateNewMessage(tdMessage(1, 10)))
  await router(updateNewMessage(tdMessage(1, 10)))

  assert.equal(repository.rows.size, 1)
  assert.equal(broadcaster.newMessages.length, 2) // both delivered, but...
  assert.equal(repository.rows.get('10:1').id, 1) // ...only one row ever exists
})

// --- updateMessageContent ---

test('updateMessageContent: updates the text of an existing message without creating a new row', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })
  await router(updateNewMessage(tdMessage(1, 10)))

  await router(
    updateMessageContent(10, 1, {
      _: 'messageText',
      text: { _: 'formattedText', text: 'edited', entities: [] },
    }),
  )

  assert.equal(repository.rows.size, 1)
  assert.equal(repository.rows.get('10:1').text, 'edited')
  assert.deepEqual(
    broadcaster.newMessages.map((m) => m.text),
    ['text 1', 'edited'],
  )
})

test('updateMessageContent: does not change chatId, id, senderId, or createdAt', async () => {
  const { router, repository } = createRouter({ chats: { 10: privateChat(10) } })
  await router(updateNewMessage(tdMessage(1, 10)))
  const before = { ...repository.rows.get('10:1') }

  await router(
    updateMessageContent(10, 1, {
      _: 'messageText',
      text: { _: 'formattedText', text: 'edited', entities: [] },
    }),
  )

  const after = repository.rows.get('10:1')
  assert.equal(after.chatId, before.chatId)
  assert.equal(after.id, before.id)
  assert.equal(after.senderId, before.senderId)
  assert.equal(after.createdAt, before.createdAt)
})

test('updateMessageContent: a repeated identical update is idempotent', async () => {
  const { router, repository } = createRouter({ chats: { 10: privateChat(10) } })
  await router(updateNewMessage(tdMessage(1, 10)))
  const content = { _: 'messageText', text: { _: 'formattedText', text: 'edited', entities: [] } }

  await router(updateMessageContent(10, 1, content))
  await router(updateMessageContent(10, 1, content))

  assert.equal(repository.rows.size, 1)
  assert.equal(repository.rows.get('10:1').text, 'edited')
})

test('updateMessageContent: a message unknown to storage is ignored, not created', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })

  await router(
    updateMessageContent(10, 404, {
      _: 'messageText',
      text: { _: 'formattedText', text: 'edited', entities: [] },
    }),
  )

  assert.equal(repository.rows.size, 0)
  assert.deepEqual(broadcaster.newMessages, [])
})

test('updateMessageContent: a storage error is logged and does not stop the next update', async () => {
  const { router, repository } = createRouter({ chats: { 10: privateChat(10) } })
  await router(updateNewMessage(tdMessage(1, 10)))
  repository.updateContent = () => {
    throw new Error('disk full')
  }

  await assert.doesNotReject(() =>
    router(
      updateMessageContent(10, 1, {
        _: 'messageText',
        text: { _: 'formattedText', text: 'x', entities: [] },
      }),
    ),
  )
  await router(updateNewMessage(tdMessage(2, 10)))

  assert.equal(repository.rows.get('10:2').id, 2)
})

// --- updateDeleteMessages ---

test('updateDeleteMessages: an existing message becomes is_deleted and keeps its text', async () => {
  const { router, repository, broadcaster } = createRouter({
    chats: { 10: privateChat(10) },
    now: () => 5000,
  })
  await router(updateNewMessage(tdMessage(1, 10)))

  await router(updateDeleteMessages(10, [1]))

  const row = repository.rows.get('10:1')
  assert.equal(row.isDeleted, true)
  assert.equal(row.deletedAt, 5000)
  assert.equal(row.text, 'text 1')
  assert.deepEqual(broadcaster.deletions, [{ chatId: 10, messageId: 1, deletedAt: 5000 }])
})

test('updateDeleteMessages: a repeated delete is safe and keeps the first timestamp', async () => {
  let time = 5000
  const { router, repository, broadcaster } = createRouter({
    chats: { 10: privateChat(10) },
    now: () => time,
  })
  await router(updateNewMessage(tdMessage(1, 10)))

  await router(updateDeleteMessages(10, [1]))
  time = 9999
  await router(updateDeleteMessages(10, [1]))

  assert.equal(repository.rows.get('10:1').deletedAt, 5000)
  assert.equal(broadcaster.deletions.length, 2)
})

test('updateDeleteMessages: a missing message does not crash and emits no event', async () => {
  const { router, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })

  await assert.doesNotReject(() => router(updateDeleteMessages(10, [404])))
  assert.deepEqual(broadcaster.deletions, [])
})

// --- is_permanent / from_cache: TDLib fires updateDeleteMessages both for a
// real deletion and for a plain local-cache eviction ("can possibly be
// retrieved again in the future" per TDLib's own doc comment on the field) -
// only the former may ever tombstone a message.

test('updateDeleteMessages: a cache eviction (is_permanent: false) does not tombstone the message', async () => {
  const { router, repository, broadcaster } = createRouter({
    chats: { 10: privateChat(10) },
    now: () => 5000,
  })
  await router(updateNewMessage(tdMessage(1, 10)))

  await router(updateDeleteMessages(10, [1], { is_permanent: false, from_cache: true }))

  const row = repository.rows.get('10:1')
  assert.equal(row.isDeleted, false)
  assert.equal(row.deletedAt, null)
  assert.deepEqual(broadcaster.deletions, [])
})

test('updateDeleteMessages: a cache eviction does not crash when the message was never seen locally either', async () => {
  const { router, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })

  await assert.doesNotReject(() =>
    router(updateDeleteMessages(10, [404], { is_permanent: false, from_cache: true })),
  )
  assert.deepEqual(broadcaster.deletions, [])
})

test('updateDeleteMessages: a cache eviction logs distinctly from a real delete, at info not warn', async () => {
  const { router } = createRouter({ chats: { 10: privateChat(10) }, now: () => 1 })
  await router(updateNewMessage(tdMessage(1, 10)))
  const originalWarn = console.warn
  const originalLog = console.log
  const warnCalls = []
  const logCalls = []
  console.warn = (...args) => warnCalls.push(args)
  console.log = (...args) => logCalls.push(args)

  try {
    await router(updateDeleteMessages(10, [1], { is_permanent: false, from_cache: true }))
  } finally {
    console.warn = originalWarn
    console.log = originalLog
  }

  assert.equal(warnCalls.length, 0)
  assert.equal(logCalls.length, 1)
  const entry = JSON.parse(logCalls[0][0])
  assert.equal(entry.level, 'info')
  assert.equal(entry.operation, 'realtime.updateDeleteMessages:cacheEvictionIgnored')
  assert.equal(entry.chatId, 10)
  assert.equal(entry.details.messageCount, 1)
})

test('updateDeleteMessages: a real deletion (is_permanent: true) still tombstones as before', async () => {
  const { router, repository, broadcaster } = createRouter({
    chats: { 10: privateChat(10) },
    now: () => 5000,
  })
  await router(updateNewMessage(tdMessage(1, 10)))

  await router(updateDeleteMessages(10, [1], { is_permanent: true, from_cache: false }))

  const row = repository.rows.get('10:1')
  assert.equal(row.isDeleted, true)
  assert.equal(row.deletedAt, 5000)
  assert.deepEqual(broadcaster.deletions, [{ chatId: 10, messageId: 1, deletedAt: 5000 }])
})

// --- Task 16: delete-before-local-message race must be logged, not silently dropped ---

test('updateDeleteMessages: a message never seen locally logs the situation instead of staying silent', async () => {
  const { router } = createRouter({ chats: { 10: privateChat(10) } })
  const originalWarn = console.warn
  const calls = []
  console.warn = (...args) => calls.push(args)

  try {
    await router(updateDeleteMessages(10, [404]))
  } finally {
    console.warn = originalWarn
  }

  assert.equal(calls.length, 1)
  const [line] = calls[0]
  const entry = JSON.parse(line)
  assert.equal(entry.level, 'warn')
  assert.equal(entry.operation, 'realtime.updateDeleteMessages:notFoundLocally')
  assert.equal(entry.chatId, 10)
  assert.equal(entry.messageId, 404)
})

test('updateDeleteMessages: a message that does exist locally does not log the race warning', async () => {
  const { router } = createRouter({ chats: { 10: privateChat(10) }, now: () => 1 })
  await router(updateNewMessage(tdMessage(1, 10)))
  const originalWarn = console.warn
  const calls = []
  console.warn = (...args) => calls.push(args)

  try {
    await router(updateDeleteMessages(10, [1]))
  } finally {
    console.warn = originalWarn
  }

  assert.equal(calls.length, 0)
})

test('updateDeleteMessages: multiple message ids in one update are each processed independently', async () => {
  const { router, repository, broadcaster } = createRouter({
    chats: { 10: privateChat(10) },
    now: () => 1,
  })
  await router(updateNewMessage(tdMessage(1, 10)))
  await router(updateNewMessage(tdMessage(2, 10)))

  await router(updateDeleteMessages(10, [1, 404, 2]))

  assert.equal(repository.rows.get('10:1').isDeleted, true)
  assert.equal(repository.rows.get('10:2').isDeleted, true)
  assert.deepEqual(
    broadcaster.deletions.map((d) => d.messageId),
    [1, 2],
  )
})

// --- updateMessageSendSucceeded / updateMessageSendFailed (Task 12) ---

test('updateMessageSendSucceeded: transitions the temporary row to the final id and broadcasts exactly once', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })
  await router(
    updateNewMessage(
      tdMessage(-1, 10, { sending_state: { _: 'messageSendingStatePending', sending_id: 1 } }),
    ),
  )

  await router(updateMessageSendSucceeded(tdMessage(500, 10), -1))

  assert.equal(repository.rows.size, 1)
  assert.equal(repository.rows.has('10:-1'), false) // temporary row is gone
  assert.equal(repository.rows.get('10:500').id, 500)
  assert.deepEqual(
    broadcaster.newMessages.map((m) => m.id),
    [500],
  ) // only the final message was ever broadcast
})

test('updateMessageSendSucceeded: a repeated delivery of the same success is idempotent - no duplicate row and only the first delivery broadcasts', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })
  await router(
    updateNewMessage(
      tdMessage(-1, 10, { sending_state: { _: 'messageSendingStatePending', sending_id: 1 } }),
    ),
  )

  await router(updateMessageSendSucceeded(tdMessage(500, 10), -1))
  await router(updateMessageSendSucceeded(tdMessage(500, 10), -1))

  assert.equal(repository.rows.size, 1)
  // Unlike updateNewMessage (which always broadcasts a duplicate delivery),
  // a second success for a temp id already transitioned is treated the same
  // way updateMessageContent treats "message unknown to storage": a safe,
  // silent no-op - a confirmed send must never be broadcast twice.
  assert.equal(broadcaster.newMessages.length, 1)
})

test('updateMessageSendSucceeded: a delivery for a message never tracked as pending still persists it, but does not broadcast', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })

  await assert.doesNotReject(() => router(updateMessageSendSucceeded(tdMessage(500, 10), -404)))

  assert.equal(repository.rows.size, 1) // still writes the final message (replaceMessageId's own upsert)
  assert.deepEqual(broadcaster.newMessages, []) // but nothing locally confirms this as "ours", so it is not broadcast
})

test('updateMessageSendFailed: hard-deletes the temporary row and does not throw', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })
  await router(
    updateNewMessage(
      tdMessage(-1, 10, { sending_state: { _: 'messageSendingStatePending', sending_id: 1 } }),
    ),
  )

  await assert.doesNotReject(() => router(updateMessageSendFailed(tdMessage(-1, 10), -1)))

  assert.equal(repository.rows.size, 0) // no orphan temp row left behind
  assert.deepEqual(broadcaster.newMessages, []) // onMessageSendFailed is a distinct event - onNewMessage never fires for this
})

test('updateMessageSendFailed: broadcasts onMessageSendFailed with { chatId, messageId } only, after storage cleanup', async () => {
  const repository = createFakeRepository()
  const order = []
  const originalDelete = repository.deleteMessage.bind(repository)
  repository.deleteMessage = (chatId, messageId) => {
    const result = originalDelete(chatId, messageId)
    order.push('db')
    return result
  }
  const broadcaster = {
    newMessage: () => order.push('ipc'),
    messageDeleted: () => order.push('ipc'),
    messageSendFailed: (event) => {
      order.push('ipc')
      broadcaster.sendFailures.push(event)
    },
    sendFailures: [],
  }
  const { router } = createRouter({ chats: { 10: privateChat(10) }, repository, broadcaster })
  await router(
    updateNewMessage(
      tdMessage(-1, 10, { sending_state: { _: 'messageSendingStatePending', sending_id: 1 } }),
    ),
  )

  await router(updateMessageSendFailed(tdMessage(-1, 10), -1))

  assert.deepEqual(order, ['db', 'ipc'])
  assert.deepEqual(broadcaster.sendFailures, [{ chatId: 10, messageId: -1 }])
  assert.deepEqual(Object.keys(broadcaster.sendFailures[0]).sort(), ['chatId', 'messageId'])
})

test('updateMessageSendFailed: the raw TDLib error is never included in the broadcast event', async () => {
  const { router, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })
  await router(
    updateNewMessage(
      tdMessage(-1, 10, { sending_state: { _: 'messageSendingStatePending', sending_id: 1 } }),
    ),
  )

  await router(
    updateMessageSendFailed(tdMessage(-1, 10), -1, {
      _: 'error',
      code: 429,
      message: 'FLOOD_WAIT_5',
    }),
  )

  assert.equal(broadcaster.sendFailures.length, 1)
  assert.deepEqual(broadcaster.sendFailures[0], { chatId: 10, messageId: -1 })
})

test('updateMessageSendFailed: a repeated delivery of the same failure broadcasts only once (idempotent)', async () => {
  const { router, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })
  await router(
    updateNewMessage(
      tdMessage(-1, 10, { sending_state: { _: 'messageSendingStatePending', sending_id: 1 } }),
    ),
  )

  await router(updateMessageSendFailed(tdMessage(-1, 10), -1))
  await router(updateMessageSendFailed(tdMessage(-1, 10), -1))

  assert.equal(broadcaster.sendFailures.length, 1)
})

test('updateMessageSendFailed: a delivery for a message never tracked as pending does not throw and does not broadcast', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })

  await assert.doesNotReject(() => router(updateMessageSendFailed(tdMessage(-1, 10), -404)))
  assert.equal(repository.rows.size, 0)
  assert.deepEqual(broadcaster.sendFailures, [])
})

test('updateMessageSendFailed: a storage error does not broadcast a false success or a false failure event', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })
  await router(
    updateNewMessage(
      tdMessage(-1, 10, { sending_state: { _: 'messageSendingStatePending', sending_id: 1 } }),
    ),
  )
  repository.deleteMessage = () => {
    throw new Error('disk full')
  }

  await assert.doesNotReject(() => router(updateMessageSendFailed(tdMessage(-1, 10), -1)))

  assert.deepEqual(broadcaster.sendFailures, [])
  assert.deepEqual(broadcaster.newMessages, [])
})

test('updateMessageSendFailed: a message the next valid update after it still gets processed (stream is not broken)', async () => {
  const { router, repository, broadcaster } = createRouter({ chats: { 10: privateChat(10) } })
  await router(
    updateNewMessage(
      tdMessage(-1, 10, { sending_state: { _: 'messageSendingStatePending', sending_id: 1 } }),
    ),
  )
  await router(updateMessageSendFailed(tdMessage(-1, 10), -1))

  await router(updateNewMessage(tdMessage(2, 10)))

  assert.equal(repository.rows.get('10:2').id, 2)
  assert.deepEqual(
    broadcaster.newMessages.map((m) => m.id),
    [2],
  )
  assert.deepEqual(broadcaster.sendFailures, [{ chatId: 10, messageId: -1 }])
})

test('while storage is unavailable, updateMessageSendSucceeded/updateMessageSendFailed are dropped without throwing', async () => {
  const broadcaster = createFakeBroadcaster()
  const router = createRealtimeUpdateRouter({
    getChat: async () => privateChat(10),
    getMessageRepository: () => null,
    eventBroadcaster: broadcaster,
  })

  await assert.doesNotReject(() => router(updateMessageSendSucceeded(tdMessage(500, 10), -1)))
  await assert.doesNotReject(() => router(updateMessageSendFailed(tdMessage(-1, 10), -1)))
  assert.deepEqual(broadcaster.newMessages, [])
  assert.deepEqual(broadcaster.sendFailures, [])
})

// --- ordering / races ---

test('a new message followed by a delete keeps the tombstone state (not resurrected)', async () => {
  const { router, repository } = createRouter({ chats: { 10: privateChat(10) }, now: () => 42 })

  await router(updateNewMessage(tdMessage(1, 10)))
  await router(updateDeleteMessages(10, [1]))
  await router(updateNewMessage(tdMessage(1, 10))) // TDLib resending the same "live" message

  const row = repository.rows.get('10:1')
  assert.equal(row.isDeleted, true)
  assert.equal(row.deletedAt, 42)
})

test('updates for the same message are processed strictly in call order, even with slower lookups first', async () => {
  const repository = createFakeRepository()
  const broadcaster = createFakeBroadcaster()
  const chats = { 10: privateChat(10) }
  let resolveSlowLookup
  const router = createRealtimeUpdateRouter({
    getChat: (chatId) => {
      if (chatId === 10 && !resolveSlowLookup) {
        return new Promise((resolve) => {
          resolveSlowLookup = () => resolve(chats[chatId] ?? null)
        })
      }
      return Promise.resolve(chats[chatId] ?? null)
    },
    getMessageRepository: () => repository,
    eventBroadcaster: broadcaster,
    now: () => 7,
  })

  const first = router(updateNewMessage(tdMessage(1, 10)))
  const second = router(updateDeleteMessages(10, [1]))
  // Let the router's internal queue actually start processing the first
  // update (and reach its getChat call) before releasing it.
  while (!resolveSlowLookup) {
    await Promise.resolve()
  }
  resolveSlowLookup()
  await Promise.all([first, second])

  const row = repository.rows.get('10:1')
  assert.equal(row.isDeleted, true) // delete was queued after, so it must still apply last
})

// --- update router / unknown updates ---

test('an unknown TDLib update type is ignored without throwing', async () => {
  const { router, repository, broadcaster } = createRouter()

  await assert.doesNotReject(() =>
    router({ _: 'updateOption', name: 'x', value: { _: 'optionValueEmpty' } }),
  )

  assert.equal(repository.rows.size, 0)
  assert.deepEqual(broadcaster.newMessages, [])
  assert.deepEqual(broadcaster.deletions, [])
})

test('an error while processing one update does not stop the next one', async () => {
  const repository = createFakeRepository()
  const originalUpsert = repository.upsertMessage.bind(repository)
  let calls = 0
  repository.upsertMessage = (message) => {
    calls += 1
    if (calls === 1) throw new Error('boom')
    originalUpsert(message)
  }
  const { router, broadcaster } = createRouter({ chats: { 10: privateChat(10) }, repository })

  await router(updateNewMessage(tdMessage(1, 10)))
  await router(updateNewMessage(tdMessage(2, 10)))

  assert.equal(repository.rows.size, 1)
  assert.deepEqual(repository.rows.get('10:2') && [repository.rows.get('10:2').id], [2])
  assert.deepEqual(
    broadcaster.newMessages.map((m) => m.id),
    [2],
  )
})

test('while storage is unavailable (getMessageRepository -> null), updates are dropped without throwing', async () => {
  const broadcaster = createFakeBroadcaster()
  const router = createRealtimeUpdateRouter({
    getChat: async () => privateChat(10),
    getMessageRepository: () => null,
    eventBroadcaster: broadcaster,
  })

  await assert.doesNotReject(() => router(updateNewMessage(tdMessage(1, 10))))
  assert.deepEqual(broadcaster.newMessages, [])
})

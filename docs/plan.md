# Telegram Desktop Client (Electron / TypeScript / React / TDLib) — Execution Plan

Этот план предназначен для последовательной разработки с помощью Claude Code (или другого AI-агента) с сохранением контроля над scope и качеством. Каждый раздел — это отдельная задача/итерация с чёткими критериями готовности.

---

## 00. Scope & Assumptions

**Goal:** Зафиксировать границы проекта, чтобы агент не расширял scope самостоятельно.

**Context:** Заказчик явно исключил: группы, каналы, ботов, поиск, markdown, hotkeys. Явно не подтверждён статус "доставлено/прочитано", аватары, unread-бейджи и т.д. — их в scope НЕ включаем, пока не подтверждено отдельно.

**In scope:**
- Личные диалоги (1-on-1) с обычными пользователями (не ботами).
- Авторизация по телефону + OTP + 2FA.
- Отправка/получение текста, replies, вложений.
- Tombstones (только текст) для удалённых сообщений.
- Конфигурация api_id/api_hash через .env/config.

**Out of scope (явно):**
- Группы, каналы, боты.
- Поиск, markdown-рендеринг, хоткеи.
- Статусы доставки/прочтения, аватары, "печатает...", unread-счётчики — если не подтверждено заказчиком.
- Сохранение медиа удалённых сообщений.
- Восстановление tombstone для сообщений, удалённых до первого запуска приложения или до того, как оно успело их закэшировать.

**Acceptance criteria:** Список in/out scope зафиксирован в README и не меняется без явного запроса.

**Version pinning:** Минимальные/целевые версии Node.js, Electron и TypeScript фиксируются в `docs/tdlib-decision.md` сразу после завершения TDLib spike (п.01) и больше не меняются в течение разработки без отдельного обоснования — версия TDLib-биндинга напрямую зависит от ABI конкретной версии Electron/Node.

---

## 01. TDLib Technical Spike

**Goal:** Убрать неопределённость с TDLib-биндингом до начала архитектурной работы.

**Constraints:** Решение фиксируется один раз и не меняется в середине разработки без веской причины (задокументированной). Не писать собственный FFI-биндинг, если существующий пакет закрывает потребность.

**Deliverable:** `docs/tdlib-decision.md` — какой пакет выбран, почему, какие версии Node/Electron/TypeScript проверены и зафиксированы.

Раздел разбит на маленькие подзадачи — так проще давать их агенту по одной и откатывать при неудаче:

### 01.1 Проверить bindings
Сравнить актуальные варианты: `tdl` + `tdl-tdlib-addon` (или `prebuilt-tdlib`), `node-tdjson` (прямой FFI/N-API к libtdjson). Зафиксировать один вариант.
**AC:** выбор задокументирован в `docs/tdlib-decision.md` с кратким обоснованием.

### 01.2 Создать минимальный TDLib client
Standalone-скрипт (вне Electron), инициализирующий клиент с `api_id`/`api_hash` из `.env`.
**AC:** скрипт запускается и получает первый `authorizationState`.

### 01.3 Проверить authorization
Пройти полный цикл: `waitPhoneNumber → waitCode → waitPassword (если есть) → ready` на реальном тестовом номере.
**AC:** авторизация проходит без ручного вмешательства в код между шагами.

### 01.4 Проверить получение сообщения
Отправить сообщение с другого аккаунта, получить `updateNewMessage` в скрипте.
**AC:** текст сообщения корректно приходит в standalone-скрипте.

### 01.5 Проверить delete update
Удалить отправленное сообщение с любой стороны, получить `updateDeleteMessages`.
**AC:** зафиксировано, какие поля реально приходят в этом update (важно для п.16 — обычно только id, без содержимого).

### 01.6 Проверить packaged Electron на чистой машине
Обернуть standalone-скрипт в минимальное Electron-приложение, собрать через `electron-builder`, установить и запустить на машине без dev-окружения (или в чистой VM/контейнере, где нет `node_modules`, Node.js для разработки, установленных сборочных тулчейнов).
**Важно:** нативный модуль может отрабатывать в dev-режиме, но ломаться после `asar`-упаковки или из-за отсутствия нужных runtime-библиотек на целевой машине — это проверяется только на "чистом" окружении, не на машине разработчика.
**AC:** packaged-сборка логинится и получает/удаляет сообщения на чистой машине так же, как dev-версия.

### 01.7 Зафиксировать решение
Финализировать `docs/tdlib-decision.md`: выбранный пакет, версии Node/Electron/TypeScript, ограничения (например, несовместимость с `sandbox: true`, если такая обнаружится в п.03).
**AC:** документ содержит достаточно информации, чтобы другой разработчик повторил спайк без повторного исследования.

---

## 02. Project Foundation

**Goal:** Базовый скелет проекта.

**Implementation:**
- Electron + Vite (рекомендуется вместо Webpack за скорость) + TypeScript + React.
- Разделение на `src/main` (Electron main), `src/preload`, `src/renderer` (React).
- Настроить strict TypeScript (`strict: true`).
- ESLint + Prettier.
- `package.json` со скриптами: `dev`, `build`, `package` (electron-builder), `test`.

**Files/modules:** `src/main/`, `src/preload/`, `src/renderer/`, `electron-builder.yml`, `tsconfig*.json`.

**Acceptance criteria:** `npm run dev` открывает пустое Electron-окно с React внутри; `npm run build` собирает без ошибок.

---

## 03. Electron Security Baseline

**Goal:** Базовая security-модель до того, как появится реальная логика.

**Implementation:**
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (если совместимо с TDLib-биндингом — проверить в спайке п.01).
- Весь доступ renderer к main — только через `contextBridge` с явным, ограниченным API (whitelist методов, никакого `require`/`ipcRenderer` напрямую в renderer).
- `.env` в `.gitignore`, `.env.example` без секретов.
- Telegram session/database (папка TDLib) — не в репозитории, добавить в `.gitignore`.
- CSP-заголовок для renderer.

**Files/modules:** `src/preload/index.ts` (единственная точка контакта), `.gitignore`, `.env.example`.

**Acceptance criteria:** В renderer нет доступа к Node API напрямую; секреты не попадают в git (проверить `git status` после первого коммита).

---

## 04. TDLib Integration Layer

**Goal:** Инкапсулировать TDLib полностью в main process.

**Implementation:**
- Модуль `src/main/tdlib/client.ts` — инициализация клиента, чтение `api_id`/`api_hash`/`database_directory` из конфига/.env.
- Обёртка над `send()`/`on(update)` TDLib с типизацией через собственные интерфейсы (не тащить `td_api` типы напрямую наружу модуля).
- Единая точка логирования всех исходящих запросов и входящих updates (без секретов).

**Constraints:** Renderer никогда не должен видеть сырые TDLib-объекты — только через domain-модели (см. п.05) и IPC contract (см. п.06).

**Files/modules:** `src/main/tdlib/client.ts`, `src/main/tdlib/config.ts`.

**Acceptance criteria:** Клиент TDLib успешно инициализируется, логирует переходы `authorizationState`.

---

## 05. Domain Models

**Goal:** Не тащить сырые TDLib-объекты в UI.

**Implementation:** Определить модели и мапперы `TDLib object → Domain model`:

```
Chat { id, peerUserId, title, lastMessagePreview }
Message { id, chatId, senderId, text, createdAt, replyToMessageId, isOutgoing, isDeleted, deletedAt }
User { id, firstName, lastName, isBot }
Attachment { type, fileId, localPath?, fileName, size }
AuthorizationState { status: 'waitPhoneNumber' | 'waitCode' | 'waitPassword' | 'ready' | 'closed' | ... }
```

**Files/modules:** `src/shared/models/*.ts` (используется и main, и renderer — только типы, без логики TDLib), `src/main/tdlib/mappers/*.ts`.

**Acceptance criteria:** Ни один файл в `src/renderer` не импортирует типы из `tdlib`/`tdl` напрямую.

---

## 06. IPC Contract

**Goal:** Чёткий, зафиксированный API между main и renderer.

**Implementation:** Определить и захардкодить в `preload` ровно такой набор методов:

```ts
auth.getState(): Promise<AuthorizationState>
auth.setPhoneNumber(phone: string): Promise<void>
auth.checkCode(code: string): Promise<void>
auth.checkPassword(password: string): Promise<void>

chats.list(): Promise<Chat[]>
chats.open(chatId: number): Promise<void>

messages.getHistory(chatId: number, fromMessageId?: number): Promise<Message[]>
messages.sendText(chatId: number, text: string, replyToMessageId?: number): Promise<void>
messages.sendAttachment(chatId: number, filePath: string, replyToMessageId?: number): Promise<void>

events.onAuthStateChanged(cb): Unsubscribe
events.onNewMessage(cb): Unsubscribe
events.onMessageDeleted(cb): Unsubscribe
events.onNetworkStateChanged(cb): Unsubscribe
```

**Constraints:** Renderer не должен "знать", что за этим стоит TDLib — только эти методы и события.

**Acceptance criteria:** Типы IPC-контракта расшарены между main/preload/renderer через `src/shared`, без дублирования интерфейсов.

---

## 07. Authorization Flow

**Goal:** Полный флоу авторизации через UI.

**Implementation:**
- React-экраны: ввод номера → ввод OTP → ввод 2FA-пароля (условно, если требуется) → готово.
- Обработка ошибок TDLib: неверный код, неверный пароль, flood wait (`error.code === 429` / `PHONE_CODE_INVALID` и т.п.) — отображать пользователю понятную ошибку и разрешать retry.
- Хранение состояния авторизации через `auth.getState()` + событие `onAuthStateChanged`.

**Constraints:** Пароли/коды никогда не логировать (см. п.18).

**Acceptance criteria:** Полный цикл логина проходит на реальном тестовом номере, включая неверный код с последующим успешным retry.

---

## 08. Local Storage Layer

**Goal:** Собственное хранилище для кэша сообщений и tombstone-логики (независимое от внутреннего кэша TDLib).

**Implementation:**
- SQLite (`better-sqlite3`), файл БД вне репозитория (в userData directory Electron).
- Таблица `messages`: `id, chat_id, sender_id, text, created_at, reply_to_message_id, is_outgoing, is_deleted, deleted_at`.
- `UNIQUE(chat_id, message_id)` — обязательный constraint для идемпотентности.
- Repository-слой (`MessageRepository`) с методами `upsertMessage`, `markDeleted`, `getHistory`, `findByIds`.

**Files/modules:** `src/main/storage/db.ts`, `src/main/storage/messageRepository.ts`, `src/main/storage/migrations/`.

**Acceptance criteria:** Повторный upsert одного и того же сообщения не создаёт дубликат и не падает.

---

## 09. Private Chat Discovery

**Goal:** Только личные диалоги, без групп/каналов/ботов.

**Implementation:**
- Фильтрация чатов TDLib по `chat.type._ === 'chatTypePrivate'`.
- Дополнительно вызывать `getUser` для проверки `user.type._ !== 'userTypeBot'` — исключать ботов из списка.

**Acceptance criteria:** В списке чатов не появляются группы, каналы, боты — проверено вручную на аккаунте с разными типами чатов.

---

## 10. Message History

**Goal:** Загрузка истории сообщений с пагинацией.

**Implementation:**
- `getChatHistory` с пагинацией по `from_message_id`.
- При получении каждого сообщения — сразу `upsertMessage` в локальную БД (важно: до какой-либо возможной обработки удаления).

**Acceptance criteria:** История подгружается порциями при скролле вверх, без дублей и пропусков.

---

## 11. Real-time Updates

**Goal:** Обработка `updateNewMessage`, `updateMessageContent`, `updateDeleteMessages` в реальном времени.

**Implementation:**
- Единый update-роутер в main, который апдейтит локальную БД и пробрасывает событие в renderer через IPC.
- Идемпотентная обработка (см. п.08 — UNIQUE constraint + upsert, а не insert).

**Acceptance criteria:** Дублирующийся update (искусственно повторно отправленный) не создаёт некорректное состояние.

---

## 12. Text Messages (Send/Receive)

**Goal:** Базовая отправка/приём текста.

**Implementation:** `sendMessage` с `inputMessageText`; обработка `updateMessageSendSucceeded`/`updateMessageSendFailed` для UI-статуса (отправляется/отправлено/ошибка).

**Acceptance criteria:** Сообщение, отправленное с обеих сторон (наш клиент ↔ Telegram Desktop/второй аккаунт), доставляется корректно в обе стороны.

---

## 13. Replies

**Goal:** Ответы на сообщения.

**Implementation:** `reply_to_message_id` при отправке; отображение цитаты исходного сообщения в UI (используя закэшированный текст из локальной БД, а не повторный запрос к TDLib).

**Acceptance criteria:** Reply на уже удалённое (tombstoned) сообщение всё равно показывает исходный текст цитаты.

---

## 14. Attachments

**Goal:** Отправка/получение вложений (файлы, изображения).

**Open question (уточнить у заказчика до реализации):** исходное ТЗ говорит просто "attachments" без конкретики. Нужно явно уточнить, какие типы вложений ожидаются — только изображения и документы (текущее предположение плана) или также голосовые сообщения, видео, стикеры, GIF и т.д. Это напрямую влияет на объём работы п.14 и должно быть подтверждено до старта, а не додумано агентом.

**Implementation:** `inputMessagePhoto`/`inputMessageDocument` (при подтверждении — расширить на другие `inputMessage*` типы); загрузка файла через `downloadFile`, локальное кэширование пути к файлу.

**Constraints:** Для удалённых сообщений вложения НЕ сохраняются (только текст, per ТЗ) — явно не реализовывать сохранение медиа для tombstones.

**Acceptance criteria:** Фото и документ отправляются и корректно отображаются с обеих сторон.

---

## 15. Message Caching (prerequisite for tombstones)

**Goal:** Гарантировать, что текст любого увиденного сообщения сохранён локально ДО того, как оно может быть удалено.

**Implementation:** Caching происходит синхронно в момент получения сообщения (в п.10 и п.11), а не отложенно. Это отдельный пункт-чеклист, а не отдельный код.

**Acceptance criteria:** Явный тест: получить сообщение → сразу (программно, до следующего update) удалить его на другой стороне → tombstone с текстом появляется корректно.

---

## 16. Tombstones

**Goal:** Ключевая фича — отображение удалённых сообщений.

**Implementation:**
- Модель: `isDeleted: boolean`, `deletedAt: timestamp | null`. Текст никогда физически не удаляется из БД.
- Обработчик `updateDeleteMessages`: для каждого `message_id` — `markDeleted` в БД (если запись найдена), пробросить событие в renderer.
- UI: сообщение с `isDeleted === true` рендерится с приглушённым стилем + плашкой "Сообщение удалено" + оригинальным текстом.
- **Явное ограничение (constraint, не баг):** если сообщение с данным id отсутствует в локальной БД на момент `updateDeleteMessages` (никогда не было получено/закэшировано) — tombstone не создаётся, попытки ретроактивно получить контент через TDLib НЕ предпринимаются (TDLib этого не позволяет).

**Semantics check (обязательно проверить на реальных аккаунтах, не только предполагать по документации TDLib):** какой именно `updateDeleteMessages` приходит, когда сообщение удаляет собеседник (а не мы сами) — приходит ли он в принципе для приватных чатов в обоих направлениях, одинаково ли ведёт себя TDLib при удалении "только у себя" и "у всех" (Telegram различает эти два режима удаления, но `updateDeleteMessages` может не давать эту информацию напрямую). Результат проверки фиксируется в `docs/tdlib-decision.md` или отдельной заметке — от него зависит, можно ли вообще отличить "удалено у меня" от "удалено у всех", или tombstone должен одинаково срабатывать в обоих случаях.

**Race condition handling:** Если `updateDeleteMessages` приходит раньше, чем сообщение успело сохраниться (маловероятно, но теоретически возможно при параллельной обработке) — delete-событие нужно буферизировать (например, in-memory set удалённых id с TTL) и применять `markDeleted` сразу после `upsertMessage`, если id совпал.

**Acceptance criteria:**
- Удаление с нашей стороны → tombstone виден в нашем клиенте.
- Удаление с другой стороны → tombstone виден в нашем клиенте.
- Restart приложения → tombstone сохраняется (не теряется).
- Сообщение, удалённое до первого запуска клиента — tombstone не появляется (ожидаемое поведение, задокументировано).

---

## 17. Offline / Reconnect / Recovery

**Goal:** Приложение не должно "ломаться" при потере сети или крашах.

**Implementation:**
- Обработка `updateConnectionState` — UI-индикатор состояния сети.
- Автоматический reconnect средствами TDLib (обычно встроен, но нужно проверить и не мешать ему).
- Проверка сценариев: закрытие приложения во время авторизации, закрытие после авторизации, потеря сети и восстановление, повреждение локальной БД (graceful degradation вместо краша).

**Acceptance criteria:** Все сценарии из списка выше проверены вручную и не приводят к потере данных/краху приложения.

---

## 18. Error Handling & Logging

**Goal:** Наблюдаемость для приоритета "надёжность и стабильность".

**Implementation:**
- Структурированные логи уровней INFO/WARN/ERROR (например, через `electron-log`) с ротацией файлов.
- Логировать: инициализацию TDLib, переходы `authorizationState`, получение/удаление сообщений (только id/chatId, не содержимое при необходимости конфиденциальности), сетевые ошибки, TDLib error codes.
- **Никогда не логировать:** OTP-код, 2FA-пароль, `api_hash`, содержимое сообщений в production-логах (опционально — debug-режим с явным флагом).

**Acceptance criteria:** Ревью логов показывает достаточно данных для диагностики проблемы без утечки секретов.

---

## 19. Automated Tests

**Goal:** Минимальный, но осмысленный набор тестов.

**Implementation:**
- **Unit:** TDLib→domain мапперы; `MessageRepository` (upsert/markDeleted/idempotency); tombstone-логика; фильтрация private-чатов (bot exclusion).
- **Integration:** storage + update-обработка (симуляция входящих TDLib updates на тестовой БД).
- Framework: Vitest/Jest.

**Acceptance criteria:** `npm run test` проходит зелёным в CI/локально; покрыты минимум все edge-cases из п.16 (race condition, отсутствие сообщения в кэше).

---

## 20. Manual E2E Testing

**Goal:** Финальная проверка на реальных аккаунтах.

**Implementation:** Тестовый контур с 2 Telegram-аккаунтами (A — наш клиент, B — Telegram Desktop/Mobile). Чек-лист:
- A → B, B → A (текст)
- reply в обе стороны
- attachment в обе стороны
- delete со стороны A, delete со стороны B
- restart приложения — данные и tombstones сохранены
- offline → online (потеря и восстановление сети)

**Acceptance criteria:** Все пункты чек-листа пройдены и задокументированы в `docs/e2e-report.md`. Для каждого сценария фиксируется не только скриншот, но и короткий фактический результат в текстовом виде (что именно произошло, ожидалось ли это) — этот файл затем можно использовать как отчёт при сдаче тестового задания заказчику.

---

## 21. Packaging

**Goal:** Собираемый дистрибутив.

**Implementation:**
- `electron-builder` конфигурация.
- **Целевые ОС:** если заказчик не указал — по умолчанию собрать и проверить под Windows (уточнить у заказчика перед этим пунктом, т.к. TDLib native-модуль требует platform-specific сборки/rebuild под каждую ОС отдельно).
- Проверка, что нативный TDLib-модуль корректно упаковывается (`asarUnpack` для нативных `.node`/`.dll`/`.so` файлов).

**Acceptance criteria:** Установочный файл собирается и приложение запускается на чистой машине без dev-окружения.

---

## 22. README

**Goal:** Другой разработчик должен суметь запустить проект по инструкции.

**Implementation:** README включает: требования (Node версия, ОС), шаги установки, настройка `.env` (со ссылкой на `.env.example`), `npm run dev`/`build`/`package`/`test`, известные ограничения (см. п.00 out of scope, п.16 tombstone-ограничение).

**Acceptance criteria:** Проверено "с нуля" — установка на чистой машине по одному README, без дополнительных вопросов.

---

## 23. Final Requirements Audit

**Goal:** Финальная сверка с исходным ТЗ перед сдачей.

**Checklist:**
- [ ] Авторизация (телефон + OTP + 2FA) работает
- [ ] Отправка/получение текста, replies, attachments — стабильно
- [ ] Tombstones работают (текст сохраняется, индикация удаления есть)
- [ ] Только 1-on-1, без групп/каналов/ботов
- [ ] Нет лишнего функционала (поиск, markdown, hotkeys)
- [ ] `api_id`/`api_hash` настраиваются через .env/config
- [ ] Нет секретов в git-истории
- [ ] Написано с нуля, не форк готового клиента
- [ ] README позволяет запустить проект с нуля
- [ ] Все сценарии из п.17 и п.20 пройдены вручную

**Acceptance criteria:** Все пункты чек-листа отмечены, проект готов к сдаче.

---

## Definition of Done (сводно)

Проект считается готовым, только если:
1. `npm install` проходит без ошибок.
2. `npm run dev` и `npm run build` работают.
3. Полный цикл авторизации проходит на реальном аккаунте.
4. Список личных чатов отображается корректно (без групп/каналов/ботов).
5. Сообщения, replies, attachments отправляются и принимаются стабильно.
6. Tombstones работают согласно п.16, включая сохранение после restart.
7. В git нет секретов и локальных БД/сессий.
8. README достаточен для независимого запуска проекта.
9. Все пункты чек-листа п.23 пройдены.

---

## Формат работы с Claude Code

Разделы (00–23) — это контрольные этапы (checkpoints) для отслеживания прогресса, а не единицы работы, которые нужно скармливать агенту целиком. Крупные или рискованные разделы (TDLib spike, авторизация, tombstones, packaging) стоит дробить на маленькие подзадачи по образцу п.01 (01.1 … 01.7), каждая — с собственным acceptance criterion. Организационные/маленькие пункты (например, README, .gitignore) можно давать агенту целиком, без дальнейшего дробления.

Общее правило: не переходить к следующей подзадаче, пока не выполнен acceptance criterion текущей, и делать ручную проверку/коммит после каждой подзадачи — так проще откатить именно тот шаг, который пошёл не так, не теряя весь прогресс раздела.

**Следующий шаг:** не дорабатывать план дальше, а начать с п.01 TDLib Technical Spike (подзадачи 01.1–01.7) — он даёт ответ на главный риск проекта: насколько предсказуемо TDLib-биндинг собирается и работает в Electron.

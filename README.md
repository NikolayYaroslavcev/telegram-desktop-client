# Telegram Desktop Client

**Русский** · [English](README.en.md)

Самостоятельный десктопный клиент для Telegram на Electron, React и TDLib. Это независимая реализация клиента Telegram. Он **не** является официальным приложением Telegram Desktop и никак не связан с Telegram.

## Возможности

Реализовано и проверено:

- Авторизация по номеру телефона и коду из SMS, включая 2FA (облачный пароль)
- Личные чаты один на один
- Текстовые сообщения (отправка и получение)
- Ответы с цитатой исходного сообщения
- Вложения: изображения и документы/файлы
- Обновления в реальном времени (новые сообщения, удаления, состояние соединения)
- Локальный кэш сообщений (SQLite)
- Надгробия для удалённых сообщений (удалённые сообщения остаются видимыми с исходным текстом и пометкой «удалено»)
- Переподключение и восстановление после потери сети или перезапуска
- Светлая и тёмная тема интерфейса (следует настройке ОС)

## Технологический стек

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [TDLib](https://core.telegram.org/tdlib) через [`tdl`](https://github.com/eilvelia/tdl) и [`prebuilt-tdlib`](https://github.com/eilvelia/tdl/tree/main/packages/prebuilt-tdlib)
- SQLite через [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) (локальный кэш уровня приложения)
- [Vite](https://vite.dev/)
- [electron-builder](https://www.electron.build/)

## Архитектура

```
Renderer (React UI)
   ↓
Preload (contextBridge, whitelisted IPC)
   ↓
Typed IPC contract (src/shared)
   ↓
Main (Electron main process)
   ↓
TDLib / SQLite
```

- Renderer никогда не обращается к TDLib напрямую. Он вызывает только API из белого списка, который preload-скрипт открывает через `contextBridge`.
- TDLib целиком живёт в главном процессе; renderer видит только преобразованные доменные модели, но не сырые объекты TDLib.
- SQLite (`better-sqlite3`) это локальный кэш уровня приложения (сообщения, надгробия), отдельный от собственной базы и файлов TDLib.

Основные каталоги:

| Путь | Содержимое |
|---|---|
| `src/main/` | Главный процесс Electron, интеграция с TDLib, хранилище, IPC-обработчики |
| `src/preload/` | Безопасный мост renderer ↔ main (API `contextBridge`) |
| `src/renderer/` | React UI |
| `src/shared/` | Общие IPC-контракты и доменные модели (main + renderer) |
| `tests/` | Автоматические тесты |

## Требования

- Node.js 22.19.0 (версия, на которой проверялась интеграция проекта с TDLib)
- npm 10.9.3 (поставляется вместе с указанной версией Node.js)
- Windows: текущая конфигурация сборки рассчитана только на Windows (`electron-builder.foundation.json`)
- Аккаунт Telegram и доступ к Telegram для авторизации
- Пара `api_id` / `api_hash` для Telegram API, полученная на [my.telegram.org](https://my.telegram.org/)

## Конфигурация

Учётные данные TDLib читаются из файла `.env` в корне репозитория. Скопируйте `.env.example` и подставьте свои значения:

```
TG_API_ID=your_api_id
TG_API_HASH=your_api_hash
```

- Не коммитьте `.env`. Он уже исключён через `.gitignore`.
- Не публикуйте и не передавайте другим свои `api_id`/`api_hash`; `api_hash` является секретом.
- Никогда не коммитьте настоящую сессию или базу TDLib. Собственная локальная база и файлы TDLib (отдельные от SQLite-кэша приложения) должны оставаться вне репозитория.

## Разработка

```
npm ci
npm run dev
```

Перед запуском приложения нужен `.env` с корректными `TG_API_ID`/`TG_API_HASH` (см. [Конфигурация](#конфигурация)), иначе авторизация не сможет пройти.

## Проверка

```
npm run typecheck   # type-check main, preload, and renderer
npm run lint         # ESLint
npm test             # automated test suite
npm run build        # production build of main, preload, and renderer
npm run build:spike  # builds the standalone TDLib spike scripts under spike/
npm run package       # production Windows package (see below)
```

Сейчас в автоматическом наборе тестов есть один сбой security-harness, зависящий от окружения: он возникает, когда присутствуют существующая авторизованная сессия TDLib и локальный `.env`. На проверку продукта и сборки это не влияет.

## Продакшн-сборка

```
npm run package
```

Команда запускает продакшн-сборку, а затем `electron-builder --config electron-builder.foundation.json --win --dir`.

Текущая конфигурация сборки создаёт распакованный дистрибутив для Windows; установщик не настроен.

## Безопасность

- Включена изоляция контекста, Node integration отключена, renderer работает в песочнице
- Строгая Content-Security-Policy для renderer
- Навигация и создание новых окон ограничены
- Доступ renderer к main ограничен явным API IPC из белого списка, который открыт через `contextBridge`
- Секреты (`.env`, данные сессии TDLib) исключены из репозитория и из собранного приложения

## Данные и приватность

- Все данные протокола Telegram обрабатываются через TDLib, который ведёт собственную локальную базу и файлы.
- Приложение хранит отдельный локальный кэш сообщений в SQLite, он нужен для локальной истории и надгробий.
- Локальные данные времени выполнения (включая базу и файлы TDLib) хранятся в каталоге `userData` Electron, вне репозитория.
- Учётные данные и данные сессии ни при каких условиях не должны попадать в этот репозиторий.

## Структура проекта

```
src/main/       Electron main process, TDLib, storage, IPC handlers
src/preload/    Secure renderer ↔ main bridge
src/renderer/   React UI
src/shared/     Shared IPC contracts and domain models
tests/          Automated tests
```

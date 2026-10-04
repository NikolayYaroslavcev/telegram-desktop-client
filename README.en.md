# Telegram Desktop Client

[Русский](README.md) · **English**

A standalone desktop client for Telegram, built on Electron, React, and TDLib. This is an independent implementation of a Telegram client. It is **not** the official Telegram Desktop application and is not affiliated with Telegram.

## Features

Implemented and verified:

- Phone number + OTP authentication, including 2FA (cloud password)
- Private 1-on-1 chats
- Text messages (send/receive)
- Replies, with quoted preview of the original message
- Image and document/file attachments
- Realtime updates (new messages, deletions, connection state)
- Local message cache (SQLite)
- Tombstones for deleted messages (deleted messages remain visible with their original text and a "deleted" indicator)
- Reconnect/recovery after network loss or restart
- Light/dark UI theme (follows OS preference)

### Scope limitations

This client intentionally supports only a narrow, fixed feature set:

- Private 1-on-1 chats only, no groups, channels, or bots
- No search
- No Markdown rendering
- No hotkeys
- Attachments limited to images and documents/files (no audio, video, stickers, or GIFs)
- No delivery/read receipts, avatars, typing indicators, or unread counters

## Tech Stack

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [TDLib](https://core.telegram.org/tdlib) via [`tdl`](https://github.com/eilvelia/tdl) and [`prebuilt-tdlib`](https://github.com/eilvelia/tdl/tree/main/packages/prebuilt-tdlib)
- SQLite via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) (application-level local cache)
- [Vite](https://vite.dev/)
- [electron-builder](https://www.electron.build/)

## Architecture

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

- The renderer never talks to TDLib directly. It only calls the whitelisted API exposed by the preload script via `contextBridge`.
- TDLib lives entirely in the main process; the renderer only sees mapped domain models, never raw TDLib objects.
- SQLite (`better-sqlite3`) is an application-level local cache (messages, tombstones), separate from TDLib's own database/files.

Key directories:

| Path | Contents |
|---|---|
| `src/main/` | Electron main process, TDLib integration, storage, IPC handlers |
| `src/preload/` | Secure renderer ↔ main bridge (`contextBridge` API) |
| `src/renderer/` | React UI |
| `src/shared/` | Shared IPC contracts and domain models (main + renderer) |
| `tests/` | Automated tests |

## Requirements

- Node.js 22.19.0 (the version this project's TDLib integration was verified against)
- npm 10.9.3 (bundled with the Node.js install above)
- Windows: the current packaging configuration only targets Windows (`electron-builder.foundation.json`)
- A Telegram account and access to Telegram to authenticate
- A Telegram API `api_id` / `api_hash` pair, obtained from [my.telegram.org](https://my.telegram.org/)

## Configuration

TDLib credentials are read from a `.env` file in the repository root. Copy `.env.example` and fill in your own values:

```
TG_API_ID=your_api_id
TG_API_HASH=your_api_hash
```

- Do not commit `.env`. It is already excluded via `.gitignore`.
- Do not publish or share your `api_id`/`api_hash`; the `api_hash` is a secret.
- Never commit a real TDLib session/database. TDLib's own local database and files (separate from the application's SQLite cache) must stay outside the repository.

## Development

```
npm ci
npm run dev
```

A `.env` with valid `TG_API_ID`/`TG_API_HASH` (see [Configuration](#configuration)) is required before running the app, or authentication will not be able to proceed.

## Verification

```
npm run typecheck   # type-check main, preload, and renderer
npm run lint         # ESLint
npm test             # automated test suite
npm run build        # production build of main, preload, and renderer
npm run build:spike  # builds the standalone TDLib spike scripts under spike/
npm run package       # production Windows package (see below)
```

The automated suite currently has one environment-dependent security-harness failure when an existing authenticated TDLib session and local `.env` are present; the product/package verification is unaffected.

## Production Packaging

```
npm run package
```

This runs the production build and then `electron-builder --config electron-builder.foundation.json --win --dir`.

The current packaging configuration produces a Windows unpacked distribution; no installer target is configured.

## Security

- Context isolation enabled, Node integration disabled, renderer sandboxed
- Restrictive Content-Security-Policy on the renderer
- Navigation and new-window creation restricted
- Renderer access to main is limited to an explicit, whitelisted IPC API exposed via `contextBridge`
- Secrets (`.env`, TDLib session data) are excluded from the repository and from the packaged app

## Data & Privacy

- All Telegram protocol data is handled through TDLib, which maintains its own local database and files.
- The application keeps a separate local message cache in SQLite, used for the local history and tombstone features.
- Local runtime data (including TDLib's database/files) is stored under Electron's `userData` directory, outside the repository.
- Credentials and session data must never be committed to this repository.

## Project Structure

```
src/main/       Electron main process, TDLib, storage, IPC handlers
src/preload/    Secure renderer ↔ main bridge
src/renderer/   React UI
src/shared/     Shared IPC contracts and domain models
tests/          Automated tests
```

## Limitations / Scope

**Intentionally out of scope:**
- Groups, channels, and bots
- Search
- Markdown rendering
- Hotkeys
- Attachments other than images and documents/files (no audio, video, stickers, GIFs)

**Not configured:**
- No installer target for Windows packaging (unpacked `--dir` build only)
- No non-Windows packaging target

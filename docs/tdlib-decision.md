# TDLib Integration Decision (Task 01.1)

Status: decided and spiked. Scope: binding choice + minimal proof that TDLib
responds inside both plain Node.js and Electron's main process. No
auth/IPC/UI/persistence/packaging is implemented here (see [docs/plan.md](plan.md), sections 01.2+).

## 1. Decision

Use **[`tdl`](https://github.com/eilvelia/tdl) (npm `tdl`, v8.1.0) together
with [`prebuilt-tdlib`](https://github.com/eilvelia/tdl/tree/main/packages/prebuilt-tdlib)
(npm `prebuilt-tdlib`, v0.1008067.0, i.e. TDLib 1.8.67)**.

- `tdl` provides a thin N-API (node-addon-api) addon that dynamically loads
  (`dlopen`/`LoadLibrary`) a `libtdjson` shared library at runtime and wraps
  it with a Promise/EventEmitter-based JS API.
- `prebuilt-tdlib` ships prebuilt `libtdjson` binaries (as platform-specific
  optional npm packages, e.g. `@prebuilt-tdlib/win32-x64`) so no one on the
  team has to compile TDLib itself.
- No custom FFI/N-API code is written for this project — both packages are
  used as-is, per the "don't write your own binding if an existing one fits"
  constraint.

## 2. Why

- `tdl` is the only actively maintained, widely used Node.js TDLib binding.
  Its GitHub repo (`eilvelia/tdl`) has 536 stars and was last pushed
  **2026-07-23**; npm shows 60 published versions, latest `8.1.0` published
  ~6 months ago. It ships its own N-API addon, so there's no separate native
  package to keep in sync.
- `prebuilt-tdlib` is published from the *same monorepo* by the same
  maintainer, versioned 1:1 against upstream TDLib releases (the npm version
  `0.1008067.0` decodes to TDLib `1.8.67`), and is kept up to date (dist-tags
  show continuous `td-1.8.x` releases through `.42`, with `.67` as latest).
  Using the sibling package from the binding's own author removes a whole
  class of "binding vs TDLib version" mismatch risk.
- The addon is **N-API** (`node-addon-api`, `NAPI_DISABLE_CPP_EXCEPTIONS`),
  not a raw V8/NAN addon. N-API has a stable ABI across Node.js *and*
  Electron releases, which is precisely the property this project needs
  (see section 8, Risks, and section 9, Spike result, for the empirical
  check — this was verified, not assumed).
- `tdl`'s prebuilds are shipped per `platform-arch` (`win32-x64`,
  `linux-x64.glibc`, `linux-x64.musl`, `darwin-arm64`, ...) with **no
  separate "electron" build**, which only makes sense if the addon is
  expected to run unmodified under both runtimes — confirmed empirically in
  section 9.
- Versions can be pinned exactly (`tdl@8.1.0`, `prebuilt-tdlib@0.1008067.0`)
  with no ranges, satisfying the project's version-pinning requirement.

## 3. Alternatives considered

| Option | Maintained? | Native code needed | Electron fit | Verdict |
|---|---|---|---|---|
| **`tdl` + `prebuilt-tdlib`** (chosen) | Yes — `eilvelia/tdl`, last push 2026-07-23, 60 npm releases | None to write; N-API addon + prebuilt `libtdjson`, both prebuilt for common platforms | Confirmed to load and run in Electron's main process without a rebuild step (section 9) | **Selected** |
| `tdl` + `tdl-tdlib-addon` | **No.** npm shows `tdl-tdlib-addon` marked `DEPRECATED!! - Use tdl >= 7.3.0 instead. Works with tdl < 8.0 only`. Last published >1 year ago, 15 versions total | Separate native addon package, now unmaintained | N/A — incompatible with the `tdl` version we need | Rejected: dead end, explicitly superseded by the current architecture of `tdl` itself |
| `node-tdjson` | **Does not exist as a real package.** `npm view node-tdjson` returns a 404; a GitHub search for `tdjson`/`node-tdjson` finds no maintained Node.js FFI binding under that name — only unrelated Python/Rust/Go/iOS projects and `tdl` itself. The plan's own wording ("`node-tdjson` (прямой FFI/N-API к libtdjson)") describes this as *writing a direct FFI binding*, not installing a package | Would require writing and maintaining our own `ffi-napi`/`koffi`-based (or custom N-API) binding against `libtdjson`'s C API | Unverified — would need to be built and hardened from scratch | Rejected: violates the explicit "don't write a custom FFI/N-API binding when an existing one fits" constraint, and `tdl` already fits |
| Custom N-API addon linked directly against TDLib source | Would be maintained by us | Full native module: CMake build of TDLib itself, our own N-API glue, our own prebuild/CI pipeline per OS/arch | Highest long-term control, but highest cost and highest risk of ABI/build breakage | Rejected: massive maintenance burden for no functional benefit over `tdl`; contradicts "stability and reliability" priority |

## 4. Architecture

The plan's original schema holds after this research — no change needed:

```text
React Renderer
      ↓  (contextBridge-exposed IPC API only, per docs/plan.md #03/#06)
Electron IPC
      ↓
Electron Main
      ↓
tdl (N-API addon, dynamically loads libtdjson)
      ↓
libtdjson (from prebuilt-tdlib, platform-specific shared library)
      ↓
Telegram
```

Confirmed by this spike: `tdl` + `prebuilt-tdlib` load and produce real
`authorizationState` updates from directly inside Electron's **main**
process (`process.type === 'browser'`), with the exact same `node_modules`
used for the plain-Node.js run — no `@electron/rebuild` / `node-gyp rebuild`
step was needed. This matches the plan's constraint that TDLib must never
be reachable from the renderer.

## 5. Build requirements

To build/run this spike (and, by extension, the future app) a developer needs:

- **Node.js 22.19.0** (or any Node ≥16.14.0 per `tdl`'s `engines` field —
  22.19.0 is what this spike was verified against).
- **npm 10.9.3** (bundled with the Node install above).
- No C++ compiler / Python / Visual Studio Build Tools / CMake are required
  in the normal case — `tdl` and `prebuilt-tdlib` both ship prebuilt
  binaries for Windows x86_64, Linux x86_64/arm64 (glibc or musl), and macOS
  x86_64/arm64. A toolchain is only needed if `npm install --build-from-source`
  is forced, e.g. on an unsupported platform — not expected for this
  project's target (Windows, per `docs/plan.md` #21).
- `npm install` is sufficient; no postinstall native rebuild step exists for
  either package beyond `node-gyp-build`'s prebuild lookup (which just picks
  the right file from `prebuilds/`, it does not compile anything when a
  match is found).

## 6. Production requirements

For a packaged Electron app (full verification is explicitly deferred to
plan step 01.6, but based on what this spike + Electron's own native-module
docs establish):

- The native addon file (`node_modules/tdl/prebuilds/win32-x64/tdl.node`)
  and the shared library resolved by `prebuilt-tdlib` (e.g.
  `@prebuilt-tdlib/win32-x64/tdjson.dll`) are real files on disk that get
  `dlopen`/`LoadLibrary`-loaded by path at runtime. **They cannot live
  inside an immutable `asar` archive** — `electron-builder`'s `asarUnpack`
  must include both `node_modules/tdl/prebuilds/**` and
  `node_modules/@prebuilt-tdlib/**` (or the resolved platform subpackage).
  This is inferred from how both packages resolve paths (`getTdjson()`
  returns a real filesystem path via `require.resolve`) and from Electron's
  documented `asarUnpack` mechanism — it has **not** been empirically
  verified with an actual `electron-builder` packaged build in this task,
  per the explicit scope limit ("packaging всего приложения" is out of
  scope for 01.1; that check belongs to plan step 01.6).
- Because the addon is N-API, no separate "Electron build" of `tdl` itself
  is required at packaging time — the same prebuilds used in development
  are expected to work in the packaged app. This is the one claim in this
  document that rests on the general N-API ABI-stability guarantee plus the
  in-repo evidence in section 9, rather than on a from-scratch clean-machine
  test; that clean-machine confirmation is explicitly plan step 01.6, not
  this task.
- `contextIsolation: true` / `nodeIntegration: false` / a strict
  `contextBridge` API (plan #03) are unaffected by this choice — TDLib lives
  entirely in the main process either way and the renderer never touches it.
- Electron's `sandbox: true` flag applies to **renderer** processes; it does
  not sandbox the main process (where `tdl` runs), so it should not conflict
  with this binding. This reasoning was not empirically tested against an
  actual sandboxed renderer in this spike (no `BrowserWindow` was created at
  all) and should be re-confirmed once plan step 03 is implemented.

## 7. Version strategy

Pin exact versions, no ranges, as verified in this spike:

| Component | Version | How it's determined |
|---|---|---|
| Node.js | 22.19.0 | Locally installed runtime used for the spike |
| npm | 10.9.3 | Bundled with the Node install above |
| TypeScript | 7.0.2 | Pinned exactly in `package.json` (current `latest` dist-tag) |
| Electron | 44.3.0 | Pinned exactly in `package.json` (current `latest` dist-tag); bundles Node.js `24.20.0` and Chromium `152.0.7977.78` internally (observed via `process.versions` inside the spike, section 9) |
| `tdl` | 8.1.0 | Pinned exactly in `package.json` |
| `prebuilt-tdlib` | 0.1008067.0 | Pinned exactly in `package.json`; this *is* the TDLib version pin — encodes TDLib **1.8.67** (commit `d1085f9cebc5a62379991ae1652673954f229c1f`), confirmed at runtime via `getTdlibInfo()` in the spike output |
| `dotenv` | 17.4.2 | Pinned exactly; only used to read `TG_API_ID`/`TG_API_HASH` from `.env` |

TDLib's own version is controlled entirely by which `prebuilt-tdlib`
version is installed — there is no separate "TDLib version" setting;
bumping TDLib means bumping the `prebuilt-tdlib` dependency (and, per the
plan's own version-pinning rule, doing so deliberately and documented, not
as a side effect of a routine `npm update`).

Note: `tdl`'s type definitions reference a package called `tdlib-types`,
which npm flags as deprecated ("Use the tdl-install-types generator or
prebuilt-tdlib instead"). This project does **not** depend on `tdlib-types`
— `prebuilt-tdlib` already pulls in `@prebuilt-tdlib/types` as an optional
dependency, which is sufficient for `npx tsc --noEmit` to pass cleanly
against this spike's code (verified in section 9).

## 8. Risks

- **Electron ABI / native addon**: Low risk for this specific addon because
  it's N-API-based, and this was verified empirically (section 9) rather
  than assumed. Residual risk: if a future `tdl` release ever stops being
  purely N-API (e.g. adds a feature requiring direct V8 API access), this
  guarantee would need to be re-checked.
- **Rebuild**: Not needed in the case verified here (prebuild available for
  `win32-x64`). If the team ever develops on an architecture/libc
  combination without a published prebuild (e.g. some Linux distro), `npm
  install` would fall back to compiling from source, which *does* need a
  C++14 toolchain and Python, and that build would need to target
  Electron's headers if it's ever built specifically for a packaged app
  (not exercised in this spike — dev machine had a prebuild available).
- **Packaging (`electron-builder`/`asar`)**: Not verified in this task
  (explicitly deferred to plan 01.6). The real risk is forgetting
  `asarUnpack` for the two native files; if omitted, the app will fail at
  runtime in the packaged build while working fine in dev — exactly the
  failure mode plan step 01.6 exists to catch.
- **Windows-specific**: The spike ran and passed on Windows
  (`win32-x64`, this machine). No Linux/macOS verification was performed —
  acceptable per the plan, since the project's stated packaging target is
  Windows (plan #21), but this should be re-confirmed if that target changes.
- **Electron version upgrades**: Because prebuilds aren't tagged by
  "Electron version" (only by OS/arch/libc), routine Electron upgrades are
  expected to keep working without a `tdl` rebuild — but this is the kind
  of assumption that should be spot-checked again after any major Electron
  bump, not treated as permanently proven by one spike.
- **Node.js upgrades**: Same reasoning as above — low risk due to N-API, but
  not proven for every future Node major.
- **TDLib upgrades**: Bumping `prebuilt-tdlib` changes TDLib's actual
  behavior/schema (new `td_api` fields, possibly changed update semantics —
  directly relevant to the tombstone semantics check in plan #16). Any TDLib
  bump must be treated as a deliberate, tested decision, not a passive
  `npm update`.
- **Environment gotcha found during this spike**: this sandboxed dev
  environment has `ELECTRON_RUN_AS_NODE=1` set globally. With that variable
  set, `require('electron')` inside the main process returns a path string
  instead of the `{ app, BrowserWindow, ... }` API object, so
  `app.whenReady` throws `TypeError: Cannot read properties of undefined`.
  This is an Electron-wide behavior, unrelated to `tdl`, but it's a real
  trap for anyone reproducing this spike (or later running the real app) in
  a similar containerized/CI shell — reproduction commands below account
  for it explicitly.

## 9. Spike result

**What was checked:** installed `tdl` + `prebuilt-tdlib` via plain
`npm install`, created a real TDLib client with `tdl.createClient(...)`,
and observed real `updateAuthorizationState` events — first in plain
Node.js, then inside Electron's main process using the exact same installed
addon (no rebuild in between).

**Result — plain Node.js (`node dist/run-node.js`):**

```
[tdlib-spike:node] tdjson path: ...\node_modules\@prebuilt-tdlib\win32-x64\tdjson.dll
[tdlib-spike:node] tdlib info: {"commit":"d1085f9cebc5a62379991ae1652673954f229c1f","version":"1.8.67"}
[tdlib-spike:node] process.versions.node: 22.19.0
[tdlib-spike:node] process.type: n/a (plain node)
[tdlib-spike:node] authorizationState -> authorizationStateWaitTdlibParameters
[tdlib-spike:node] authorizationState -> authorizationStateWaitPhoneNumber
[tdlib-spike:node] authorizationState -> authorizationStateClosing
[tdlib-spike:node] authorizationState -> authorizationStateClosed
```

**Result — Electron main process (`electron .`, `ELECTRON_RUN_AS_NODE`
unset):**

```
[tdlib-spike:electron-main] tdjson path: ...\node_modules\@prebuilt-tdlib\win32-x64\tdjson.dll
[tdlib-spike:electron-main] tdlib info: {"commit":"d1085f9cebc5a62379991ae1652673954f229c1f","version":"1.8.67"}
[tdlib-spike:electron-main] process.versions: node 24.20.0, electron 44.3.0, chrome 152.0.7977.78, v8 15.2.124.19-electron.0
[tdlib-spike:electron-main] process.type: browser   <- confirms this is Electron's main process
[tdlib-spike:electron-main] authorizationState -> authorizationStateWaitTdlibParameters
[tdlib-spike:electron-main] authorizationState -> authorizationStateWaitPhoneNumber
[tdlib-spike:electron-main] authorizationState -> authorizationStateClosing
[tdlib-spike:electron-main] authorizationState -> authorizationStateClosed
```

Both runs reached `authorizationStateWaitTdlibParameters` (the first real
authorization state, per the acceptance criterion) and then
`authorizationStateWaitPhoneNumber` once `tdl` auto-answered
`setTdlibParameters` internally — no manual auth flow was implemented, as
required by scope. Placeholder `apiId`/`apiHash` values were used (no real
Telegram API credentials configured for this task), which is sufficient to
reach these local authorization states; a real phone/OTP/2FA flow is plan
step 01.3, not this task.

**Reproduction:**

```sh
# from the repository root
npm install
npm run build

# 1) plain Node.js run
npm run spike:node

# 2) Electron main-process run
#    (unset ELECTRON_RUN_AS_NODE if your shell/CI sets it globally - see Risks)
env -u ELECTRON_RUN_AS_NODE npm run spike:electron
```

Optionally, create a `.env` (copy `.env.example`) with real `TG_API_ID` /
`TG_API_HASH` from https://my.telegram.org/ before running — not required to
reach `authorizationStateWaitTdlibParameters`/`authorizationStateWaitPhoneNumber`,
but will matter starting with plan step 01.2+.

## Task 01.2 verification

**Real credentials:** provided by the user and loaded from a local `.env`
(not committed, not logged — see below). Before they were available, the
missing-credentials guard was verified independently (see "Verified without
real credentials" below); once `.env` was in place, the real run was
performed as described next.

**Real run result (`npm run spike:standalone`):**

```
[standalone] API credentials loaded: yes
[standalone] TDLib database directory: <TEMP>\telegram-desktop-client-standalone\db
[standalone] TDLib starting...
[standalone] authorizationState -> authorizationStateWaitTdlibParameters
[standalone] authorizationState -> authorizationStateWaitPhoneNumber
[standalone] Reached authorizationStateWaitPhoneNumber - stopping here (task 01.2 scope).
[standalone] authorizationState -> authorizationStateClosing
[standalone] client closed
[standalone] authorizationState -> authorizationStateClosed
```

Real `TG_API_ID`/`TG_API_HASH` were accepted by TDLib and the client reached
`authorizationStateWaitPhoneNumber`, confirming credentials are valid and the
binding works end-to-end with a production Telegram API app registration.

**Repeat-run check:** the script was run a second time (`node
dist/standalone-client.js`) against the same, already-populated database
directory. It reopened the existing `db.sqlite`/`td.binlog` cleanly, produced
the identical state sequence above, and closed with no errors or corruption.

**What changed vs. the 01.1 spike:**

- New minimal script, `spike/standalone-client.ts` (`npm run spike:standalone`),
  replacing the placeholder-fallback behavior of `spike/run-node.ts` with a
  hard failure when credentials are missing.
- TDLib's `databaseDirectory`/`filesDirectory` now resolve outside the
  repository by default (`os.tmpdir()/telegram-desktop-client-standalone/{db,files}`,
  overridable via `TDLIB_DATA_DIR`), instead of the 01.1 spike's
  `_td_spike_db_*` / `_td_spike_files_*` directories, which live inside the
  repo root (gitignored, but not outside it — acceptable for that spike's
  narrower scope, not for this task's explicit "outside repository"
  requirement).
- Explicit `tdlibParameters` are now passed instead of relying on `tdl`'s
  built-in defaults: `use_message_database`, `use_file_database`,
  `use_chat_info_database`, `use_secret_chats: false`, `system_language_code`,
  `device_model`, `system_version` (derived from `os.type()`/`os.release()`),
  `application_version`.
- **Finding:** `enable_storage_optimizer` (requested by the task as a
  parameter to verify) does not exist on TDLib 1.8.67's `setTdlibParameters`
  type (`@prebuilt-tdlib/types`) — it was removed from this call further
  upstream in TDLib and is not applicable to this binding/version. It is
  intentionally omitted rather than added as a dead field.

**Verified without real credentials:** `npx tsc --noEmit` and `npm run build`
both pass cleanly against the new script, and running it with no `.env`
present correctly refuses to start (see above) instead of falling back to a
placeholder.

**Note:** this repository is not currently a git working tree (`git status`
reports "not a git repository"), even though `.gitignore` already excludes
`.env`. The exclusion is correct as configuration, but cannot be verified
against actual `git` tracking until a repository exists.

## Task 01.3 verification

**What was added:** `spike/cli-prompt.ts` (CLI prompt helpers - `askVisible`
for phone/OTP, `askHidden` for the 2FA password, `closePrompts`) and a
rewrite of `spike/standalone-client.ts` to drive the full authorization flow
via `tdl`'s `client.login({ type: 'user', ... })`, with `getPhoneNumber`,
`getAuthCode`, and `getPassword` wired to those prompts. State transitions
are logged by name only (`update.authorization_state._`); phone/OTP/password
values are never logged, saved, or written to this document.

**First run - real result (`npm run spike:standalone`):**

```
[standalone] API credentials loaded: yes
[standalone] TDLib database directory: <TEMP>\telegram-desktop-client-standalone\db
[standalone] TDLib starting...
[standalone] authorizationState -> authorizationStateWaitTdlibParameters
[standalone] authorizationState -> authorizationStateWaitPhoneNumber
(phone number entered)
[standalone] authorizationState -> authorizationStateWaitPassword
Two-factor password: (entered, hidden)
[standalone] authorizationState -> authorizationStateReady
Authorization successful
[standalone] Client is running. Press Ctrl+C to exit.
```

`authorizationStateWaitCode` was reached and handled earlier in the same
overall login attempt (confirmed indirectly: the account has 2FA enabled and
TDLib only offers `authorizationStateWaitPassword` after the OTP code has
already been accepted; by the time debugging of the password step started,
the session had already advanced past `authorizationStateWaitCode`, so the
raw log line for that exact state was not separately captured). Restarts
during debugging that reused the already-populated database correctly
resumed mid-flow, at whichever state TDLib had persisted, per `tdl`'s own
documented behavior ("`authorizationStateWaitPhoneNumber` may not be the
first update in the login flow in case of a previous incomplete login
attempt").

**2FA:** the test account has 2FA enabled. `authorizationStateWaitPassword`
was reached, the password was accepted via `askHidden`, and
`authorizationStateReady` followed immediately after. A deliberately wrong
password was also tested (see below) and correctly triggered TDLib's
`PASSWORD_HASH_INVALID` retry path (`tdl`'s `client.login` re-prompts
automatically) without crashing the process.

**Client shutdown:** confirmed clean via `Ctrl+C` at multiple points during
debugging - `[standalone] SIGINT received, closing TDLib client...` ->
`authorizationStateClosing` -> `client closed` -> `authorizationStateClosed`,
followed by process exit. No hanging process or corrupted database was
observed after any of these shutdowns (checked via `Get-Process`/database
being reusable on the next run).

**Second run - session persistence, real result:**

```
[standalone] API credentials loaded: yes
[standalone] TDLib database directory: <TEMP>\telegram-desktop-client-standalone\db
[standalone] TDLib starting...
[standalone] authorizationState -> authorizationStateWaitTdlibParameters
[standalone] authorizationState -> authorizationStateReady
Authorization successful
[standalone] Client is running. Press Ctrl+C to exit.
```

Same database directory, no `.env` changes, no code changes between the two
runs. `authorizationStateReady` was reached directly, with **no**
`authorizationStateWaitPhoneNumber`/`WaitCode`/`WaitPassword` and no OTP
re-entry - session persistence is confirmed.

**Problems found and how they were resolved:**

- The 2FA password prompt (`askHidden`) went through three implementation
  attempts before landing on the version now in `spike/cli-prompt.ts`:
  1. A manual `stdin.setRawMode`/`'data'`-listener implementation, run after
     two prior `askVisible` calls had already created and `.close()`d their
     own `readline.Interface` on the same `process.stdin`. This left stdin
     not accepting input at all for the password prompt.
  2. A `readline.Interface` with a substitute (non-TTY) `Writable` as
     `output`, to avoid the manual raw-mode toggle - still failed the same
     way, since it still created a third fresh interface after two prior
     ones had been closed.
  3. **Final:** a single `readline.Interface`, created lazily once and
     reused for all three prompts (`askVisible` and `askHidden` both call
     `getRl()`), with `askHidden` masking echo by temporarily overriding the
     interface's internal `_writeToOutput` for the duration of one
     question - the standard technique for masked input with core
     `readline`. `closePrompts()` closes it once, after login settles.
- This final version was verified mechanically via an isolated real ConPTY
  test (`node-pty`, fake non-secret values, realistic per-keystroke timing):
  input accepted, hidden correctly (never appeared in the raw terminal
  output), Enter submitted it, no hangs - including with the real TDLib
  client loaded and actively running in the same process.
- **The actual live symptom, once reproduced end-to-end, turned out not to
  be a functional bug**: hidden input was working correctly the whole time;
  because masked input produces zero visual feedback (no cursor movement, no
  asterisks), it was indistinguishable from "not accepting input" until the
  user typed the password blindly and pressed Enter anyway, which succeeded
  immediately (`authorizationStateReady`). Confirmed via two diagnostics
  first: `Ctrl+C` at the password prompt correctly triggered
  `[standalone] SIGINT received...` (proving keyboard input reached the
  process), and a plain `node -e "...readline..."` one-liner outside the
  project confirmed basic `readline` input worked on the machine in general.
- One small regression was caught and fixed along the way: the SIGINT ->
  shutdown forwarding was dropped from `askHidden` during the interface
  refactor (step 3 above) and had to be re-added, registered once on the
  shared interface rather than per-question.
- No TDLib-side or environment-side bug was ultimately identified; the
  fixes in `spike/cli-prompt.ts` (shared interface, no manual raw-mode
  toggling) are kept because they are more correct and robust than the
  first two attempts, even though the originally reported symptom turned
  out to be a UX/perception issue rather than a functional one.

## Task 01.4 verification

**What was added:** an `updateNewMessage` branch in `spike/standalone-client.ts`'s
existing `client.on('update', ...)` handler (no new file - the existing
standalone client already owned the update stream from task 01.3). For each
`updateNewMessage`, it logs `message.chat_id`, `message.id`, `message.date`,
`message.is_outgoing`, `message.content._` (the content type discriminant),
and, only when `message.content._ === 'messageText'`, `message.content.text.text`
(the plain string - `messageText.text` is itself a `formattedText { text,
entities }`, not a bare string, per `@prebuilt-tdlib/types`). No other
content type's payload is read or logged.

**Real run result:** the standalone client was started against the same
already-authorized session from task 01.3 (`npm run spike:standalone`,
resumed straight to `authorizationStateReady`, no phone/OTP re-entry) and
left running while a second, real Telegram account sent messages to it in a
private 1-on-1 chat.

**Actual `updateNewMessage` shape observed (real fields, real private chat -
this account's own test messages, safe to record verbatim):**

```
[standalone] updateNewMessage: {
  chatId: 8276449701,
  messageId: 165469487104,
  date: 1789307787,
  isOutgoing: false,
  contentType: 'messageText',
  text: 'Ууууууууу'
}
[standalone] updateNewMessage: {
  chatId: 8276449701,
  messageId: 165470535680,
  date: 1789307822,
  isOutgoing: true,
  contentType: 'messageText',
  text: '23121312'
}
```

and, after a full restart (see below):

```
[standalone] updateNewMessage: {
  chatId: 8276449701,
  messageId: 165471584256,
  date: 1789307895,
  isOutgoing: true,
  contentType: 'messageText',
  text: 'RESTART_TEST'
}
```

`chat_id` for a private chat is a plain positive user id (`8276449701`), and
`message.date` is a Unix timestamp in seconds, matching `@prebuilt-tdlib/types`.

**Multiple/sequential messages:** confirmed - several private-chat messages
sent a few seconds to tens of seconds apart each produced their own,
correctly-ordered `updateNewMessage` with strictly increasing `messageId`
and `date`. (The same run also received a much larger volume of
`updateNewMessage` from pre-existing group/supergroup chats this account is
already a member of - TDLib does not filter updates by chat type, exactly as
plan §09 anticipates. Those chats surface `chat_id` values in the
`-100xxxxxxxxxx` supergroup/channel range, clearly distinguishable from the
plain positive id of a private chat. Their message content belongs to real
third parties and is intentionally **not** reproduced in this document -
group/channel/bot handling is out of scope for this whole project (plan
§00) and unrelated to what task 01.4 needs to prove; this spike does not
filter by chat type, since that filtering itself is explicitly plan step
09, not 01.4.)

**Message sent from another account (incoming):** the `'Ууууууууу'` message
above was sent from a second, separate Telegram account directly to the
tested account's private chat and correctly arrived with `isOutgoing: false`.

**`isOutgoing` on a message sent from the tested account itself:** confirmed
`true` twice - `'23121312'` (sent from another logged-in client of the same
tested account, before restart) and `'RESTART_TEST'` (sent the same way,
after restart). Both were delivered as ordinary `updateNewMessage` events
with `is_outgoing: true`, with no special-casing needed to receive them
(they arrive through the same update stream as incoming messages).

**Content types actually observed (not assumed):** `messageText` (handled -
text extracted from `content.text.text`), plus, from the surrounding
group-chat traffic in the same run and correctly identified without
crashing: `messageAnimation`, `messagePhoto`, `messageVideo`. For all
non-`messageText` types the handler logs `contentType` and `text:
undefined` - no attempt is made to extract a preview/caption from these,
which is correct per this task's scope (text-only extraction).

**Restart check, real result:** the client was shut down (previous process
terminated) and `npm run spike:standalone` was run again from a completely
fresh process. Session persistence held (straight to
`authorizationStateReady`, no re-auth), and a new message
(`'RESTART_TEST'`, shown above) sent immediately after produced a fresh
`updateNewMessage` in the new process - confirming the update subscription
is re-established correctly on every startup, not just tied to the
in-memory state of a single run.

**Secrets check:** none of the logged fields (`chat_id`, `message.id`,
`message.date`, `message.is_outgoing`, content type, text) can carry
`api_hash`, OTP, or the 2FA password - those values are never part of a
TDLib `message` object and are not read or logged anywhere in this handler.

**Limitations / open items found:**

- The update handler is global and un-filtered: it logs `updateNewMessage`
  for every chat the account is a member of, including supergroups/channels
  with heavy, unrelated real-user traffic. This is expected and intentional
  for this task (chat-type filtering is plan §09, not §01.4) but means this
  spike is noisy to run against an account that's in active groups - a
  future integration step should filter to `chat.type._ === 'chatTypePrivate'`
  before doing anything with the update, per plan §09/§11.
- `messageText.text` is a `formattedText` (text + entities), not a bare
  string - entities (bold/links/mentions/etc.) are present on real messages
  but are not read or logged by this spike; only the plain `text.text`
  string is extracted, per this task's "minimally necessary data" scope.
- No delete/edit updates were exercised here (`updateDeleteMessages` is
  explicitly plan step 01.5, not this task).

## Task 01.5 verification

**What was added:** `spike/connect.ts` (a small helper that reconnects to the
*same* on-disk session as `spike/standalone-client.ts`, throwing instead of
prompting if TDLib ever asks for a fresh login - this experiment only makes
sense against an already-`authorizationStateReady` session) and
`spike/delete-experiment.ts` (`npm run spike:delete-experiment -- phase1` /
`node dist/delete-experiment.js phase2 <chatId> <messageId>`), a one-shot
diagnostic script. It is not a feature and is not wired into
`standalone-client.ts`.

### Test setup

- Same real, already-authorized account and same TDLib database directory as
  tasks 01.3-01.4 (`TDLIB_DATA_DIR`, defaulting to
  `<tmp>/telegram-desktop-client-standalone`). `resumeExistingSession`
  confirmed `authorizationStateReady` with **no** re-authorization before any
  test ran.
- Same private 1-on-1 chat as task 01.4, `chat_id = 8276449701` (a real
  second Telegram account). No groups, channels, or bots involved.
- `tdl@8.1.0` + `prebuilt-tdlib@0.1008067.0` (TDLib 1.8.67), the version
  decided and used throughout this document.
- All test messages sent by the experiment itself (via TDLib's own
  `sendMessage`, from the primary tested account to the private chat) using
  disposable, self-authored strings (`DELETE_TEST_LOCAL`,
  `DELETE_TEST_BOTH`, `DELETE_TEST_RACE`, `DELETE_TEST_RESTART`) - not
  third-party content.

### updateNewMessage

Each test message was confirmed via the real update stream before being
deleted, exactly as in task 01.4: `sendMessage` returns a message with a
**temporary** id; `updateMessageSendSucceeded` then arrives with
`old_message_id` (the temporary id) and the real `message` carrying the
final id. Example (real, this run):

```
sendMessage("DELETE_TEST_LOCAL") -> temporary id 165475778561
updateMessageSendSucceeded: old_message_id=165475778561 -> {
  chatId: 8276449701,
  messageId: 165476827136,
  date: 1789308714,
  isOutgoing: true,
  contentType: 'messageText',
  text: 'DELETE_TEST_LOCAL'
}
```

Deletion always targeted the **final** id from `updateMessageSendSucceeded`,
never the temporary one (see "Timing/race check" below for what happens if a
delete targets the temporary id instead).

### Delete behavior

**Actual, verbatim `updateDeleteMessages` payload** (TDLib 1.8.67, this
account, this private chat - four separate real deletions, revoke both
`false` and `true`):

```json
{"_":"updateDeleteMessages","chat_id":8276449701,"message_ids":[165476827136],"is_permanent":true,"from_cache":false}
{"_":"updateDeleteMessages","chat_id":8276449701,"message_ids":[165477875712],"is_permanent":true,"from_cache":false}
{"_":"updateDeleteMessages","chat_id":8276449701,"message_ids":[165477875713],"is_permanent":true,"from_cache":false}
{"_":"updateDeleteMessages","chat_id":8276449701,"message_ids":[165479972864],"is_permanent":true,"from_cache":false}
```

Fields actually present: `chat_id`, `message_ids` (array, one id per test -
`deleteMessages` was only ever called with a single id at a time here, so
batching multiple ids into one update was not exercised), `is_permanent`,
`from_cache`. No other fields are present - in particular, **there is no
field identifying which message(s) these were, no snapshot of prior content,
and no field distinguishing a "delete for me" from a "delete for everyone"
call** (see below). `is_permanent` was `true` and `from_cache` was `false`
in every observed case, including the `revoke: false` ("delete for me")
case - i.e. `is_permanent: true` does **not** mean "deleted for all
participants", it means "TDLib is not just evicting this from a soft cache".
This matches `@prebuilt-tdlib/types`' documented field shapes for
`updateDeleteMessages`, confirmed here against the real runtime object
rather than assumed from the docs.

The message itself is never embedded in `updateDeleteMessages` - only its id.

### Message availability after deletion

**Both `getMessage` (network) and `getMessageLocally` (explicitly documented
as an offline, cache-only method) were tried against every deleted message
id, immediately after its `updateDeleteMessages` arrived. Both returned the
same result every time:**

```
getMessage(8276449701, 165476827136) -> TDLibError code=404 message=Not Found
getMessageLocally(8276449701, 165476827136) -> TDLibError code=404 message=Not Found
```

**Answer: no.** Once `updateDeleteMessages` has been received, the original
message - id, text, everything - is not retrievable through TDLib by any
method exercised here, neither over the network nor from TDLib's own local
cache. TDLib does not keep a retrievable tombstone or shadow copy of deleted
message content; the only surviving fact is the deleted `message_ids` inside
the event that reported the deletion.

### Delete-for-self vs delete-for-both

Both scenarios **were** exercised, using `deleteMessages`' own `revoke`
parameter (`revoke: false` = delete for me only, `revoke: true` = delete for
all chat members - this is exactly the mechanism behind Telegram's own
"Delete for me" / "Delete for everyone" chat UI for a private chat; TDLib's
type comment confirms `revoke` is meaningful for private chats and is
forced `true` only for supergroups/channels/secret chats).

**Finding: the resulting `updateDeleteMessages` is identical in shape and
values for both cases** (`is_permanent: true`, `from_cache: false` either
way, from the sending account's own perspective) - there is no field in the
update that lets the receiving code distinguish "I deleted this only for
myself" from "I deleted this for both participants". Any such distinction
must come from the caller's own memory of which `revoke` value it used, not
from the update.

**Documented limitation (not simulated):** this project has only one
authorized TDLib session (the primary tested account). What the **second**
account's own TDLib client observes for a `revoke: false` deletion
initiated by the first account was not verified here - that would require a
second, separately authorized TDLib session for the second account, which
is out of scope for this spike. This spike only establishes what the
*initiating* account's own client sees, for both `revoke` values.

### Timing/order check

Observed order for a normal send-then-delete: `sendMessage` (temporary id)
-> `updateMessageSendSucceeded` (final id) -> `deleteMessages` call ->
`updateDeleteMessages` (final id). No reordering was observed across four
independent runs of this sequence.

**Race scenario (deleting immediately after `sendMessage` resolves, without
waiting for `updateMessageSendSucceeded`):** `deleteMessages` was called
with the **temporary** id returned directly by `sendMessage`, before
`updateMessageSendSucceeded` had arrived. Real result: `deleteMessages`
succeeded immediately, and the resulting `updateDeleteMessages` referenced
that same temporary id (`165477875713` in this run) - `updateNewMessage`/
`updateMessageSendSucceeded` for that message never arrived at all (message
send was apparently canceled server-side before completion). No crash, no
hang, no unhandled rejection in either the deleting client or this script.
This means the temporary id TDLib hands back from `sendMessage` is itself a
valid `deleteMessages` target for a brief window, and deleting fast enough
can suppress the final send entirely rather than send-then-delete.

### Restart behavior

A message (`DELETE_TEST_RESTART`) was sent, its final id captured, deleted
with `revoke: true`, and its `updateDeleteMessages` confirmed - all in one
process. The process was then closed (`client.close()`, real
`authorizationStateClosing` -> `authorizationStateClosed`) and a **separate**
process (`phase2`) was started against the same database directory:

```
authorizationState -> authorizationStateReady   (no re-authorization)
getMessage(8276449701, 165479972864) -> TDLibError code=404 message=Not Found
getMessageLocally(8276449701, 165479972864) -> TDLibError code=404 message=Not Found
Update types observed in that window: updateChatReadInbox, updateUserStatus, updateNewMessage, updateChatLastMessage
```

After restart: the message stays unavailable through both `getMessage` and
`getMessageLocally` (i.e. the "not found" state persisted across a real
process restart against the same on-disk database, not just held in
in-memory state), and **no additional `updateDeleteMessages` (and no update
of any kind referencing that message id) was emitted on the fresh startup** -
deletion is not "replayed" to a newly (re)connecting client.

### Architectural implication for tombstones

TDLib provides **no** mechanism, at any point after `updateDeleteMessages`
fires, to recover a deleted message's text - not from the network, not from
TDLib's local cache, not after a restart, and the delete event itself never
carries the original content. Therefore: **for Task 16, a tombstone must
capture and persist the message's content (at minimum the text, and
whatever else the app wants to keep) at `updateNewMessage`/edit time,
*before* any deletion can happen** - there is nothing left to backfill from
TDLib once `updateDeleteMessages` has been observed. Additionally:

- A tombstone's storage layer cannot distinguish "deleted for me" from
  "deleted for everyone" from `updateDeleteMessages` alone (both produce the
  same fields); if that distinction matters to the tombstone UI, it can only
  be inferred from context the app already has (e.g. whether the deletion
  was locally initiated with a known `revoke` value), never from the update
  itself, and it cannot be inferred at all for a deletion initiated by the
  other party.
- Because a `deleteMessages` call issued immediately after sending can
  suppress the final message entirely (see "Timing/order check"), a
  tombstone/history store fed only by `updateNewMessage` could plausibly
  never see certain very-short-lived outgoing messages at all before their
  deletion - this is a real ordering edge case to keep in mind for Task 16,
  not a hypothetical one.

This is a finding from this experiment only - no tombstone storage, buffering,
SQLite, or UI work was implemented as part of this task.

## Task 01.6 verification

Goal: prove the `tdl` + `prebuilt-tdlib` binding actually survives
electron-builder packaging on Windows, not just `electron .` in dev - and
verify (not assume) every native-dependency/asar question the plan raised.

### Spike added

`spike/electron-main.ts` (the app's `main` entry point) was rewritten for
this task to reuse the real, already-authorized session from
`spike/standalone-client.ts` (via `spike/connect.ts`'s `createClient` /
`resumeExistingSession`, the same helper `spike/delete-experiment.ts`
already used) instead of the throwaway session used by the original task
01.2 binding-load check. It:

- creates one `BrowserWindow` (`nodeIntegration: false`, `contextIsolation:
  true`, `sandbox: true`, no preload) showing a static status string - no
  Telegram UI, no IPC, TDLib never leaves the main process;
- resumes the existing session and waits for `authorizationStateReady`
  (`resumeExistingSession` throws on any login prompt, so a login prompt
  here is treated as a hard failure, per the "no repeat authorization"
  precondition from task 01.5);
- logs `authorizationState` transitions and (structurally only -
  content-type, never text) `updateNewMessage` arrivals to both the console
  and a log file at `app.getPath('userData')/spike-01.6.log` (outside the
  repo and outside the packaged app's install directory in both dev and
  packaged runs - needed because a packaged GUI app's stdout isn't reliably
  visible from a terminal, see "Packaged runtime" below);
- on `window-all-closed`, calls `client.close()` and awaits it before
  `app.quit()`.

`spike/connect.ts` gained one addition: a `resolveTdjsonPath()` wrapper
around `getTdjson()` (see "Native dependency" below for why).

### Electron development

`env -u ELECTRON_RUN_AS_NODE npm run spike:electron` (`electron .`, dev,
unpacked `node_modules`): reached `authorizationStateReady` immediately,
reusing the existing session with no re-authorization, then received a
backlog of `updateNewMessage` updates from local history/database sync.
Confirmed working before touching packaging at all.

### Packaging

- **Tool:** `electron-builder@26.15.3` (added as a devDependency - the repo
  had no packaging tool before this task).
- **Target:** `--win --dir` (unpacked `win-unpacked/` directory containing
  the real `.exe`, not an NSIS installer). Chosen deliberately: `--dir`
  still produces the exact same `asar`-packed, `asarUnpack`-applied,
  `@electron/rebuild`-processed application tree an installer would wrap -
  everything this task needed to verify (native binary resolution inside a
  packaged app) is identical either way, and skipping the installer step
  keeps the spike fast and avoids adding an unrelated installer-signing
  surface. Not exercised: NSIS installer generation/uninstall flow -
  out of scope for "does TDLib load in a packaged app".
- **electron-builder config added** (`package.json` `"build"` field):
  `appId`, `productName`, `directories.output: "release"`, a minimal
  `files` list (`dist/**/*`, `package.json`), an explicit `asarUnpack` (see
  below), and `win.target: "dir"`.
- **How native binaries got into the packaged app:** electron-builder's
  *default* native-file auto-detection already found and physically
  extracted both `node_modules/tdl/prebuilds/win32-x64/tdl.node` and
  `node_modules/@prebuilt-tdlib/win32-x64/tdjson.dll` into
  `resources/app.asar.unpacked/...` even *before* any explicit `asarUnpack`
  glob was added - verified by inspecting the packaged output tree. An
  explicit `asarUnpack` (`node_modules/tdl/prebuilds/**`,
  `node_modules/@prebuilt-tdlib/**`) was added anyway and kept, to pin this
  behavior instead of relying on undocumented auto-detection heuristics
  that could change between electron-builder versions.

### Native dependency

- **`@electron/rebuild`: not added manually, but it runs anyway.**
  electron-builder vendors `@electron/rebuild` itself and invokes it
  automatically during `electron-builder --win --dir` (visible in its log
  as `executing @electron/rebuild ... installing native dependencies ...
  preparing moduleName=tdl`). This actually **recompiled `tdl`'s native
  addon from source** against Electron 44's ABI (real MSVC build output:
  `node_modules/tdl/build/Release/td.node`, `.vcxproj`, `.tlog` files
  appeared after packaging) rather than reusing the npm-shipped
  `prebuilds/win32-x64/tdl.node` - `node-gyp-build`'s resolution order
  prefers a local `build/Release/*.node` over `prebuilds/*` when both
  exist, so the packaged app actually runs the rebuilt addon. This only
  worked because this machine happens to have a working MSVC/node-gyp
  toolchain installed; a machine without one would need it for the
  **build** step (not for running the already-packaged app - target
  machines never rebuild anything).
- **`node-gyp`: not added manually either** - it's a transitive dependency
  of `@electron/rebuild` (found at `node_modules/.bin/node-gyp`, `v12.4.0`),
  pulled in the same way.
- **`asarUnpack`: required, and empirically verified as required** (not
  assumed - see "Problems / risks" below for the exact failure observed
  without a working fix). electron-builder's auto-detection already
  physically unpacks the two native files even with no explicit config, so
  in one narrow sense "not strictly required to add" - but the explicit
  glob was kept anyway as a documented, version-independent guarantee. See
  "Problems / risks" for the real gap this alone did *not* close.
- **Native/prebuilt files actually required in the packaged app:**
  `resources/app.asar.unpacked/node_modules/tdl/prebuilds/win32-x64/tdl.node`
  (or the freshly-rebuilt `node_modules/tdl/build/Release/td.node`, see
  above) and
  `resources/app.asar.unpacked/node_modules/@prebuilt-tdlib/win32-x64/tdjson.dll`.
  Everything else under `node_modules/tdl` and `node_modules/@prebuilt-tdlib`
  (JS, `.d.ts`, build intermediates) can stay inside `app.asar` - only the
  two actual native binaries need to be real on-disk files.

### Problems / risks (real, not hypothetical)

**Packaged run failed on the first attempt** with `asarUnpack` *not yet
configured* (only electron-builder's auto-detection was in effect):

```
Error: Dynamic Loading Error: Win32 error 126
    at loadAddon (...\resources\app.asar\node_modules\tdl\dist\addon.js:45:27)
```

Win32 error 126 = `ERROR_MOD_NOT_FOUND`. Root cause, confirmed by adding a
diagnostic log of the resolved path right before the failure:

```
[connect] resolved tdjson path: ...\resources\app.asar\node_modules\@prebuilt-tdlib\win32-x64\tdjson.dll
```

`prebuilt-tdlib`'s `getTdjson()` resolves the DLL path via
`require.resolve()`, which returns the *virtual* in-archive spelling
(`...\app.asar\node_modules\...`) even though the file is physically
unpacked into `app.asar.unpacked` alongside it. That string is then handed
directly to a native `LoadLibraryW()` call inside `tdl`'s C++ addon
(`win32-dlfcn.cpp`) - not through Node's `fs`, so Electron's asar-aware `fs`
patch (which *does* transparently redirect `fs.readFileSync` etc. to
`app.asar.unpacked`) never gets a chance to redirect it. Windows tries to
open a path "inside" `app.asar`, which is one opaque file, not a real
directory → module not found. This is a known class of Electron/asar
caveat (transparent redirection covers Node's own `fs`/`require()` of `.js`
and `.node` modules, not arbitrary path strings handed to non-Node native
calls) and it would **not** have been caught by just trusting the packaged
build to succeed - it only surfaced by actually running the packaged
`.exe`.

**Fix applied** (`spike/connect.ts`): a small `resolveTdjsonPath()` wrapper
that rewrites `...app.asar\` → `...app.asar.unpacked\` in the resolved path
when (and only when) that substring is present, before calling
`tdl.configure()`. No-op in dev (no `app.asar` segment exists there). After
this fix, the same packaged build reached `authorizationStateReady`
(verified path in the log:
`...\resources\app.asar.unpacked\node_modules\@prebuilt-tdlib\win32-x64\tdjson.dll`).

**Takeaway for future tasks:** "the file is unpacked on disk" and "the
code asks for it at the right path" are two separate facts, and this
binding's own path-resolution helper (`prebuilt-tdlib`'s `getTdjson()`)
gets the second one wrong inside asar. Any future `tdl`/`prebuilt-tdlib`
version bump should re-check whether `getTdjson()` still needs this
workaround (e.g. if a future release path-resolves via `app.getAppPath()`
or otherwise becomes asar-aware itself).

Other risks carried over from section 8 (N-API ABI stability assumption
across Electron versions, no Linux/macOS packaging check, no TDLib version
bump testing) still apply and were not re-verified here.

### Packaged runtime

All runs below used `env -u ELECTRON_RUN_AS_NODE` (see section 8 - this
sandboxed dev shell inherits `ELECTRON_RUN_AS_NODE=1` from its own parent
Electron process, which is unrelated to `tdl`/packaging but breaks *any*
Electron launch, dev or packaged, if left set) and ran the actual
`release\win-unpacked\telegram-desktop-client-spike.exe`, never `electron
.` and never a `.ts`/`.js` file directly.

**First packaged launch** (after the `asarUnpack`/path fix):

```
[connect] resolved tdjson path: ...\resources\app.asar.unpacked\node_modules\@prebuilt-tdlib\win32-x64\tdjson.dll
[electron-packaged] app ready; electron: 44.3.0 chrome: 152.0.7977.78
[electron-packaged] authorizationState -> authorizationStateWaitTdlibParameters
[electron-packaged] authorizationState -> authorizationStateReady
[electron-packaged] authorizationStateReady reached - existing session resumed, no re-authorization
[electron-packaged] updateNewMessage received, contentType: messageText   (several - local history/db sync, harmless)
```

**Clean shutdown**, verified by actually closing the window (PowerShell
`Process.CloseMainWindow()`, simulating a real user close - not killing the
process) and reading the log afterwards:

```
[electron-packaged] shutting down, closing TDLib client...
[electron-packaged] authorizationState -> authorizationStateClosing
[electron-packaged] client closed
[electron-packaged] authorizationState -> authorizationStateClosed
[electron-packaged] shutdown complete
```

The process exited within the 10s wait after the close request every time.

**Second packaged launch** (fresh process, same on-disk TDLib database
directory): reached `authorizationStateReady` again with **no
re-authorization prompt or failure**, then shut down cleanly the same way -
session persistence across a packaged-app restart confirmed.

**Repository-independence check:** the entire `win-unpacked` directory was
copied to `%TEMP%\tdc-clean-test` (outside the repo, outside
`node_modules`), and launched from there with `TG_API_ID`/`TG_API_HASH` set
only as process environment variables (no `.env` file present in that
directory, no repo files reachable from it). Result was identical:
`authorizationStateReady` reached, existing session reused, clean shutdown.
This confirms the packaged app does not depend on being run from, or
alongside, the source repository.

### Clean environment

**What was actually checked:** the packaged app was run (a) from the build
output directory, and (b) copied to and run from an unrelated temp
directory outside the repo, with credentials supplied only via process
environment variables (no bundled `.env`). Both are on the *same* Windows
machine used for development.

**What was not checked, honestly:** no separate clean Windows VM/machine
without Node.js, `node_modules`, or a dev toolchain was available in this
environment, so "packaged app runs correctly with zero dev tooling on the
host" was **not** independently verified end-to-end. The repository-copy
test above is a partial substitute (proves independence from the repo
*path/contents*, and from any `.env`/env-var leakage into the package
itself) but it is not equivalent to a true clean-machine test, because
things like the Visual C++ runtime, GPU drivers, or Windows version
differences on a genuinely separate machine were not exercised. This
limitation is being stated explicitly per this task's own instruction not
to claim "clean machine verified" without one.

### npm run build

Ran clean (`tsc`, no errors) before every dev/packaging step in this task.

### git status / git diff summary

Modified: `.gitignore` (added `release/`), `package.json` /
`package-lock.json` (added `electron-builder` devDependency, `build` /
`asarUnpack` / `package:win` script config), `spike/connect.ts`
(`resolveTdjsonPath()` fix + diagnostic log), `spike/electron-main.ts`
(rewritten for this task's real-session/packaging spike). No new files
tracked by git. `release/` (packaged output) and the TDLib database
directory (`%TEMP%\telegram-desktop-client-standalone`, outside the repo,
per task 01.3-01.5) were never inside the repository and are not tracked.
`.env` was not modified and was confirmed absent from both the packaged
`app.asar` contents and the copied clean-environment test directory. No
commit was made for this task.

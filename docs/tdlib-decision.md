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

# Changelog

## v0.1.0-rc.6.5 — 2026-08-14

Desktop integration and 32-bit compatibility preview, still bundling unmodified DeepSeek Harness
`0.1.0-rc.6`.

![Bundled desktop-ui plugin enabled](https://raw.githubusercontent.com/CCMu04/DSHDesktop/v0.1.0-rc.6.5/docs/images/dsh-desktop-plugin.jpg)

### Fixed

- Open settings files and workspace directories through Electron's native Windows shell after the
  official Host request completes, avoiding inherited Electron Node mode in VS Code and other apps.
- Strip backend-only `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS` from DSH native opener subprocesses as
  an additional compatibility guard.

### Added

- Bundle `dsh-desktop-ui` with the app. It is installed and enabled once on first use and once after
  bundled plugin content changes; later launches preserve the user's enabled/disabled choice.
- Produce x64 and ia32 installer and portable assets. The ia32 runtime cross-builds the upstream
  `node-pty` native modules and ships the matching 32-bit 7-Zip extractor.
- Add a tag-driven preview Release workflow and architecture-qualified artifact names.

### Revised (2026-08-14)

- Run the DSH backend on a bundled official Node.js 24 runtime instead of Electron-as-Node. Under
  Electron's runtime the native workspace directory picker (koffi) aborted fatally — "open workspace"
  failed after picking a folder — and node-pty output events never fired, leaving `backend.log`
  permanently silent. Both are restored: the native folder dialog works again and backend logs are
  written.
- Capture backend output through plain hidden pipes instead of a headless ConPTY.
- Drop the ia32 builds; x64 is the only supported architecture (Node 24 ships no 32-bit binaries),
  and the installer now bundles the official `node.exe` (v24.18.1) runtime.

### Validation

- Seven automated tests cover the native-open bridge, Electron environment cleanup, toolchain, and
  bundled-plugin lifecycle.
- Isolated-Home UI smoke testing confirmed settings.yaml opens in VS Code, desktop-ui appears enabled,
  and a same-version restart preserves a manual plugin disable.
- The revised build was smoke-tested end to end: the backend runs on the bundled `node.exe`, logs
  reach `backend.log`, `host.pickDirectory` opens and closes the native folder dialog without
  crashing, and core APIs (sessions, host describe) respond.

## v0.1.0-rc.6.4 — 2026-08-14

First public preview of DSH Desktop, bundling DeepSeek Harness `0.1.0-rc.6`.

![DSH Desktop main window](https://raw.githubusercontent.com/CCMu04/DSHDesktop/main/docs/images/dsh-desktop.png)

### Highlights

- Official DSH Web UI in a native Windows desktop window, without changing upstream source.
- Shared `~/.dsh` configuration, sessions, profiles, credentials, and persistent plugins.
- Bundled DSH, Node, and pnpm toolchain; no global DSH installation required.
- Incremental runtime cache and NSIS block map generation.
- Headless ConPTY backend and hidden Windows sandbox console windows.
- Verified PowerShell output, non-zero exit codes, background tasks, and workspace file writes.

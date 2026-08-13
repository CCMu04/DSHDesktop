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

### Validation

- Seven automated tests cover the native-open bridge, Electron environment cleanup, toolchain, and
  bundled-plugin lifecycle.
- Isolated-Home UI smoke testing confirmed settings.yaml opens in VS Code, desktop-ui appears enabled,
  and a same-version restart preserves a manual plugin disable.

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

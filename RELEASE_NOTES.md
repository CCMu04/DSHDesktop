# DSH Desktop v0.1.0-rc.6.5 preview

This preview keeps the official DeepSeek Harness `0.1.0-rc.6` runtime unchanged and improves the
Windows desktop integration around it.

![DSH Desktop showing the bundled desktop-ui plugin enabled](https://raw.githubusercontent.com/CCMu04/DSHDesktop/v0.1.0-rc.6.5/docs/images/dsh-desktop-plugin.jpg)

## Highlights

- The DSH backend runs on a bundled official Node.js 24 runtime instead of Electron-as-Node. The
  native workspace directory picker works again ("open workspace" previously crashed after picking a
  folder), and backend logs are written to `backend.log` again.
- The Settings **Open configuration file** action opens through Electron's native Windows shell, so
  Electron-based editors such as VS Code no longer inherit backend Node mode.
- Folder opens use the same desktop bridge.
- `desktop-ui` is bundled, installed, and enabled on first use or after its bundled content changes.
  Subsequent launches preserve the user's choice.
- x64 is the only supported architecture: one installer and one portable executable.

## Verified

- 7 automated desktop integration tests pass.
- The revised build was smoke-tested end to end: the backend runs on the bundled `node.exe`, logs
  reach `backend.log`, `host.pickDirectory` opens and closes the native folder dialog without
  crashing, and core APIs respond.
- All screenshots in this release show only the DSH Desktop application window.

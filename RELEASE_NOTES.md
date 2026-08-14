# DSH Desktop v0.1.0-rc.6.5 preview

This preview keeps the official DeepSeek Harness `0.1.0-rc.6` runtime unchanged and improves the
Windows desktop integration around it.

![DSH Desktop showing the bundled desktop-ui plugin enabled](https://raw.githubusercontent.com/CCMu04/DSHDesktop/v0.1.0-rc.6.5/docs/images/dsh-desktop-plugin.jpg)

## Highlights

- The Settings **Open configuration file** action now opens through Electron's native Windows shell,
  so Electron-based editors such as VS Code no longer inherit backend Node mode.
- Folder opens use the same desktop bridge, including the new 32-bit build.
- `desktop-ui` is bundled, installed, and enabled on first use or after its bundled content changes.
  Subsequent launches preserve the user's choice.
- Four Windows artifacts are provided: x64 and ia32, each as an installer and portable executable.

## Verified

- 7 automated desktop integration tests pass.
- An isolated DSH Home confirmed configuration-file opening, plugin activation, and preservation of a
  same-version manual disable.
- All screenshots in this release show only the DSH Desktop application window.

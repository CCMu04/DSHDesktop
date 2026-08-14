# DSH Desktop v0.1.0-rc.6.5.2 preview

Follow-up to the v0.1.0-rc.6.5.1 preview: right-click a workspace in the sidebar and choose
**Open in Explorer** to reveal its directory in Windows Explorer.

![DSH Desktop showing the bundled desktop-ui plugin enabled](https://raw.githubusercontent.com/CCMu04/DSHDesktop/main/docs/images/dsh-desktop-plugin.jpg)

## Highlights

- Workspace folders in the sidebar now have a right-click action, **在资源管理器中打开** /
  **Open in Explorer**, that reveals the workspace directory in Windows Explorer — routed
  through the official `host.openPath` API and the desktop native-open bridge, so it opens
  exactly once with a clean environment.
- Everything from v0.1.0-rc.6.5.1 is unchanged: window dragging via the session header,
  bundled Node.js 24 runtime, `desktop-ui`, and the x64-only installer.

## Verified

- 7 automated desktop integration tests pass.
- All screenshots in this release show only the DSH Desktop application window.

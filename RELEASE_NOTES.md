# DSH Desktop v0.1.0-rc.6.5.1 preview

Follow-up to the v0.1.0-rc.6.5 preview: window dragging is back without blocking the session
header buttons.

![DSH Desktop showing the bundled desktop-ui plugin enabled](https://raw.githubusercontent.com/CCMu04/DSHDesktop/main/docs/images/dsh-desktop-plugin.jpg)

## Highlights

- The session header is now the window drag surface: drag the window by its empty areas (top
  padding, title-row gaps, tab spacing), while the breadcrumbs and the header action buttons
  (jobs, subagents, session-log export) opt out and stay fully clickable.
- Everything from v0.1.0-rc.6.5 is unchanged: the DSH backend runs on the bundled official
  Node.js 24 runtime, `desktop-ui` is bundled, and x64 is the only supported architecture.

## Verified

- 7 automated desktop integration tests pass.
- All screenshots in this release show only the DSH Desktop application window.

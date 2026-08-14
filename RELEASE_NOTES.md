# DSH Desktop v0.1.0-rc.6.5.3 preview

Settings drawer close fix.

![DSH Desktop showing the bundled desktop-ui plugin enabled](https://raw.githubusercontent.com/CCMu04/DSHDesktop/main/docs/images/dsh-desktop-plugin.jpg)

## Highlights

- The settings drawer now closes only on genuine mask clicks. Previously, interacting with
  portaled UI above the mask — dropdown popups on the General page, the agent-preset view
  dialog — closed the whole settings page; those controls now work normally, while clicking
  the dimmed mask, the close button, or pressing Escape still closes the drawer.
- Everything from v0.1.0-rc.6.5.2 is unchanged.

## Verified

- 5 automated desktop integration tests pass.
- All screenshots in this release show only the DSH Desktop application window.

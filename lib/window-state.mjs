/**
 * Window-state persistence for the shell: remembers the main window bounds,
 * maximized and full-screen flags, and restores them on the next launch.
 *
 * The main process owns the config file ($DSH_HOME/desktop-window.json).
 * Bounds are validated against the current display work-areas at load time
 * (a window saved on a now-disconnected monitor must not come back off
 * screen); sanitizing lives here so it stays unit-testable.
 */

export const WINDOW_STATE_FILE = 'desktop-window.json'

/** Smallest window we are willing to restore (dismisses corrupted configs). */
export const MIN_RESTORE_WIDTH = 200
export const MIN_RESTORE_HEIGHT = 120

/** Minimum overlap with a display work-area for a saved window to be usable. */
export const MIN_VISIBLE_WIDTH = 160
export const MIN_VISIBLE_HEIGHT = 40

export function defaultWindowState() {
  return null
}

export function parseWindowState(text) {
  if (typeof text !== 'string') return null
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const b = value.bounds
  const bounds =
    typeof b === 'object' &&
    b !== null &&
    [b.x, b.y, b.width, b.height].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    b.width >= MIN_RESTORE_WIDTH &&
    b.height >= MIN_RESTORE_HEIGHT
      ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
      : null
  if (bounds === null) return null
  return {
    bounds,
    isMaximized: value.isMaximized === true,
    isFullScreen: value.isFullScreen === true,
  }
}

export function serializeWindowState(state) {
  return `${JSON.stringify(state, null, 2)}\n`
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

/**
 * Move a saved window onto the current displays. Returns the sanitized state
 * (bounds clamped into the best-matching work-area) or null when the window
 * would be essentially invisible — the caller then falls back to defaults.
 * @param state - parsed window state.
 * @param workAreas - `{ x, y, width, height }` rectangles of every display.
 */
export function sanitizeWindowState(state, workAreas) {
  if (state === null || !Array.isArray(workAreas) || workAreas.length === 0) return state
  let best = null
  for (const area of workAreas) {
    const overlap = intersect(state.bounds, area)
    if (overlap.width >= MIN_VISIBLE_WIDTH && overlap.height >= MIN_VISIBLE_HEIGHT) {
      if (best === null || overlap.width * overlap.height > best.overlap.width * best.overlap.height) {
        best = { area, overlap }
      }
    }
  }
  if (best === null) return null
  const { area } = best
  const width = Math.min(state.bounds.width, area.width)
  const height = Math.min(state.bounds.height, area.height)
  const x = Math.min(Math.max(state.bounds.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(state.bounds.y, area.y), area.y + area.height - height)
  return { ...state, bounds: { x, y, width, height } }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MIN_RESTORE_WIDTH,
  parseWindowState,
  sanitizeWindowState,
  serializeWindowState,
} from '../window-state.mjs'

const AREA = { x: 0, y: 0, width: 1920, height: 1040 }

test('parseWindowState tolerates missing or broken input', () => {
  assert.equal(parseWindowState(undefined), null)
  assert.equal(parseWindowState('not json'), null)
  assert.equal(parseWindowState('null'), null)
  assert.equal(parseWindowState('[]'), null)
  assert.equal(parseWindowState('{"bounds":{"x":0,"y":0}}'), null, 'missing width/height')
  assert.equal(parseWindowState('{"bounds":{"x":0,"y":0,"width":10,"height":10}}'), null, 'below minimum size')
  assert.equal(parseWindowState('{"bounds":{"x":"a","y":0,"width":800,"height":600}}'), null, 'non-numeric')
  assert.equal(parseWindowState('{"bounds":{"x":0,"y":0,"width":800,"height":600,"extra":1}}') === null, false)
})

test('parseWindowState reads valid state and flags', () => {
  const state = parseWindowState(
    '{"bounds":{"x":120.4,"y":80.6,"width":1400,"height":900},"isMaximized":true,"isFullScreen":false}',
  )
  assert.deepEqual(state, {
    bounds: { x: 120, y: 81, width: 1400, height: 900 },
    isMaximized: true,
    isFullScreen: false,
  })
  assert.equal(parseWindowState('{"bounds":{"x":0,"y":0,"width":800,"height":600},"isMaximized":false,"isFullScreen":true}').isFullScreen, true)
})

test('serializeWindowState round-trips through parseWindowState', () => {
  const state = { bounds: { x: 10, y: 20, width: 1000, height: 700 }, isMaximized: false, isFullScreen: false }
  assert.deepEqual(parseWindowState(serializeWindowState(state)), state)
})

test('sanitizeWindowState keeps a fully visible window and clamps it in', () => {
  const state = { bounds: { x: 100, y: 50, width: 800, height: 600 }, isMaximized: false, isFullScreen: false }
  assert.deepEqual(sanitizeWindowState(state, [AREA]), state)
  // partially off-screen: clamped back but size kept
  const offRight = sanitizeWindowState({ ...state, bounds: { x: 1750, y: 50, width: 800, height: 600 } }, [AREA])
  assert.equal(offRight.bounds.x, 1120)
  assert.equal(offRight.bounds.width, 800)
  // bigger than the work area: shrunk to fit
  const huge = sanitizeWindowState({ ...state, bounds: { x: -500, y: -500, width: 3000, height: 2000 } }, [AREA])
  assert.equal(huge.bounds.width, 1920)
  assert.equal(huge.bounds.height, 1040)
  assert.equal(huge.bounds.x, 0)
  assert.equal(huge.bounds.y, 0)
})

test('sanitizeWindowState picks the display with the largest overlap', () => {
  const left = { x: 0, y: 0, width: 1920, height: 1040 }
  const right = { x: 1920, y: 0, width: 1920, height: 1040 }
  const state = { bounds: { x: 1900, y: 100, width: 800, height: 600 }, isMaximized: false, isFullScreen: false }
  const result = sanitizeWindowState(state, [left, right])
  // overlaps left by 20px only → clamped onto the right display
  assert.equal(result.bounds.x, 1920)
  assert.equal(result.bounds.width, 800)
})

test('sanitizeWindowState rejects windows that would be invisible', () => {
  const state = { bounds: { x: 5000, y: 5000, width: 800, height: 600 }, isMaximized: false, isFullScreen: false }
  assert.equal(sanitizeWindowState(state, [AREA]), null)
  // below the minimum visible overlap
  const sliver = sanitizeWindowState({ ...state, bounds: { x: 1900, y: 0, width: 800, height: 600 } }, [AREA])
  assert.equal(sliver, null)
})

test('sanitizeWindowState keeps flags and leaves null states alone', () => {
  const state = { bounds: { x: 0, y: 0, width: 800, height: 600 }, isMaximized: true, isFullScreen: true }
  const result = sanitizeWindowState(state, [AREA])
  assert.equal(result.isMaximized, true)
  assert.equal(result.isFullScreen, true)
  assert.equal(sanitizeWindowState(null, [AREA]), null)
  assert.equal(sanitizeWindowState(state, []), state)
})

test('minimum restore size constant guards tiny saved windows', () => {
  assert.ok(MIN_RESTORE_WIDTH >= 100)
})

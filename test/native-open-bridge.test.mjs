import assert from 'node:assert/strict'
import test from 'node:test'
import { installNativeOpenBridge } from '../native-open-bridge.mjs'

function harness() {
  const listeners = {}
  const webRequest = {
    onBeforeRequest: (_filter, listener) => { listeners.before = listener },
    onCompleted: (_filter, listener) => { listeners.completed = listener },
    onErrorOccurred: (_filter, listener) => { listeners.error = listener },
  }
  const opened = []
  installNativeOpenBridge({
    webRequest,
    backendOrigin: 'http://127.0.0.1:1234',
    settingsPath: 'C:\\Users\\test\\.dsh\\settings.yaml',
    openPath: async target => { opened.push(target); return '' },
    reportError: assert.fail,
  })
  return { listeners, opened }
}

test('opens the prepared settings document through Electron after the RPC completes', async () => {
  const { listeners, opened } = harness()
  listeners.before({ id: 1, url: 'http://127.0.0.1:1234/api/settings.openDocument' }, () => {})
  listeners.completed({ id: 1, statusCode: 200 })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(opened, ['C:\\Users\\test\\.dsh\\settings.yaml'])
})

test('opens host paths and discards failed requests', async () => {
  const { listeners, opened } = harness()
  const body = Buffer.from(JSON.stringify({ payload: { path: 'C:\\work' } }))
  listeners.before({ id: 2, url: 'http://127.0.0.1:1234/api/host.openPath', uploadData: [{ bytes: body }] }, () => {})
  listeners.completed({ id: 2, statusCode: 200 })
  listeners.before({ id: 3, url: 'http://127.0.0.1:1234/api/host.openPath', uploadData: [{ bytes: body }] }, () => {})
  listeners.error({ id: 3 })
  listeners.completed({ id: 3, statusCode: 200 })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(opened, ['C:\\work'])
})

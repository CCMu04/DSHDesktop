'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { isNativePathOpener, nativeOpenEnvironment } = require('../runtime-preload.cjs')

test('recognizes the DSH Windows native path opener', () => {
  assert.equal(isNativePathOpener('powershell.exe', ['-Command', "Invoke-Item -LiteralPath 'C:\\x.yml'"]), true)
  assert.equal(isNativePathOpener('pwsh', ['-Command', "Invoke-Item -LiteralPath 'C:\\x.yml'"]), true)
  assert.equal(isNativePathOpener('powershell.exe', ['-Command', 'Get-Item x']), false)
})

test('native desktop opens do not leak Electron Node mode into the launched application', () => {
  const options = nativeOpenEnvironment({
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--require=runtime-preload.cjs',
      DSH_HOME: 'C:\\Users\\test\\.dsh',
    },
  })
  assert.equal(options.windowsHide, true)
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(options.env.NODE_OPTIONS, undefined)
  assert.equal(options.env.DSH_HOME, 'C:\\Users\\test\\.dsh')
})

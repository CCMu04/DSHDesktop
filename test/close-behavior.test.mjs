import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCloseDialogOptions,
  defaultCloseBehavior,
  MINIMIZE_TO_TRAY_NOTIFICATION,
  parseCloseBehavior,
  serializeCloseBehavior,
} from '../close-behavior.mjs'

test('defaultCloseBehavior is not remembered', () => {
  assert.deepEqual(defaultCloseBehavior(), { remembered: false })
})

test('parseCloseBehavior tolerates missing or broken input', () => {
  assert.deepEqual(parseCloseBehavior(undefined), defaultCloseBehavior())
  assert.deepEqual(parseCloseBehavior('not json'), defaultCloseBehavior())
  assert.deepEqual(parseCloseBehavior('null'), defaultCloseBehavior())
  assert.deepEqual(parseCloseBehavior('[]'), defaultCloseBehavior())
  assert.deepEqual(parseCloseBehavior('{"behavior":"sideways","remembered":true}'), {
    behavior: undefined,
    remembered: true,
  })
})

test('parseCloseBehavior reads valid configs', () => {
  assert.deepEqual(parseCloseBehavior('{"behavior":"minimize","remembered":true}'), {
    behavior: 'minimize',
    remembered: true,
  })
  assert.deepEqual(parseCloseBehavior('{"behavior":"quit","remembered":false}'), {
    behavior: 'quit',
    remembered: false,
  })
})

test('serializeCloseBehavior round-trips through parseCloseBehavior', () => {
  const config = { behavior: 'minimize', remembered: true }
  assert.deepEqual(parseCloseBehavior(serializeCloseBehavior(config)), config)
})

test('close dialog copy explains the port consequence and defaults to minimize', () => {
  const options = buildCloseDialogOptions(false)
  assert.equal(options.message, '关闭窗口后希望怎么处理？')
  assert.deepEqual(options.buttons, ['最小化到后台', '直接关闭'])
  assert.equal(options.defaultId, 0)
  assert.equal(options.cancelId, 0)
  assert.ok(options.detail.includes('最小化到后台'))
  assert.ok(options.detail.includes('直接关闭'))
  assert.ok(options.detail.includes('端口'), 'must explain that quitting releases the port')
  assert.ok(options.detail.includes('Web 地址'), 'must explain the address change')
  assert.equal(options.checkboxLabel, '记住我的选择，以后不再询问')
})

test('minimize notification points at the tray exit path', () => {
  assert.ok(MINIMIZE_TO_TRAY_NOTIFICATION.body.includes('托盘'))
  assert.ok(MINIMIZE_TO_TRAY_NOTIFICATION.body.includes('退出'))
})

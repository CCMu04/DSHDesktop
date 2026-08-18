/**
 * Unit tests for the browser main-process controller's pure logic: the
 * navigation target validation (protocol whitelist + loopback blacklist) and
 * the channel constants. No Electron APIs are touched (they only exist inside
 * methods that require a live window).
 */
import { CMD_MARKER, EVENT_NAME, parseTargetUrl } from '../browser-controller.mjs'

// --- channel constants ------------------------------------------------------
if (CMD_MARKER !== '__DSH_BROWSER_CMD__:') throw new Error(`CMD_MARKER wrong: ${CMD_MARKER}`)
if (EVENT_NAME !== 'dsh-desktop-browser-event') throw new Error(`EVENT_NAME wrong: ${EVENT_NAME}`)

// --- valid targets ----------------------------------------------------------
const valid = [
  'https://example.com',
  'http://example.com',
  'example.com', // 无协议前缀 → 按 https 补全
  'example.com:8080', // 无协议但带数字端口 → 按 http 补全（地址栏习惯）
  'https://example.com:8443/path?q=1#frag',
  'http://子域名.example.cn/路径',
  'HTTPS://EXAMPLE.COM',
]
for (const input of valid) {
  const r = parseTargetUrl(input)
  if (!r.ok) throw new Error(`expected ok for ${input}: ${JSON.stringify(r)}`)
  if (r.url.startsWith('http://') === false && r.url.startsWith('https://') === false) {
    throw new Error(`result not http(s): ${r.url}`)
  }
}
const portPrefixed = parseTargetUrl('example.com:8080')
if (!portPrefixed.ok || portPrefixed.url !== 'http://example.com:8080/') {
  throw new Error(`host:port should default to http: ${JSON.stringify(portPrefixed)}`)
}

// --- protocol rejects -------------------------------------------------------
const badProtocol = [
  'javascript:alert(1)',
  'data:text/html,<h1>x</h1>',
  'file:///C:/Windows/win.ini',
  'about:blank',
  'chrome://settings',
  'vbscript:msgbox(1)',
  'ftp://example.com',
  'ws://example.com',
  'mailto:x@y.z',
  'http://::1', // 未加方括号的畸形 IPv6 → 解析失败且显式前缀 → 拒绝
  'http://0:0:0:0:0:0:0:1', // 同上
  '',
  '   ',
]
for (const input of badProtocol) {
  const r = parseTargetUrl(input)
  if (r.ok) throw new Error(`expected protocol reject for ${JSON.stringify(input)}`)
  if (r.reason !== 'protocol' && r.reason !== 'empty') {
    throw new Error(`wrong reason for ${JSON.stringify(input)}: ${JSON.stringify(r)}`)
  }
}

// --- loopback rejects -------------------------------------------------------
const badLocal = [
  'http://localhost:3000',
  'https://localhost',
  'http://127.0.0.1:8080/api',
  'http://127.0.0.1',
  'http://0.0.0.0',
  'http://[::1]',
  'http://[0:0:0:0:0:0:0:1]',
  'http://LOCALHOST',
  'localhost:8080', // 被 URL 规范拆成 scheme "localhost:" → 仍报 localhost
  'localhost',
  '127.0.0.1:8080',
]
for (const input of badLocal) {
  const r = parseTargetUrl(input)
  if (r.ok) throw new Error(`expected localhost reject for ${input}: ${JSON.stringify(r)}`)
  if (r.reason !== 'localhost') throw new Error(`wrong reason for ${input}: ${JSON.stringify(r)}`)
}

// --- normalization sanity ---------------------------------------------------
const prefixed = parseTargetUrl('example.com')
if (!prefixed.ok || prefixed.url !== 'https://example.com/') {
  throw new Error(`https prefix wrong: ${JSON.stringify(prefixed)}`)
}

console.log('browser controller tests: all assertions passed')
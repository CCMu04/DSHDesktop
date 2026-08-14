import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Fetch the official Node.js executable used to run the DSH backend and
 * desktop toolchain shims. Stock Node is required: DSH's native directory
 * picker (koffi) and node-pty data path abort or go silent inside
 * Electron-as-Node, so the backend must run on the real runtime.
 *
 * Only win-x64 is prepared: Node 24 ships no 32-bit builds and the desktop
 * shell no longer builds ia32.
 */

const shellDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(shellDirectory, 'build', 'runtime')

const NODE_VERSION = 'v24.18.1'
const NODE_DISTRIBUTION = `win-x64/node.exe`
const DOWNLOAD_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_DISTRIBUTION}`
const CHECKSUMS_URL = `https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`

const targetPath = path.join(outputDirectory, 'node-x64.exe')
const temporaryPath = `${targetPath}.tmp`
const offline = process.argv.includes('--offline')

function sha256Of(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`))
        return
      }
      const stream = createWriteStream(destination)
      response.pipe(stream)
      stream.on('finish', () => stream.close(resolve))
      stream.on('error', reject)
    })
    request.on('error', reject)
    request.setTimeout(120_000, () => request.destroy(new Error(`Download timed out: ${url}`)))
  })
}

async function fetchExpectedSha256() {
  return await new Promise((resolve, reject) => {
    https.get(CHECKSUMS_URL, response => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Checksum fetch failed with HTTP ${response.statusCode}: ${CHECKSUMS_URL}`))
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        const line = body.split(/\r?\n/u).find(entry => entry.trimEnd().endsWith(`  ${NODE_DISTRIBUTION}`))
        if (!line) reject(new Error(`No checksum line for ${NODE_DISTRIBUTION} in ${CHECKSUMS_URL}`))
        else resolve(line.trim().split(/\s+/u)[0])
      })
      response.on('error', reject)
    }).on('error', reject)
  })
}

mkdirSync(outputDirectory, { recursive: true })

const expectedSha256 = await fetchExpectedSha256()
if (existsSync(targetPath) && sha256Of(targetPath) === expectedSha256) {
  console.log(`Node.js ${NODE_VERSION} already prepared at ${targetPath}.`)
  process.exit(0)
}
if (offline) {
  throw new Error(`Node.js ${NODE_VERSION} is not prepared and --offline forbids downloading: ${targetPath}`)
}

console.log(`Downloading Node.js ${NODE_VERSION} (${NODE_DISTRIBUTION})...`)
rmSync(temporaryPath, { force: true })
await download(DOWNLOAD_URL, temporaryPath)
const actualSha256 = sha256Of(temporaryPath)
if (actualSha256 !== expectedSha256) {
  rmSync(temporaryPath, { force: true })
  throw new Error(
    `Node.js ${NODE_VERSION} checksum mismatch: expected ${expectedSha256}, got ${actualSha256}.`,
  )
}
renameSync(temporaryPath, targetPath)
console.log(`Prepared Node.js ${NODE_VERSION} at ${targetPath} (${expectedSha256.slice(0, 12)}…).`)

/**
 * Mirror local path-open RPCs through Electron's native shell after the DSH
 * host has completed them. DSH remains authoritative for validation and for
 * preparing settings.yaml; Electron supplies the reliable desktop hand-off.
 */
export function installNativeOpenBridge({ webRequest, backendOrigin, settingsPath, openPath, reportError }) {
  const pending = new Map()
  const urls = [
    `${backendOrigin}/api/settings.openDocument`,
    `${backendOrigin}/api/host.openPath`,
  ]

  webRequest.onBeforeRequest({ urls }, (details, callback) => {
    if (details.url.endsWith('/api/settings.openDocument')) {
      pending.set(details.id, settingsPath)
    } else {
      try {
        const bytes = details.uploadData?.find(part => part.bytes)?.bytes
        const request = bytes ? JSON.parse(Buffer.from(bytes).toString('utf8')) : undefined
        if (typeof request?.payload?.path === 'string') pending.set(details.id, request.payload.path)
      } catch {
        // The backend owns malformed-request reporting; the desktop mirror simply stays idle.
      }
    }
    callback({})
  })

  webRequest.onCompleted({ urls }, details => {
    const target = pending.get(details.id)
    pending.delete(details.id)
    if (!target || details.statusCode < 200 || details.statusCode >= 300) return
    void openPath(target).then(error => {
      if (error) reportError(`Desktop path open failed for ${target}: ${error}`)
    }, error => reportError(`Desktop path open failed for ${target}: ${String(error)}`))
  })

  webRequest.onErrorOccurred({ urls }, details => pending.delete(details.id))
}

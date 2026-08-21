const EXACT_VERSION_OR_TAG =
  /^(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|[A-Za-z][0-9A-Za-z._-]*)$/

/**
 * Resolve the npm version selector used by the DSH synchronization script.
 * The default follows the registry's stable `latest` tag; preview upgrades can
 * opt into an exact prerelease without making every future build follow `next`.
 */
export function normalizeDshSelector(value) {
  const selector = typeof value === 'string' ? value.trim() : ''
  if (selector === '') return 'latest'
  if (!EXACT_VERSION_OR_TAG.test(selector)) {
    throw new Error(`Invalid DSH_VERSION selector: ${selector}`)
  }
  return selector
}

/** Normalize npm 10's string and npm 12's single-value array output. */
export function normalizePublishedVersion(value) {
  if (typeof value === 'string' && value !== '') return value
  if (Array.isArray(value)) {
    const versions = [...new Set(value.filter(item => typeof item === 'string' && item !== ''))]
    if (versions.length === 1) return versions[0]
  }
  return null
}

/** Pin already-declared runtime packages without changing their dependency bucket. */
export function pinRuntimePackages(manifest, names, targetVersion) {
  const updated = {
    ...manifest,
    dependencies: { ...(manifest.dependencies ?? {}) },
    devDependencies: { ...(manifest.devDependencies ?? {}) },
  }
  for (const name of names) {
    if (Object.hasOwn(updated.dependencies, name)) {
      updated.dependencies[name] = targetVersion
    } else if (Object.hasOwn(updated.devDependencies, name)) {
      updated.devDependencies[name] = targetVersion
    } else {
      throw new Error(`Cannot pin undeclared runtime package: ${name}`)
    }
  }
  return updated
}

/**
 * Desktop-shell version: <official DSH version>.<desktop major>.<desktop minor>.
 * The desktop suffix advances monotonically across official DSH upgrades.
 */
export function nextDesktopVersion(currentVersion, targetDshVersion) {
  if (typeof currentVersion === 'string') {
    const segments = currentVersion.split('.')
    const major = Number.parseInt(segments[segments.length - 2] ?? '', 10)
    const minor = Number.parseInt(segments[segments.length - 1] ?? '', 10)
    if (Number.isInteger(major) && major >= 1 && Number.isInteger(minor)) {
      return `${targetDshVersion}.${major}.${minor + 1}`
    }
  }
  return targetDshVersion
}

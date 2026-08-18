/**
 * Smoke test for the dsh-desktop-features host half: the module must import
 * cleanly (no duplicate-export / unresolved @deepseek-ai/* regressions) and
 * apply() must tolerate a stub ctx without a settings service.
 */
import { apply, SETTINGS_NAMESPACE, SETTINGS_SCHEMA } from '../plugins/dsh-desktop-features/lib/index.js'

if (typeof apply !== 'function') throw new Error('apply export missing')
if (SETTINGS_NAMESPACE !== 'desktop-features') {
  throw new Error(`unexpected namespace: ${SETTINGS_NAMESPACE}`)
}
if (typeof SETTINGS_SCHEMA !== 'function' && typeof SETTINGS_SCHEMA !== 'object') {
  throw new Error('SETTINGS_SCHEMA must be a schemastery schema')
}

// Stub ctx without a settings service: apply must no-op, not throw.
const ctx = { inject: undefined }
apply(ctx, {})

// Stub ctx without inject at all (same class of stub as host config tests).
apply({}, {})

console.log('features host smoke test: all assertions passed')

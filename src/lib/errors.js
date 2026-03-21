import { scrubKeys } from './utils.js'

/**
 * Centralized error logger — scrubs API keys before logging.
 * Usage: logError('Pipeline', err)
 */
export function logError(context, error) {
  var msg = scrubKeys(String(error && error.message || error || 'Unknown error'))
  console.error('[' + context + '] ' + msg)
}

/**
 * Centralized warning logger — scrubs API keys before logging.
 * Usage: logWarn('GitHub', 'branch not found')
 */
export function logWarn(context, msg) {
  console.warn('[' + context + '] ' + scrubKeys(String(msg)))
}

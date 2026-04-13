import { ST } from './state.js'
import { getSupabaseUrl } from './supabase.js'

var APPROVED_KEY_DOMAINS = [
  'api.anthropic.com',
  'api.openai.com',
  'api.github.com',
  'stitch.googleapis.com',
  'api.groq.com',
  'generativelanguage.googleapis.com',
]

export var _nativeFetch = window.fetch

export function _validateKeyedRequest(url, opts) {
  var headersObj = (opts && opts.headers) || {}
  var sensitiveValues = [
    ST.key,
    ST.gptKey,
    ST.stitchKey,
    ST.groqKey,
    ST.geminiKey,
    ST.ghToken,
    ST.sbAnon,
    ST.sbApiKey,
  ].filter(function (v) {
    return v && v.length > 8
  })
  var hasKeyInHeaders = sensitiveValues.some(function (v) {
    var vals = Object.values(headersObj)
    return vals.some(function (h) {
      return String(h).indexOf(v) >= 0
    })
  })
  if (!hasKeyInHeaders) return
  var destOk = false
  try {
    var dest = new URL(String(url))
    destOk = APPROVED_KEY_DOMAINS.some(function (d) {
      return dest.hostname === d || dest.hostname.endsWith('.' + d)
    })
    if (!destOk && ST.sbUrl) {
      try {
        var sbHost = new URL(ST.sbUrl).hostname
        destOk = dest.hostname === sbHost
      } catch (e) {}
    }
    // Also allow the env-configured Supabase URL (for supabase-js SDK calls)
    if (!destOk) {
      try {
        var envUrl = getSupabaseUrl()
        if (envUrl) {
          var envHost = new URL(envUrl).hostname
          destOk = dest.hostname === envHost
        }
      } catch (e) {}
    }
  } catch (e) {
    destOk = false
  }
  if (!destOk) {
    throw new Error('[KEY GUARD] Blocked: credentials sent to unexpected domain')
  }
}

// Override global fetch
window.fetch = function (url, opts) {
  opts = opts || {}
  try {
    _validateKeyedRequest(url, opts)
  } catch (e) {
    return Promise.reject(e)
  }
  return _nativeFetch.apply(this, arguments)
}

import { ST } from './state.js'
import { scrubKeys } from './utils.js'
import { _nativeFetch, _validateKeyedRequest } from './key-guard.js'
import { SYS_AUDIT, SYS_ENHANCE_REVIEW, SYS_CLASSIFY, SYS_CHAT } from '../config/prompts.js'

function claudeHeaders() {
  return { 'Content-Type': 'application/json', 'x-api-key': ST.key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'prompt-caching-2024-07-31', 'anthropic-dangerous-direct-browser-access': 'true' }
}

function logCacheUsage(d, label) {
  if (d && d.usage) {
    var u = d.usage
    var cached = u.cache_read_input_tokens || 0
    var created = u.cache_creation_input_tokens || 0
    var total = u.input_tokens || 0
    if (cached > 0 || created > 0) {
      console.log('[Cache ' + (label || 'Claude') + '] input=' + total + ' cached=' + cached + ' created=' + created + ' savings~' + (total > 0 ? Math.round(cached / total * 100) : 0) + '%')
    }
  }
}

// Background-aware timeout: pauses the countdown while the page is hidden
// so that browser timer throttling doesn't cause premature timeouts.
export function fetchWithTimeout(url, opts, ms) {
  ms = ms || 300000 // 5 min default (up from 2 min)
  _validateKeyedRequest(url, opts)
  var controller = new AbortController()
  if (!opts.signal) {
    opts = Object.assign({}, opts, { signal: controller.signal })
  }
  var elapsed = 0
  var lastTick = Date.now()
  var timer = null
  var settled = false

  function tick() {
    if (settled) return
    var now = Date.now()
    // Only count time while page is visible (hidden tabs throttle timers)
    if (document.visibilityState === 'visible') {
      elapsed += now - lastTick
    }
    lastTick = now
    if (elapsed >= ms) {
      controller.abort()
      return
    }
    timer = setTimeout(tick, 1000)
  }
  tick()

  return _nativeFetch.call(window, url, opts).then(
    function (r) { settled = true; clearTimeout(timer); return r },
    function (e) {
      settled = true; clearTimeout(timer)
      if (e && e.name === 'AbortError') throw new Error('Request timed out')
      throw e
    }
  )
}

export function fetchWithRetry(url, opts, ms, retries) {
  retries = retries || 4 // up from 2
  function attempt(n) {
    return fetchWithTimeout(url, opts, ms).catch(function (e) {
      var msg = String(e && e.message || e || '').toLowerCase()
      var isRetryable = msg.indexOf('failed to fetch') >= 0
        || msg.indexOf('load failed') >= 0
        || msg.indexOf('timed out') >= 0
        || msg.indexOf('network') >= 0
        || msg.indexOf('aborted') >= 0
        || msg.indexOf('err_internet_disconnected') >= 0
      if (isRetryable && n < retries) {
        var delay = Math.min(2000 * Math.pow(2, n), 30000) // 2s, 4s, 8s, 16s (exp backoff, cap 30s)
        return new Promise(function (resolve) { setTimeout(resolve, delay) }).then(function () {
          // If we were hidden when the error happened, wait until visible before retrying
          if (document.visibilityState !== 'visible') {
            return new Promise(function (resolve) {
              function onVisible() {
                if (document.visibilityState === 'visible') {
                  document.removeEventListener('visibilitychange', onVisible)
                  resolve()
                }
              }
              document.addEventListener('visibilitychange', onVisible)
            })
          }
        }).then(function () { return attempt(n + 1) })
      }
      throw e
    })
  }
  return attempt(0)
}

export function classifyFetchError(e, api) {
  var msg = String(e && e.message || e || '')
  if (msg.indexOf('timed out') >= 0) return api + ': Request timed out.'
  if (msg.toLowerCase().indexOf('load failed') >= 0 || msg.toLowerCase().indexOf('failed to fetch') >= 0)
    return api + ': Network error \u2014 check your internet connection.'
  return api + ': ' + msg
}

export function callClaude(sys, msg, temperature) {
  temperature = temperature !== undefined ? temperature : 0.3
  return fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: claudeHeaders(),
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 16000, temperature: temperature, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: msg }] }),
  }, 300000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
    logCacheUsage(d, 'callClaude')
    var code = (d.content && d.content[0] && d.content[0].text) || ''
    code = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
    var docIdx = code.indexOf('<!DOCTYPE')
    if (docIdx < 0) docIdx = code.indexOf('<!doctype')
    if (docIdx < 0) docIdx = code.indexOf('<html')
    if (docIdx > 0) code = code.substring(docIdx)
    if (code.indexOf('<html') < 0 && code.indexOf('<!DOCTYPE') < 0 && code.indexOf('<!doctype') < 0) throw new Error('Claude returned an unexpected response format')
    return code
  }).catch(function (e) {
    if (e.message && e.message.indexOf('Claude:') === 0) throw e
    throw new Error(classifyFetchError(e, 'Claude'))
  })
}

export function callClaudeWithThinking(sys, msg, thinkingBudget) {
  thinkingBudget = thinkingBudget || 2000
  var maxTokens = thinkingBudget + 16000
  return fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: claudeHeaders(),
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, thinking: { type: 'enabled', budget_tokens: thinkingBudget }, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: msg }] }),
  }, 600000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
    logCacheUsage(d, 'callClaudeWithThinking')
    var code = ''
    if (d.content && Array.isArray(d.content)) {
      for (var i = 0; i < d.content.length; i++) {
        if (d.content[i].type === 'text') { code = d.content[i].text; break }
      }
    }
    code = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
    if (code.indexOf('<html') < 0 && code.indexOf('<!DOCTYPE') < 0) throw new Error('Claude returned an unexpected response format')
    return code
  }).catch(function (e) {
    if (e.message && e.message.indexOf('Claude:') === 0) throw e
    throw new Error(classifyFetchError(e, 'Claude'))
  })
}

export function callClaudeRaw(sys, msg, maxTokens, images) {
  maxTokens = maxTokens || 4000
  var userContent = _buildUserContent(msg, images)
  return fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: claudeHeaders(),
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: userContent }] }),
  }, 120000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
    logCacheUsage(d, 'callClaudeRaw')
    var raw = (d.content && d.content[0] && d.content[0].text) || ''
    return raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
  }).catch(function (e) {
    if (e.message && e.message.indexOf('Claude:') === 0) throw e
    throw new Error(classifyFetchError(e, 'Claude'))
  })
}

export function callClaudeMultiTurn(sys, messages, temperature) {
  temperature = temperature !== undefined ? temperature : 0.3
  return fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: claudeHeaders(),
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 16000, temperature: temperature, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: messages }),
  }, 300000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
    logCacheUsage(d, 'callClaudeMultiTurn')
    var code = (d.content && d.content[0] && d.content[0].text) || ''
    code = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
    var docIdx = code.indexOf('<!DOCTYPE')
    if (docIdx < 0) docIdx = code.indexOf('<!doctype')
    if (docIdx < 0) docIdx = code.indexOf('<html')
    if (docIdx > 0) code = code.substring(docIdx)
    if (code.indexOf('<html') < 0 && code.indexOf('<!DOCTYPE') < 0 && code.indexOf('<!doctype') < 0) throw new Error('Claude returned an unexpected response format')
    return code
  }).catch(function (e) {
    if (e.message && e.message.indexOf('Claude:') === 0) throw e
    throw new Error(classifyFetchError(e, 'Claude'))
  })
}

export function callClaudeRawMultiTurn(sys, messages, maxTokens) {
  maxTokens = maxTokens || 4000
  return fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: claudeHeaders(),
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: messages }),
  }, 60000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
    logCacheUsage(d, 'callClaudeRawMultiTurn')
    var raw = (d.content && d.content[0] && d.content[0].text) || ''
    return raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
  }).catch(function (e) {
    if (e.message && e.message.indexOf('Claude:') === 0) throw e
    throw new Error(classifyFetchError(e, 'Claude'))
  })
}

// Build user content array with optional images for Claude vision
function _buildUserContent(msg, images) {
  if (!images || !images.length) return msg
  var content = []
  for (var i = 0; i < images.length; i++) {
    content.push({ type: 'image', source: { type: 'base64', media_type: images[i].mediaType, data: images[i].base64 } })
  }
  content.push({ type: 'text', text: msg })
  return content
}

export function callClaudeWithThinkingStream(sys, msg, thinkingBudget, onChunk, images) {
  thinkingBudget = thinkingBudget || 2000
  var maxTokens = thinkingBudget + 16000

  function parseSSE(responseBody) {
    var reader = responseBody.getReader()
    var decoder = new TextDecoder()
    var buffer = ''
    var fullText = ''

    function processChunks() {
      return reader.read().then(function (result) {
        if (result.done) return fullText

        buffer += decoder.decode(result.value, { stream: true })
        var lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim()
          if (line.indexOf('data: ') !== 0) continue
          var data = line.substring(6)
          if (data === '[DONE]') continue

          try {
            var evt = JSON.parse(data)
            if (evt.type === 'content_block_delta') {
              if (evt.delta && evt.delta.type === 'text_delta' && evt.delta.text) {
                fullText += evt.delta.text
                if (onChunk) onChunk('text', evt.delta.text)
              } else if (evt.delta && evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
                if (onChunk) onChunk('thinking', evt.delta.thinking)
              }
            } else if (evt.type === 'message_delta' && evt.usage) {
              logCacheUsage({ usage: evt.usage }, 'callClaudeStream')
            } else if (evt.type === 'message_start' && evt.message) {
              logCacheUsage(evt.message, 'callClaudeStream')
            } else if (evt.type === 'error') {
              throw new Error('Claude stream error: ' + (evt.error && evt.error.message || 'unknown'))
            }
          } catch (parseErr) {
            if (parseErr.message && parseErr.message.indexOf('Claude stream error') === 0) throw parseErr
          }
        }

        return processChunks()
      })
    }

    return processChunks()
  }

  var userContent = _buildUserContent(msg, images)
  var url = 'https://api.anthropic.com/v1/messages'
  var opts = {
    method: 'POST',
    headers: claudeHeaders(),
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, stream: true, thinking: { type: 'enabled', budget_tokens: thinkingBudget }, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: userContent }] }),
  }

  _validateKeyedRequest(url, opts)

  function attemptStream(n) {
    return _nativeFetch.call(window, url, opts).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
      return parseSSE(r.body)
    }).then(function (code) {
      code = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
      if (code.indexOf('<html') < 0 && code.indexOf('<!DOCTYPE') < 0) throw new Error('Claude returned an unexpected response format')
      return code
    }).catch(function (e) {
      if (e.message && e.message.indexOf('Claude:') === 0) throw e
      var msg2 = String(e && e.message || e || '').toLowerCase()
      var isRetryable = msg2.indexOf('failed to fetch') >= 0 || msg2.indexOf('load failed') >= 0 || msg2.indexOf('network') >= 0 || msg2.indexOf('aborted') >= 0 || msg2.indexOf('timed out') >= 0
      if (isRetryable && n < 3) {
        var delay = Math.min(2000 * Math.pow(2, n), 16000)
        console.warn('Stream attempt ' + (n + 1) + ' failed, retrying in ' + delay + 'ms:', e.message)
        return new Promise(function (resolve) { setTimeout(resolve, delay) }).then(function () {
          if (document.visibilityState !== 'visible') {
            return new Promise(function (resolve) {
              function onVis() { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', onVis); resolve() } }
              document.addEventListener('visibilitychange', onVis)
            })
          }
        }).then(function () { return attemptStream(n + 1) })
      }
      // Fall back to non-streaming on persistent stream errors
      console.warn('Streaming failed, falling back to non-streaming:', e.message)
      return callClaudeWithThinking(sys, _buildUserContent(msg, images), thinkingBudget)
    })
  }

  return attemptStream(0)
}

export function callClaudeAudit(code) {
  return callClaudeRaw(SYS_AUDIT, 'Audit:\n\n' + code.slice(0, 40000), 2000)
    .then(function (raw) {
      try { var p = JSON.parse(raw); return Array.isArray(p) ? p : [] }
      catch (e) { return [] }
    })
}

export function callClaudeEnhanceReview(code) {
  return callClaudeRaw(SYS_ENHANCE_REVIEW, 'Review this app and suggest enhancements and identify bugs:\n\n' + code.slice(0, 40000), 3000)
    .then(function (raw) {
      try { var p = JSON.parse(raw); return { enhancements: Array.isArray(p.enhancements) ? p.enhancements : [], bugs: Array.isArray(p.bugs) ? p.bugs : [] } }
      catch (e) { return { enhancements: [], bugs: [] } }
    })
}

export function callGPTRawMultiTurn(sys, messages, maxTokens) {
  maxTokens = maxTokens || 4000
  return fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ST.gptKey },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: maxTokens, temperature: 0.3, messages: [{ role: 'system', content: sys }].concat(messages) }),
  }, 120000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('GPT: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
    var raw = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || ''
    return raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
  }).catch(function (e) {
    if (e.message && e.message.indexOf('GPT:') === 0) throw e
    throw new Error(classifyFetchError(e, 'GPT'))
  })
}

export function callGPTReview(code) {
  return fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ST.gptKey },
    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 3000, temperature: 0.2, messages: [{ role: 'system', content: SYS_ENHANCE_REVIEW }, { role: 'user', content: 'Review this app and suggest enhancements and identify bugs:\n\n' + code.slice(0, 40000) }] }),
  }, 120000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('GPT: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
    var raw = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '{}'
    raw = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
    try { var p = JSON.parse(raw); return { enhancements: Array.isArray(p.enhancements) ? p.enhancements : [], bugs: Array.isArray(p.bugs) ? p.bugs : [] } } catch (e) { return { enhancements: [], bugs: [] } }
  }).catch(function (e) {
    if (e.message && e.message.indexOf('GPT:') === 0) throw e
    throw new Error(classifyFetchError(e, 'GPT'))
  })
}

export function callGPT(code) {
  return fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ST.gptKey },
    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 2000, temperature: 0.1, messages: [{ role: 'system', content: SYS_AUDIT }, { role: 'user', content: 'Audit:\n\n' + code.slice(0, 40000) }] }),
  }, 120000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('GPT: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
    var raw = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '[]'
    raw = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
    try { var p = JSON.parse(raw); return Array.isArray(p) ? p : [] } catch (e) { return [] }
  }).catch(function (e) {
    if (e.message && e.message.indexOf('GPT:') === 0) throw e
    throw new Error(classifyFetchError(e, 'GPT'))
  })
}

export function classifyIntent(msg) {
  return callClaudeRaw(SYS_CLASSIFY, msg, 100).then(function (raw) {
    try {
      var parsed = JSON.parse(raw)
      return (parsed.intent === 'chat') ? 'chat' : 'build'
    } catch (e) {
      return 'build'
    }
  }).catch(function () {
    return 'build'
  })
}

export function callClaudeChat(msg) {
  return callClaudeRaw(SYS_CHAT, msg, 2000)
}

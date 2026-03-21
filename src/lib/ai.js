import { ST } from './state.js'
import { scrubKeys } from './utils.js'
import { logWarn } from './errors.js'
import { _nativeFetch, _validateKeyedRequest } from './key-guard.js'
import { SYS_AUDIT, SYS_ENHANCE_REVIEW, SYS_CLASSIFY, SYS_CHAT } from '../config/prompts.js'
import { CLAUDE_MODEL, GPT_MODEL, GPT_MINI_MODEL, GPT_THINK_MODEL, ANTHROPIC_API_URL, OPENAI_API_URL } from '../config/constants.js'

function claudeHeaders() {
  return { 'Content-Type': 'application/json', 'x-api-key': ST.key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'prompt-caching-2024-07-31', 'anthropic-dangerous-direct-browser-access': 'true' }
}

function gptHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ST.gptKey }
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

// --- Shared response parsing helpers ---

// Strip markdown code fences from AI responses
function stripFences(text) {
  return text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
}

// Extract HTML code from response, stripping any preamble before DOCTYPE/html
function extractHTML(code, provider) {
  code = stripFences(code)
  var docIdx = code.indexOf('<!DOCTYPE')
  if (docIdx < 0) docIdx = code.indexOf('<!doctype')
  if (docIdx < 0) docIdx = code.indexOf('<html')
  if (docIdx > 0) code = code.substring(docIdx)
  if (code.indexOf('<html') < 0 && code.indexOf('<!DOCTYPE') < 0 && code.indexOf('<!doctype') < 0) {
    throw new Error((provider || 'AI') + ' returned an unexpected response format')
  }
  return code
}

// Extract raw text from Claude response
function extractClaudeText(d) {
  return (d.content && d.content[0] && d.content[0].text) || ''
}

// Extract raw text from GPT response
function extractGPTText(d) {
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || ''
}

// Handle Claude API error responses
function handleClaudeError(r) {
  if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
  return r.json()
}

// Handle GPT API error responses
function handleGPTError(r) {
  if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('GPT: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
  return r.json()
}

// Wrap catch for Claude calls
function claudeCatch(e) {
  if (e.message && e.message.indexOf('Claude:') === 0) throw e
  throw new Error(classifyFetchError(e, 'Claude'))
}

// Wrap catch for GPT calls
function gptCatch(e) {
  if (e.message && e.message.indexOf('GPT:') === 0) throw e
  throw new Error(classifyFetchError(e, 'GPT'))
}

// Check if an error is retryable (network/timeout)
function isRetryableError(msg) {
  msg = msg.toLowerCase()
  return msg.indexOf('failed to fetch') >= 0
    || msg.indexOf('load failed') >= 0
    || msg.indexOf('timed out') >= 0
    || msg.indexOf('network') >= 0
    || msg.indexOf('aborted') >= 0
    || msg.indexOf('err_internet_disconnected') >= 0
}

// Wait for page to become visible before retrying
function waitForVisibility() {
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
  return Promise.resolve()
}

// --- Cost accumulator ---
var _costAccum = { calls: [] }

export function resetCostAccum() { _costAccum = { calls: [] } }
export function getCostAccum() { return _costAccum }

function trackUsage(label, model, usage) {
  if (!usage) return
  _costAccum.calls.push({
    label: label,
    model: model,
    input: usage.input_tokens || usage.prompt_tokens || 0,
    output: usage.output_tokens || usage.completion_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    cacheWrite: usage.cache_creation_input_tokens || 0,
  })
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
  retries = retries || 4
  function attempt(n) {
    return fetchWithTimeout(url, opts, ms).catch(function (e) {
      var msg = String(e && e.message || e || '')
      if (isRetryableError(msg) && n < retries) {
        var delay = Math.min(2000 * Math.pow(2, n), 30000)
        return new Promise(function (resolve) { setTimeout(resolve, delay) })
          .then(function () { return waitForVisibility() })
          .then(function () { return attempt(n + 1) })
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
  return fetchWithRetry(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: claudeHeaders(),
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 16000, temperature: temperature, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: msg }] }),
  }, 300000).then(handleClaudeError).then(function (d) {
    logCacheUsage(d, 'callClaude')
    trackUsage('Build', CLAUDE_MODEL, d.usage)
    return extractHTML(extractClaudeText(d), 'Claude')
  }).catch(claudeCatch)
}

export function callClaudeWithThinking(sys, msg, thinkingBudget) {
  thinkingBudget = thinkingBudget || 2000
  var maxTokens = thinkingBudget + 16000
  return fetchWithRetry(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: claudeHeaders(),
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, thinking: { type: 'enabled', budget_tokens: thinkingBudget }, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: msg }] }),
  }, 600000).then(handleClaudeError).then(function (d) {
    logCacheUsage(d, 'callClaudeWithThinking')
    trackUsage('Build (thinking)', CLAUDE_MODEL, d.usage)
    var code = ''
    if (d.content && Array.isArray(d.content)) {
      for (var i = 0; i < d.content.length; i++) {
        if (d.content[i].type === 'text') { code = d.content[i].text; break }
      }
    }
    return extractHTML(code, 'Claude')
  }).catch(claudeCatch)
}

export function callClaudeRaw(sys, msg, maxTokens, images) {
  maxTokens = maxTokens || 4000
  var userContent = _buildUserContent(msg, images)
  return fetchWithRetry(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: claudeHeaders(),
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: userContent }] }),
  }, 120000).then(handleClaudeError).then(function (d) {
    logCacheUsage(d, 'callClaudeRaw')
    trackUsage('Claude Raw', CLAUDE_MODEL, d.usage)
    return stripFences(extractClaudeText(d))
  }).catch(claudeCatch)
}

export function callClaudeMultiTurn(sys, messages, temperature) {
  temperature = temperature !== undefined ? temperature : 0.3
  return fetchWithRetry(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: claudeHeaders(),
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 16000, temperature: temperature, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: messages }),
  }, 300000).then(handleClaudeError).then(function (d) {
    logCacheUsage(d, 'callClaudeMultiTurn')
    trackUsage('Fix', CLAUDE_MODEL, d.usage)
    return extractHTML(extractClaudeText(d), 'Claude')
  }).catch(claudeCatch)
}

export function callClaudeRawMultiTurn(sys, messages, maxTokens) {
  maxTokens = maxTokens || 4000
  return fetchWithRetry(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: claudeHeaders(),
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: messages }),
  }, 60000).then(handleClaudeError).then(function (d) {
    logCacheUsage(d, 'callClaudeRawMultiTurn')
    trackUsage('Claude Multi', CLAUDE_MODEL, d.usage)
    return stripFences(extractClaudeText(d))
  }).catch(claudeCatch)
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
              _streamUsage.output_tokens = (_streamUsage.output_tokens || 0) + (evt.usage.output_tokens || 0)
            } else if (evt.type === 'message_start' && evt.message) {
              logCacheUsage(evt.message, 'callClaudeStream')
              if (evt.message.usage) {
                _streamUsage.input_tokens = evt.message.usage.input_tokens || 0
                _streamUsage.cache_read_input_tokens = evt.message.usage.cache_read_input_tokens || 0
                _streamUsage.cache_creation_input_tokens = evt.message.usage.cache_creation_input_tokens || 0
              }
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
  var url = ANTHROPIC_API_URL
  var opts = {
    method: 'POST',
    headers: claudeHeaders(),
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, stream: true, thinking: { type: 'enabled', budget_tokens: thinkingBudget }, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: userContent }] }),
  }

  _validateKeyedRequest(url, opts)

  var _streamUsage = {}

  function attemptStreamDirect(n) {
    return _nativeFetch.call(window, url, opts).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
      return parseSSE(r.body)
    }).then(function (code) {
      trackUsage('Build (stream)', CLAUDE_MODEL, _streamUsage)
      return extractHTML(code, 'Claude')
    }).catch(function (e) {
      if (e.message && e.message.indexOf('Claude:') === 0) throw e
      var msg2 = String(e && e.message || e || '')
      if (isRetryableError(msg2) && n < 3) {
        var delay = Math.min(2000 * Math.pow(2, n), 16000)
        console.warn('Stream attempt ' + (n + 1) + ' failed, retrying in ' + delay + 'ms:', e.message)
        return new Promise(function (resolve) { setTimeout(resolve, delay) })
          .then(function () { return waitForVisibility() })
          .then(function () { return attemptStreamDirect(n + 1) })
      }
      // Fall back to non-streaming on persistent stream errors
      console.warn('Streaming failed, falling back to non-streaming:', e.message)
      return callClaudeWithThinking(sys, _buildUserContent(msg, images), thinkingBudget)
    })
  }

  return attemptStreamDirect(0)
}

export function callClaudeAudit(code, customSysPrompt) {
  return callClaudeRaw(customSysPrompt || SYS_AUDIT, 'Audit:\n\n' + code.slice(0, 40000), 2000)
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
  return fetchWithRetry(OPENAI_API_URL, {
    method: 'POST',
    headers: gptHeaders(),
    body: JSON.stringify({ model: GPT_MINI_MODEL, max_tokens: maxTokens, temperature: 0.3, messages: [{ role: 'system', content: sys }].concat(messages) }),
  }, 120000).then(handleGPTError).then(function (d) {
    trackUsage('GPT Multi', GPT_MINI_MODEL, d.usage)
    return stripFences(extractGPTText(d))
  }).catch(gptCatch)
}

export function callGPTThink(sys, messages, maxTokens) {
  maxTokens = maxTokens || 4000
  return fetchWithRetry(OPENAI_API_URL, {
    method: 'POST',
    headers: gptHeaders(),
    body: JSON.stringify({ model: GPT_THINK_MODEL, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: sys }].concat(messages) }),
  }, 120000).then(handleGPTError).then(function (d) {
    trackUsage('GPT Think', GPT_THINK_MODEL, d.usage)
    return stripFences(extractGPTText(d))
  }).catch(gptCatch)
}

export function callGPTReview(code) {
  return fetchWithRetry(OPENAI_API_URL, {
    method: 'POST',
    headers: gptHeaders(),
    body: JSON.stringify({ model: GPT_MODEL, max_tokens: 3000, temperature: 0.2, messages: [{ role: 'system', content: SYS_ENHANCE_REVIEW }, { role: 'user', content: 'Review this app and suggest enhancements and identify bugs:\n\n' + code.slice(0, 40000) }] }),
  }, 120000).then(handleGPTError).then(function (d) {
    trackUsage('GPT Review', GPT_MODEL, d.usage)
    var raw = stripFences(extractGPTText(d) || '{}')
    try { var p = JSON.parse(raw); return { enhancements: Array.isArray(p.enhancements) ? p.enhancements : [], bugs: Array.isArray(p.bugs) ? p.bugs : [] } } catch (e) { return { enhancements: [], bugs: [] } }
  }).catch(gptCatch)
}

export function callGPT(code) {
  return fetchWithRetry(OPENAI_API_URL, {
    method: 'POST',
    headers: gptHeaders(),
    body: JSON.stringify({ model: GPT_MODEL, max_tokens: 2000, temperature: 0.1, messages: [{ role: 'system', content: SYS_AUDIT }, { role: 'user', content: 'Audit:\n\n' + code.slice(0, 40000) }] }),
  }, 120000).then(handleGPTError).then(function (d) {
    trackUsage('GPT Audit', GPT_MODEL, d.usage)
    var raw = stripFences(extractGPTText(d) || '[]')
    try { var p = JSON.parse(raw); return Array.isArray(p) ? p : [] } catch (e) { return [] }
  }).catch(gptCatch)
}

// --- GPT equivalents for Website2 provider toggle ---

function _gptBuildUserContent(msg, images) {
  if (!images || !images.length) return [{ type: 'text', text: msg }]
  var content = []
  for (var i = 0; i < images.length; i++) {
    content.push({ type: 'image_url', image_url: { url: 'data:' + images[i].mediaType + ';base64,' + images[i].base64 } })
  }
  content.push({ type: 'text', text: msg })
  return content
}

export function callGPTRaw2(sys, msg, maxTokens, images) {
  maxTokens = maxTokens || 4000
  var userContent = (images && images.length) ? _gptBuildUserContent(msg, images) : msg
  return fetchWithRetry(OPENAI_API_URL, {
    method: 'POST',
    headers: gptHeaders(),
    body: JSON.stringify({ model: GPT_MODEL, max_tokens: maxTokens, temperature: 0.3, messages: [{ role: 'system', content: sys }, { role: 'user', content: userContent }] }),
  }, 120000).then(handleGPTError).then(function (d) {
    trackUsage('GPT Raw', GPT_MODEL, d.usage)
    return stripFences(extractGPTText(d))
  }).catch(gptCatch)
}

export function callGPTMultiTurn2(sys, messages, temperature) {
  temperature = temperature !== undefined ? temperature : 0.3
  return fetchWithRetry(OPENAI_API_URL, {
    method: 'POST',
    headers: gptHeaders(),
    body: JSON.stringify({ model: GPT_MODEL, max_tokens: 16000, temperature: temperature, messages: [{ role: 'system', content: sys }].concat(messages) }),
  }, 300000).then(handleGPTError).then(function (d) {
    trackUsage('GPT Build', GPT_MODEL, d.usage)
    return extractHTML(extractGPTText(d), 'GPT')
  }).catch(gptCatch)
}

export function callGPTWithStream(sys, msg, onChunk, images) {
  var userContent = (images && images.length) ? _gptBuildUserContent(msg, images) : msg
  var url = OPENAI_API_URL
  var opts = {
    method: 'POST',
    headers: gptHeaders(),
    body: JSON.stringify({ model: GPT_MODEL, max_tokens: 16000, stream: true, temperature: 0.3, messages: [{ role: 'system', content: sys }, { role: 'user', content: userContent }] }),
  }

  _validateKeyedRequest(url, opts)

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
            if (evt.choices && evt.choices[0] && evt.choices[0].delta && evt.choices[0].delta.content) {
              var chunk = evt.choices[0].delta.content
              fullText += chunk
              if (onChunk) onChunk('text', chunk)
            }
          } catch (parseErr) { logWarn('GPT-SSE', parseErr.message) }
        }
        return processChunks()
      })
    }
    return processChunks()
  }

  function attemptStream(n) {
    return _nativeFetch.call(window, url, opts).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('GPT: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
      return parseSSE(r.body)
    }).then(function (code) {
      // Estimate tokens for GPT stream (usage not available in default stream mode)
      trackUsage('GPT Build (stream)', GPT_MODEL, { prompt_tokens: Math.ceil(msg.length / 4) + Math.ceil(sys.length / 4), completion_tokens: Math.ceil(code.length / 4) })
      return extractHTML(code, 'GPT')
    }).catch(function (e) {
      if (e.message && e.message.indexOf('GPT:') === 0) throw e
      var msg2 = String(e && e.message || e || '')
      if (isRetryableError(msg2) && n < 3) {
        var delay = Math.min(2000 * Math.pow(2, n), 16000)
        return new Promise(function (resolve) { setTimeout(resolve, delay) })
          .then(function () { return waitForVisibility() })
          .then(function () { return attemptStream(n + 1) })
      }
      throw new Error(classifyFetchError(e, 'GPT'))
    })
  }

  return attemptStream(0)
}

export function callGPTAudit2(code, customSysPrompt) {
  return callGPTRaw2(customSysPrompt || SYS_AUDIT, 'Audit:\n\n' + code.slice(0, 40000), 2000)
    .then(function (raw) {
      try { var p = JSON.parse(raw); return Array.isArray(p) ? p : [] }
      catch (e) { return [] }
    })
}

export function classifyIntent(msg, images) {
  return callClaudeRaw(SYS_CLASSIFY, msg, 100, images).then(function (raw) {
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

export function callClaudeChat(msg, images) {
  return callClaudeRaw(SYS_CHAT, msg, 2000, images)
}

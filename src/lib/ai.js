import { ST } from './state.js'
import { scrubKeys } from './utils.js'
import { _nativeFetch, _validateKeyedRequest } from './key-guard.js'
import { SYS_AUDIT, SYS_ENHANCE_REVIEW } from '../config/prompts.js'

export function fetchWithTimeout(url, opts, ms) {
  ms = ms || 120000
  _validateKeyedRequest(url, opts)
  var timer
  var req = _nativeFetch.call(window, url, opts).then(function (r) { clearTimeout(timer); return r }, function (e) { clearTimeout(timer); throw e })
  var timeout = new Promise(function (_, reject) {
    timer = setTimeout(function () { reject(new Error('Request timed out')) }, ms)
  })
  return Promise.race([req, timeout])
}

export function fetchWithRetry(url, opts, ms, retries) {
  retries = retries || 2
  function attempt(n) {
    return fetchWithTimeout(url, opts, ms).catch(function (e) {
      var msg = String(e && e.message || e || '').toLowerCase()
      var isNetwork = msg.indexOf('failed to fetch') >= 0 || msg.indexOf('load failed') >= 0 || msg.indexOf('timed out') >= 0 || msg.indexOf('network') >= 0
      if (isNetwork && n < retries) {
        return new Promise(function (resolve) { setTimeout(resolve, (n + 1) * 1500) }).then(function () { return attempt(n + 1) })
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
    headers: { 'Content-Type': 'application/json', 'x-api-key': ST.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 16000, temperature: temperature, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: msg }] }),
  }, 120000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
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
  thinkingBudget = thinkingBudget || 4000
  var maxTokens = thinkingBudget + 16000
  return fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ST.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, thinking: { type: 'enabled', budget_tokens: thinkingBudget }, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: msg }] }),
  }, 180000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
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

export function callClaudeRaw(sys, msg, maxTokens) {
  maxTokens = maxTokens || 4000
  return fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ST.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: msg }] }),
  }, 60000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
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
    headers: { 'Content-Type': 'application/json', 'x-api-key': ST.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 16000, temperature: temperature, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: messages }),
  }, 120000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
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
    headers: { 'Content-Type': 'application/json', 'x-api-key': ST.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: messages }),
  }, 60000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
    var raw = (d.content && d.content[0] && d.content[0].text) || ''
    return raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
  }).catch(function (e) {
    if (e.message && e.message.indexOf('Claude:') === 0) throw e
    throw new Error(classifyFetchError(e, 'Claude'))
  })
}

export function callClaudeWithThinkingStream(sys, msg, thinkingBudget, onChunk) {
  thinkingBudget = thinkingBudget || 4000
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

  var url = 'https://api.anthropic.com/v1/messages'
  var opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ST.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, stream: true, thinking: { type: 'enabled', budget_tokens: thinkingBudget }, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: msg }] }),
  }

  _validateKeyedRequest(url, opts)

  return _nativeFetch.call(window, url, opts).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} }).then(function (e) { throw new Error('Claude: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status)) })
    return parseSSE(r.body)
  }).then(function (code) {
    code = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
    if (code.indexOf('<html') < 0 && code.indexOf('<!DOCTYPE') < 0) throw new Error('Claude returned an unexpected response format')
    return code
  }).catch(function (e) {
    if (e.message && e.message.indexOf('Claude:') === 0) throw e
    // Fall back to non-streaming on stream errors
    console.warn('Streaming failed, falling back to non-streaming:', e.message)
    return callClaudeWithThinking(sys, msg, thinkingBudget)
  })
}

export function callGPTReview(code) {
  return fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ST.gptKey },
    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 3000, temperature: 0.2, messages: [{ role: 'system', content: SYS_ENHANCE_REVIEW }, { role: 'user', content: 'Review this app and suggest enhancements and identify bugs:\n\n' + code.slice(0, 40000) }] }),
  }, 60000).then(function (r) {
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
  }, 60000).then(function (r) {
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

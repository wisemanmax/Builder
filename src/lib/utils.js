import { GRADS } from '../config/constants.js'
import { ST } from './state.js'

export function $(id) {
  return document.getElementById(id)
}

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function validateKey(type, value) {
  if (!value || !value.trim()) return { valid: false, msg: 'Key is empty' }
  var v = value.trim()
  var patterns = {
    anthropic: { prefix: 'sk-ant-', minLen: 20 },
    openai: { prefix: 'sk-', minLen: 20 },
    github: { prefixes: ['ghp_', 'github_pat_'], minLen: 20 },
  }
  var p = patterns[type]
  if (!p) return { valid: true }
  if (v.length < p.minLen) return { valid: false, msg: 'Key looks too short' }
  if (p.prefix && v.indexOf(p.prefix) !== 0) return { valid: false, msg: 'Expected prefix: ' + p.prefix }
  if (
    p.prefixes &&
    !p.prefixes.some(function (px) {
      return v.indexOf(px) === 0
    })
  )
    return { valid: false, msg: 'Expected prefix: ' + p.prefixes.join(' or ') }
  return { valid: true }
}

export function slugify(str) {
  return (
    String(str)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'app'
  )
}

export function uniqueSlug(name) {
  var base = slugify(name)
  var id = base
  var n = 2
  while (
    ST.apps.some(function (a) {
      return a.id === id
    })
  ) {
    id = base + '-' + n
    n++
  }
  return id
}

export function grad(ci) {
  return GRADS[(((ci || 0) % GRADS.length) + GRADS.length) % GRADS.length] || GRADS[0]
}

export function toast(msg, ms) {
  ms = ms || 2900
  var el = $('toast')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toast._t)
  toast._t = setTimeout(function () {
    el.classList.remove('show')
  }, ms)
}

export function showScreen(id) {
  var screens = document.querySelectorAll('.screen')
  for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active')
  if (id) {
    var s = $('s-' + id)
    if (s) s.classList.add('active')
  }
}

export function fmtDate(iso) {
  if (!iso) return '\u2014'
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch (e) {
    return iso
  }
}

export function timeSince(iso) {
  if (!iso) return ''
  var s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

export function autoName(prompt) {
  var stop = [
    'a',
    'an',
    'the',
    'with',
    'and',
    'for',
    'to',
    'of',
    'that',
    'in',
    'on',
    'at',
    'my',
    'your',
    'build',
    'make',
    'create',
    'app',
  ]
  return (
    prompt
      .split(/\s+/)
      .filter(function (w) {
        return w.length > 2 && stop.indexOf(w.toLowerCase()) === -1
      })
      .slice(0, 3)
      .map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      })
      .join(' ') || 'My App'
  )
}

export function autoResize(el) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

export function autoResizeSe(el) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 100) + 'px'
}

export function redactKey(k) {
  if (!k || k.length < 8) return k ? '••••••••' : '(not set)'
  return k.slice(0, 6) + '••••••••' + k.slice(-4)
}

export function scrubKeys(str) {
  var s = String(str)
  ;[ST.key, ST.gptKey, ST.stitchKey, ST.ghToken, ST.sbAnon, ST.sbApiKey].forEach(function (k) {
    if (k && k.length > 8) s = s.split(k).join('[REDACTED]')
  })
  return s
}

export function copyToClipboard(text, label) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(text)
      .then(function () {
        toast((label || 'Text') + ' copied!')
      })
      .catch(function () {
        fallbackCopy(text, label)
      })
  } else {
    fallbackCopy(text, label)
  }
}

export function fallbackCopy(text, label) {
  try {
    var ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    toast((label || 'Text') + ' copied!')
  } catch (e) {
    toast('Could not copy', 4000)
  }
}

export function ghPageUrl(id) {
  return ST.ghCustomDomain
    ? 'https://' + ST.ghCustomDomain + '/apps/' + id + '.html'
    : ST.ghUser && ST.ghRepo
      ? 'https://' + ST.ghUser + '.github.io/' + ST.ghRepo + '/apps/' + id + '.html'
      : ''
}
export function ghApiUrl(path) {
  return 'https://api.github.com/repos/' + ST.ghUser + '/' + ST.ghRepo + '/contents/' + path
}
export function ghHeaders() {
  return {
    Authorization: 'token ' + ST.ghToken,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
  }
}

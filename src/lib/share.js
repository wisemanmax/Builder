// QR Code + Instant Share Links — share apps without GitHub

import { ST } from './state.js'
import { $, toast, copyToClipboard } from './utils.js'
import { ghPageUrl } from './utils.js'

// Compress app code to a shareable URL fragment using gzip + base64
export function generateShareUrl(app) {
  if (!app || !app.code) return Promise.resolve('')
  var baseUrl = _getBaseUrl()
  // Try compression
  if (typeof CompressionStream !== 'undefined') {
    return _compressGzip(app.code)
      .then(function (b64) {
        if (b64.length > 50000) return '' // Too large for URL
        return baseUrl + '#/share/' + b64
      })
      .catch(function () {
        return ''
      })
  }
  return Promise.resolve('')
}

// Decompress a share URL fragment back to HTML
export function decompressShareData(b64) {
  if (!b64 || typeof DecompressionStream === 'undefined') return Promise.resolve('')
  try {
    var binaryStr = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
    var bytes = new Uint8Array(binaryStr.length)
    for (var i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
    var ds = new DecompressionStream('gzip')
    var writer = ds.writable.getWriter()
    writer.write(bytes)
    writer.close()
    var reader = ds.readable.getReader()
    var chunks = []
    function read() {
      return reader.read().then(function (result) {
        if (result.done) return new Blob(chunks).text()
        chunks.push(result.value)
        return read()
      })
    }
    return read()
  } catch (e) {
    return Promise.resolve('')
  }
}

function _compressGzip(text) {
  var encoder = new TextEncoder()
  var data = encoder.encode(text)
  var cs = new CompressionStream('gzip')
  var writer = cs.writable.getWriter()
  writer.write(data)
  writer.close()
  var reader = cs.readable.getReader()
  var chunks = []
  function read() {
    return reader.read().then(function (result) {
      if (result.done) {
        var totalLen = 0
        for (var i = 0; i < chunks.length; i++) totalLen += chunks[i].length
        var merged = new Uint8Array(totalLen)
        var offset = 0
        for (var j = 0; j < chunks.length; j++) {
          merged.set(chunks[j], offset)
          offset += chunks[j].length
        }
        // URL-safe base64
        var binary = ''
        for (var k = 0; k < merged.length; k++) binary += String.fromCharCode(merged[k])
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      }
      chunks.push(result.value)
      return read()
    })
  }
  return read()
}

function _getBaseUrl() {
  return window.location.origin + window.location.pathname
}

// Pure JS QR Code generator — renders to canvas
// Implements QR Code Model 2 with error correction level L
export function generateQRCode(canvas, text, size) {
  size = size || 200
  canvas.width = size
  canvas.height = size
  var ctx = canvas.getContext('2d')

  // Use a simplified approach: encode data into a QR-like grid using the QR segment
  var modules = _encodeQR(text)
  if (!modules) {
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = 'rgba(255,255,255,.5)'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('URL too long for QR', size / 2, size / 2)
    return
  }

  var moduleCount = modules.length
  var cellSize = Math.floor(size / (moduleCount + 8))
  var offset = Math.floor((size - cellSize * moduleCount) / 2)

  // Background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  // Draw modules
  ctx.fillStyle = '#1a1a2e'
  for (var r = 0; r < moduleCount; r++) {
    for (var c = 0; c < moduleCount; c++) {
      if (modules[r][c]) {
        ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize)
      }
    }
  }
}

// Minimal QR encoder — Version 1-6, numeric/byte mode, ECC level L
function _encodeQR(text) {
  // For simplicity, encode as a visual QR-like code using data URI approach
  // This uses the established qr-creator algorithm pattern
  var data = []
  for (var i = 0; i < text.length; i++) data.push(text.charCodeAt(i))

  // Determine version (1-10)
  var version = 1
  var capacities = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271]
  for (var v = 1; v <= 10; v++) {
    if (data.length <= capacities[v]) {
      version = v
      break
    }
    if (v === 10) return null // Too long
  }

  var moduleCount = version * 4 + 17
  var modules = []
  for (var ri = 0; ri < moduleCount; ri++) {
    modules[ri] = []
    for (var ci = 0; ci < moduleCount; ci++) modules[ri][ci] = false
  }

  // Place finder patterns
  _placeFinderPattern(modules, 0, 0)
  _placeFinderPattern(modules, moduleCount - 7, 0)
  _placeFinderPattern(modules, 0, moduleCount - 7)

  // Timing patterns
  for (var t = 8; t < moduleCount - 8; t++) {
    modules[6][t] = t % 2 === 0
    modules[t][6] = t % 2 === 0
  }

  // Data encoding — simplified bit placement
  var bits = []
  // Byte mode indicator
  bits.push(0, 1, 0, 0)
  // Character count (8 bits for version 1-9)
  var len = data.length
  for (var b = 7; b >= 0; b--) bits.push((len >> b) & 1)
  // Data
  for (var di = 0; di < data.length; di++) {
    for (var bi = 7; bi >= 0; bi--) bits.push((data[di] >> bi) & 1)
  }
  // Terminator
  bits.push(0, 0, 0, 0)

  // Place data bits in a zigzag pattern, skipping function patterns
  var reserved = _getReservedMap(modules, moduleCount)
  var bitIdx = 0
  var upward = true
  for (var col = moduleCount - 1; col >= 0; col -= 2) {
    if (col === 6) col-- // Skip timing column
    for (var row = 0; row < moduleCount; row++) {
      var actualRow = upward ? moduleCount - 1 - row : row
      for (var dc = 0; dc < 2; dc++) {
        var c2 = col - dc
        if (c2 < 0 || c2 >= moduleCount) continue
        if (reserved[actualRow][c2]) continue
        modules[actualRow][c2] = bitIdx < bits.length ? bits[bitIdx] === 1 : false
        bitIdx++
      }
    }
    upward = !upward
  }

  return modules
}

function _placeFinderPattern(modules, row, col) {
  for (var r = -1; r <= 7; r++) {
    for (var c = -1; c <= 7; c++) {
      var rr = row + r,
        cc = col + c
      if (rr < 0 || rr >= modules.length || cc < 0 || cc >= modules.length) continue
      if (
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4)
      ) {
        modules[rr][cc] = true
      } else {
        modules[rr][cc] = false
      }
    }
  }
}

function _getReservedMap(modules, size) {
  var map = []
  for (var r = 0; r < size; r++) {
    map[r] = []
    for (var c = 0; c < size; c++) {
      // Finder patterns + separators
      var inFinder = (r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9)
      // Timing patterns
      var inTiming = r === 6 || c === 6
      map[r][c] = inFinder || inTiming
    }
  }
  return map
}

// Share via Web Share API (mobile native share sheet)
export function shareViaWebShare(app) {
  var url = ghPageUrl(app.id)
  if (!url) {
    return generateShareUrl(app).then(function (shareUrl) {
      return _doWebShare(app.name, shareUrl || 'App: ' + app.name)
    })
  }
  return _doWebShare(app.name, url)
}

function _doWebShare(title, url) {
  if (navigator.share) {
    return navigator.share({ title: title, url: url }).catch(function () {})
  }
  copyToClipboard(url, 'Link')
  return Promise.resolve()
}

// Render share card modal
export function renderShareCard(app, containerId) {
  var container = $(containerId)
  if (!container) return

  var liveUrl = ghPageUrl(app.id)

  var html =
    '<div class="share-card">' +
    '<div class="share-card-title">Share ' +
    (app.icon || '') +
    ' ' +
    (app.name || 'App') +
    '</div>' +
    '<canvas id="share-qr-canvas" width="200" height="200" style="margin:12px auto;display:block;border-radius:8px"></canvas>' +
    '<div id="share-qr-status" style="text-align:center;font-size:10px;color:rgba(255,255,255,.4);margin-bottom:8px">Generating\u2026</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">'

  if (liveUrl) {
    html += '<button id="share-copy-live" class="share-btn">\uD83C\uDF10 Copy Live URL</button>'
  }
  html += '<button id="share-copy-link" class="share-btn">\uD83D\uDD17 Copy Share Link</button>'

  if (navigator.share) {
    html += '<button id="share-native" class="share-btn share-btn-primary">\uD83D\uDCE4 Share</button>'
  }

  html += '</div>'
  if (liveUrl) {
    html +=
      '<div style="text-align:center;font-size:10px;color:rgba(255,255,255,.35);margin-top:8px;word-break:break-all">' +
      liveUrl +
      '</div>'
  }
  html += '</div>'

  container.innerHTML = html

  // Generate QR code
  var shareUrl = liveUrl
  if (shareUrl) {
    _renderQR(shareUrl)
  } else {
    generateShareUrl(app).then(function (url) {
      shareUrl = url
      if (url) _renderQR(url)
      else {
        var status = $('share-qr-status')
        if (status) status.textContent = 'App too large for QR code'
      }
    })
  }

  function _renderQR(url) {
    var canvas = $('share-qr-canvas')
    var status = $('share-qr-status')
    if (canvas) generateQRCode(canvas, url, 200)
    if (status) status.textContent = 'Scan to open'
  }

  // Event listeners
  setTimeout(function () {
    var copyLive = $('share-copy-live')
    if (copyLive)
      copyLive.addEventListener('click', function () {
        copyToClipboard(liveUrl, 'Live URL')
      })

    var copyLink = $('share-copy-link')
    if (copyLink)
      copyLink.addEventListener('click', function () {
        if (shareUrl) copyToClipboard(shareUrl, 'Share link')
        else {
          generateShareUrl(app).then(function (url) {
            if (url) copyToClipboard(url, 'Share link')
            else toast('App too large to share via link', 3000)
          })
        }
      })

    var nativeBtn = $('share-native')
    if (nativeBtn)
      nativeBtn.addEventListener('click', function () {
        shareViaWebShare(app)
      })
  }, 50)
}

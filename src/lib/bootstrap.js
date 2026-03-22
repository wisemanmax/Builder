/**
 * Bootstrap — error handlers and PWA setup, extracted from app.js
 */

export function setupErrorHandlers() {
  // Suppress only cross-origin/blob errors, log all others
  window.onerror = function (m, s, l, c, err) {
    if (String(m).includes('Script error') || String(s || '').includes('blob:')) return true
    console.error('[Builder] Uncaught error:', m, 'at', s, l + ':' + c, err)
    return false
  }
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason
    var msg = (reason && reason.message) || String(reason || '')
    if (msg === 'PIPELINE_CANCELLED') {
      e.preventDefault()
      return
    }
    console.warn('[Builder] Unhandled rejection:', reason)
  })
}

export function setupPwa() {
  var ref = { prompt: null }
  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {})
    } catch (e) {}
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault()
    ref.prompt = e
    setTimeout(function () {
      try {
        if (!localStorage.getItem('pwa_dis')) {
          var b = document.getElementById('install-banner')
          if (b) b.classList.add('on')
        }
      } catch (x) {}
    }, 800)
  })
  return ref
}

// Streaming Live Preview — renders partial HTML into an iframe as Claude streams it

var _controllers = {}

export function createStreamingPreview(iframeId) {
  var accumulated = ''
  var renderTimer = null
  var finalized = false
  var iframe = null

  function getIframe() {
    if (!iframe) iframe = document.getElementById(iframeId)
    return iframe
  }

  function safeHTML(partial) {
    // Suppress script execution during streaming by neutering <script> tags
    var safe = partial.replace(/<script/gi, '<script type="text/placeholder"')
    // Close any open tags at the end for valid rendering
    if (safe.indexOf('</html>') < 0) safe += '\n</html>'
    if (safe.indexOf('</body>') < 0) safe = safe.replace('</html>', '</body>\n</html>')
    return safe
  }

  var controller = {
    pushChunk: function (text) {
      if (finalized) return
      accumulated += text
      // Start rendering after enough CSS/HTML has arrived (~1500 chars)
      if (accumulated.length < 1500) return
      if (renderTimer) return
      renderTimer = setTimeout(function () {
        renderTimer = null
        controller.render()
      }, 400)
    },

    render: function () {
      if (finalized) return
      var el = getIframe()
      if (!el) return
      el.srcdoc = safeHTML(accumulated)
    },

    finalize: function (fullCode) {
      finalized = true
      if (renderTimer) {
        clearTimeout(renderTimer)
        renderTimer = null
      }
      var el = getIframe()
      if (!el) return
      el.srcdoc = fullCode
    },

    getAccumulated: function () {
      return accumulated
    },

    destroy: function () {
      finalized = true
      if (renderTimer) {
        clearTimeout(renderTimer)
        renderTimer = null
      }
      delete _controllers[iframeId]
    },
  }

  _controllers[iframeId] = controller
  return controller
}

export function getStreamingController(iframeId) {
  return _controllers[iframeId] || null
}

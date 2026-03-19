// Page Creator — AI-generated custom analysis pages
import { hasApiKey, getApiKey, getCustomPages, saveCustomPage, getCustomPage, deleteCustomPage } from '../lib/mie-data.js'
import { generatePage } from '../lib/mie-ai.js'

export function renderPageCreator(container, navigate) {
  var html = '<div class="mie-page-creator">'

  if (!hasApiKey()) {
    html += '<div class="mie-card" style="text-align:center;padding:40px">'
    html += '<div style="font-size:28px;margin-bottom:12px">&#x1F511;</div>'
    html += '<div style="font-size:14px;color:var(--mie-text-secondary)">Set OpenAI key in Builder settings to use the Page Creator</div>'
    html += '</div></div>'
    container.innerHTML = html
    return
  }

  html += '<div class="mie-card">'
  html += '<div class="mie-card-title">Create Custom Analysis</div>'
  html += '<p style="font-size:13px;color:var(--mie-text-secondary);margin-bottom:16px;line-height:1.5">Describe the analysis you want and AI will generate a custom page with charts, comparisons, and insights.</p>'
  html += '<div class="mie-page-input-row">'
  html += '<input type="text" class="mie-page-input" id="mie-page-prompt" placeholder="e.g. Compare GradBridge vs SoFi interest rates" />'
  html += '<button class="mie-btn mie-btn-primary" id="mie-page-build">Build</button>'
  html += '</div></div>'

  // Existing custom pages
  var pages = getCustomPages()
  if (pages.length > 0) {
    html += '<div class="mie-card" style="margin-top:16px">'
    html += '<div class="mie-card-title">Your Custom Pages</div>'
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i]
      var dateStr = new Date(p.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
      html += '<div class="mie-custom-page-item" data-id="' + p.id + '">'
      html += '<div class="mie-custom-page-info">'
      html += '<div class="mie-custom-page-title">' + escapeHtml(p.prompt) + '</div>'
      html += '<div class="mie-custom-page-date">' + dateStr + '</div>'
      html += '</div>'
      html += '<div class="mie-custom-page-actions">'
      html += '<button class="mie-page-action-btn mie-page-view-btn" data-id="' + p.id + '" title="View">&#x1F441;</button>'
      html += '<button class="mie-page-action-btn mie-page-delete-btn" data-id="' + p.id + '" title="Delete">&#x2715;</button>'
      html += '</div></div>'
    }
    html += '</div>'
  }

  html += '</div>'
  container.innerHTML = html

  // Build button
  var buildBtn = document.getElementById('mie-page-build')
  var promptInput = document.getElementById('mie-page-prompt')
  if (buildBtn && promptInput) {
    buildBtn.addEventListener('click', function () {
      var prompt = promptInput.value.trim()
      if (!prompt) return
      buildPage(container, prompt, navigate)
    })
    promptInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var prompt = promptInput.value.trim()
        if (prompt) buildPage(container, prompt, navigate)
      }
    })
  }

  // View buttons
  var viewBtns = container.querySelectorAll('.mie-page-view-btn')
  for (var v = 0; v < viewBtns.length; v++) {
    viewBtns[v].addEventListener('click', function (e) {
      e.stopPropagation()
      navigate('custom-page', { pageId: this.dataset.id })
    })
  }

  // Delete buttons
  var delBtns = container.querySelectorAll('.mie-page-delete-btn')
  for (var d = 0; d < delBtns.length; d++) {
    delBtns[d].addEventListener('click', function (e) {
      e.stopPropagation()
      deleteCustomPage(this.dataset.id)
      renderPageCreator(container, navigate)
      if (navigate) navigate('page-creator')
    })
  }
}

function buildPage(container, prompt, navigate) {
  var key = getApiKey()

  // Show loading
  container.innerHTML = '<div class="mie-page-creator">'
    + '<div class="mie-card" style="text-align:center;padding:60px">'
    + '<div class="mie-spinner" style="margin:0 auto 16px"></div>'
    + '<div style="font-size:14px;color:var(--mie-text-secondary)">Generating your analysis...</div>'
    + '<div style="font-size:12px;color:var(--mie-text-muted);margin-top:8px">"' + escapeHtml(prompt) + '"</div>'
    + '</div></div>'

  generatePage(key, prompt).then(function (html) {
    var page = {
      id: 'page-' + Date.now(),
      prompt: prompt,
      html: html,
      createdAt: Date.now(),
    }
    saveCustomPage(page)
    navigate('custom-page', { pageId: page.id })
  }).catch(function (e) {
    container.innerHTML = '<div class="mie-page-creator">'
      + '<div class="mie-card" style="text-align:center;padding:40px">'
      + '<div style="font-size:28px;margin-bottom:12px">&#x26A0;</div>'
      + '<div style="font-size:14px;color:#FF5252;margin-bottom:12px">Error: ' + escapeHtml(e.message) + '</div>'
      + '<button class="mie-btn mie-btn-secondary" id="mie-page-retry">Try Again</button>'
      + '</div></div>'
    document.getElementById('mie-page-retry').addEventListener('click', function () {
      renderPageCreator(container, navigate)
      // Pre-fill the prompt
      setTimeout(function () {
        var input = document.getElementById('mie-page-prompt')
        if (input) input.value = prompt
      }, 50)
    })
  })
}

export function renderCustomPage(container, pageId, navigate) {
  var page = getCustomPage(pageId)
  if (!page) {
    container.innerHTML = '<div class="mie-card"><p>Page not found.</p></div>'
    return
  }

  var html = '<div class="mie-custom-page-view">'
  html += '<div class="mie-custom-page-toolbar">'
  html += '<button class="mie-back-btn" id="mie-custom-back">&larr; Back to Page Creator</button>'
  html += '<div class="mie-custom-page-toolbar-right">'
  html += '<button class="mie-btn mie-btn-secondary mie-btn-sm" id="mie-custom-regen">&#x21BB; Regenerate</button>'
  html += '<button class="mie-btn mie-btn-secondary mie-btn-sm mie-btn-danger" id="mie-custom-delete">Delete</button>'
  html += '</div></div>'

  html += '<div class="mie-card" style="margin-top:12px">'
  html += '<div class="mie-card-title" style="font-size:12px;color:var(--mie-text-muted)">Prompt: "' + escapeHtml(page.prompt) + '"</div>'
  html += '</div>'

  html += '<div class="mie-custom-page-content" id="mie-custom-content">'
  html += page.html
  html += '</div></div>'

  container.innerHTML = html

  // Back
  document.getElementById('mie-custom-back').addEventListener('click', function () {
    navigate('page-creator')
  })

  // Regenerate
  document.getElementById('mie-custom-regen').addEventListener('click', function () {
    var key = getApiKey()
    if (!key) return

    var contentEl = document.getElementById('mie-custom-content')
    contentEl.innerHTML = '<div style="text-align:center;padding:40px"><div class="mie-spinner" style="margin:0 auto 16px"></div><div style="font-size:13px;color:var(--mie-text-secondary)">Regenerating...</div></div>'

    generatePage(key, page.prompt).then(function (newHtml) {
      page.html = newHtml
      page.createdAt = Date.now()
      saveCustomPage(page)
      contentEl.innerHTML = newHtml
    }).catch(function (e) {
      contentEl.innerHTML = '<div style="color:#FF5252;padding:20px">Error: ' + escapeHtml(e.message) + '</div>'
    })
  })

  // Delete
  document.getElementById('mie-custom-delete').addEventListener('click', function () {
    deleteCustomPage(pageId)
    navigate('page-creator')
  })
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

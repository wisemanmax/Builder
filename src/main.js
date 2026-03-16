// Styles
import './styles/base.css'
import './styles/screens.css'
import './styles/components.css'
import './styles/pipeline.css'
import './styles/chat.css'

// Install key guard (must be first JS import)
import './lib/key-guard.js'

// Import and run app
import { init } from './app.js'

try {
  init()
} catch (err) {
  console.error('Builder init error:', err)
  var _eWrap = document.createElement('div')
  _eWrap.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#080812;font-family:sans-serif;padding:24px'
  var _eBox = document.createElement('div')
  _eBox.style.cssText = 'text-align:center;color:white;max-width:320px'
  _eBox.innerHTML = '<div style="font-size:48px;margin-bottom:16px">\u26A0\uFE0F</div><div style="font-size:18px;font-weight:700;margin-bottom:8px">Something went wrong</div>'
  var _eMsg = document.createElement('div')
  _eMsg.style.cssText = 'font-size:13px;color:rgba(255,255,255,.5);margin-bottom:20px;word-break:break-word'
  _eMsg.textContent = String(err && err.message || err || 'Unknown error')
  var _eBtn = document.createElement('button')
  _eBtn.style.cssText = 'padding:12px 24px;border-radius:10px;background:#FF3CAC;border:none;color:white;font-size:14px;font-weight:700;cursor:pointer'
  _eBtn.textContent = 'Clear & Restart'
  _eBtn.onclick = function () { localStorage.clear(); location.reload() }
  _eBox.appendChild(_eMsg); _eBox.appendChild(_eBtn); _eWrap.appendChild(_eBox)
  document.body.innerHTML = ''; document.body.appendChild(_eWrap)
}

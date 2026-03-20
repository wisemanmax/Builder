// Styles
import './styles/base.css'
import './styles/screens.css'
import './styles/components.css'
import './styles/pipeline.css'
import './styles/chat.css'
import './styles/desktop.css'

// Install key guard (must be first JS import)
import './lib/key-guard.js'

// Import and run app
import { init } from './app.js'

try {
  init()
} catch (err) {
  console.error('Fatal init error:', err)
  document.getElementById('app').innerHTML = `
    <div style="
      position:fixed;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:18px;
      background:#080812;color:#fff;font-family:system-ui,-apple-system,sans-serif;
      text-align:center;padding:24px;z-index:99999
    ">
      <div style="font-size:48px">&#x26A0;&#xFE0F;</div>
      <div style="font-size:20px;font-weight:700">Something went wrong</div>
      <div style="font-size:13px;color:rgba(255,255,255,.5);max-width:340px;line-height:1.6">
        The app failed to start. This can happen if local data got corrupted.
        Clearing storage usually fixes it.
      </div>
      <div style="font-size:11px;color:rgba(255,255,255,.3);max-width:400px;word-break:break-all">
        ${String(err).replace(/</g, '&lt;')}
      </div>
      <button onclick="localStorage.clear();sessionStorage.clear();location.reload()" style="
        margin-top:8px;padding:14px 32px;border-radius:14px;border:none;
        background:linear-gradient(135deg,#FF3CAC,#784BA0);color:#fff;
        font-size:14px;font-weight:700;cursor:pointer;
        box-shadow:0 4px 20px rgba(255,60,172,.4)
      ">Clear &amp; Restart</button>
    </div>
  `
}

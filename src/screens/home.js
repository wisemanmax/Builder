import { $ } from '../lib/utils.js'

export function initHome() {
  tick()
  setInterval(tick, 30000)
}

function tick() {
  var el = $('clock')
  if (!el) return
  var n = new Date()
  el.textContent = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0')
}

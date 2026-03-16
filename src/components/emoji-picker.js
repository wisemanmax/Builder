import { $} from '../lib/utils.js'
import { ST } from '../lib/state.js'
import { EMOJIS } from '../config/constants.js'

export function pickEmoji(e) {
  ST.pendingIcon = e
  $('emoji-pick-btn').textContent = e
  $('emoji-overlay').classList.remove('on')
}

export function initEmojiPicker() {
  $('emoji-grid').innerHTML = EMOJIS.map(function (e) { return '<button class="egi" onclick="pickEmoji(\'' + e + '\')">' + e + '</button>' }).join('')
  $('emoji-pick-btn').addEventListener('click', function () { $('emoji-overlay').classList.add('on') })
  $('emoji-overlay').addEventListener('click', function (e) { if (e.target.id === 'emoji-overlay') $('emoji-overlay').classList.remove('on') })
}

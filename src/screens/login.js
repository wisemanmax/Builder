import { ST } from '../lib/state.js'
import { $, toast, showScreen, validateKey } from '../lib/utils.js'
import { saveKeys } from '../lib/state.js'
import { testGitHub } from '../lib/github.js'
import { renderGrid } from '../components/app-icon.js'

export function initOnboarding() {
  $('ob-gpt').addEventListener('input', function () {
    var v = $('ob-gpt').value.trim()
    $('gpt-dot').className = 'gdot' + (v ? ' on' : '')
    $('gst-m').textContent = v ? 'GPT-4o Audit: Active' : 'GPT-4o Audit: Off'
    $('gst-s').textContent = v ? 'Code will be reviewed' : 'Add OpenAI key to enable bug scanning'
  })

  var ghTimer
  var _obSubmitted = false
  var ghValidate = function () {
    clearTimeout(ghTimer)
    var t = $('ob-gh-token').value.trim(),
      u = $('ob-gh-user').value.trim(),
      r = $('ob-gh-repo').value.trim()
    if (!t || !u || !r) {
      $('gh-dot').className = 'gh-dot'
      $('gh-st-m').textContent = 'GitHub: Not connected (optional)'
      $('gh-st-s').textContent = 'Without GitHub, apps save locally only'
      return
    }
    $('gh-dot').className = 'gh-dot'
    $('gh-st-m').textContent = 'Validating\u2026'
    $('gh-st-s').textContent = ''
    ghTimer = setTimeout(function () {
      var prevToken = ST.ghToken,
        prevUser = ST.ghUser,
        prevRepo = ST.ghRepo
      ST.ghToken = t
      ST.ghUser = u
      ST.ghRepo = r
      testGitHub().then(function (ok) {
        if (!_obSubmitted) {
          ST.ghToken = prevToken
          ST.ghUser = prevUser
          ST.ghRepo = prevRepo
        }
        $('gh-dot').className = 'gh-dot ' + (ok ? 'ok' : 'err')
        $('gh-st-m').textContent = ok ? '\u2713 Connected: ' + u + '/' + r : '\u2717 Connection failed'
        $('gh-st-s').textContent = ok
          ? 'Apps will push to github.com/' + u + '/' + r
          : 'Check token has "repo" + "workflow" scopes'
      })
    }, 900)
  }
  ;['ob-gh-token', 'ob-gh-user', 'ob-gh-repo'].forEach(function (id) {
    $(id).addEventListener('input', ghValidate)
  })

  var obSbOn = false
  $('ob-sb-tog').addEventListener('click', function () {
    obSbOn = !obSbOn
    $('ob-sb-pill').classList.toggle('on', obSbOn)
    $('ob-sb-exp').classList.toggle('open', obSbOn)
  })
  $('ob-submit').addEventListener('click', function () {
    clearTimeout(ghTimer)
    _obSubmitted = true
    var k = $('ob-anth').value.trim()
    if (!k) {
      toast('Anthropic API key is required!')
      return
    }
    var anthCheck = validateKey('anthropic', k)
    if (!anthCheck.valid) {
      toast('Anthropic key: ' + anthCheck.msg)
      return
    }
    var ghT = $('ob-gh-token').value.trim(),
      ghU = $('ob-gh-user').value.trim(),
      ghR = $('ob-gh-repo').value.trim()
    var hasGh = ghT && ghU && ghR
    if ((ghT || ghU || ghR) && !hasGh) {
      toast('Enter all three GitHub fields, or leave all blank')
      return
    }
    ST.key = k
    ST.gptKey = $('ob-gpt').value.trim()
    ST.ghToken = ghT
    ST.ghUser = ghU
    ST.ghRepo = ghR
    ST.sbUrl = $('ob-sb-url').value.trim()
    ST.sbAnon = $('ob-sb-anon').value.trim()
    ST.sbEnabled = obSbOn
    saveKeys()
    showScreen('home')
    renderGrid()
    toast(
      hasGh ? 'The Builder is ready \u2014 GitHub connected \u26A1' : 'The Builder is ready (local-only mode) \u26A1',
      3500
    )
  })
}

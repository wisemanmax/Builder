import { ST, persist, getActiveProfile } from '../lib/state.js'
import { $, uid, toast } from '../lib/utils.js'
import { maybeAutoAnalyze } from '../lib/learning.js'

var _feedbackResolve = null

/**
 * Show feedback card after build approval. Returns a promise that resolves when feedback is submitted or skipped.
 * Only shows when a profile is active.
 */
export function showFeedbackCard(appId, appName, prompt) {
  var profile = getActiveProfile()
  if (!profile) return Promise.resolve()

  return new Promise(function (resolve) {
    _feedbackResolve = resolve
    var el = $('feedback-overlay')
    if (!el) { resolve(); return }

    $('fb-app-name').textContent = appName || 'App'
    // Reset state
    var stars = el.querySelectorAll('.fb-star')
    for (var i = 0; i < stars.length; i++) stars[i].classList.remove('active')
    $('fb-liked').value = ''
    $('fb-disliked').value = ''
    var tags = el.querySelectorAll('.fb-tag')
    for (var j = 0; j < tags.length; j++) tags[j].classList.remove('active')
    el.dataset.appId = appId || ''
    el.dataset.appName = appName || ''
    el.dataset.prompt = prompt || ''
    el.dataset.rating = '0'
    el.classList.add('on')
  })
}

export function initFeedbackCard() {
  var el = $('feedback-overlay')
  if (!el) return

  // Star rating
  el.addEventListener('click', function (e) {
    var star = e.target.closest('.fb-star')
    if (star) {
      var rating = parseInt(star.dataset.val, 10)
      el.dataset.rating = rating
      var stars = el.querySelectorAll('.fb-star')
      for (var i = 0; i < stars.length; i++) {
        stars[i].classList.toggle('active', parseInt(stars[i].dataset.val, 10) <= rating)
      }
      return
    }

    // Tags
    var tag = e.target.closest('.fb-tag')
    if (tag) {
      tag.classList.toggle('active')
      return
    }
  })

  // Submit
  $('fb-submit').addEventListener('click', function () {
    var profile = getActiveProfile()
    if (!profile) { _closeFeedback(); return }
    var rating = parseInt(el.dataset.rating || '0', 10)
    if (!rating) { toast('Tap a star rating first'); return }

    var activeTags = el.querySelectorAll('.fb-tag.active')
    var tags = []
    for (var i = 0; i < activeTags.length; i++) tags.push(activeTags[i].textContent.trim())

    var entry = {
      id: uid(),
      appId: el.dataset.appId || '',
      appName: el.dataset.appName || '',
      prompt: (el.dataset.prompt || '').slice(0, 500),
      rating: rating,
      liked: ($('fb-liked').value || '').trim(),
      disliked: ($('fb-disliked').value || '').trim(),
      tags: tags,
      createdAt: new Date().toISOString()
    }
    if (!profile.feedback) profile.feedback = []
    profile.feedback.push(entry)
    persist()
    toast('Feedback saved \u2014 ' + profile.feedback.length + ' total for ' + profile.name)
    _closeFeedback()

    // Check auto-analyze
    maybeAutoAnalyze(profile.id)
  })

  // Skip
  $('fb-skip').addEventListener('click', _closeFeedback)
}

function _closeFeedback() {
  var el = $('feedback-overlay')
  if (el) el.classList.remove('on')
  if (_feedbackResolve) { _feedbackResolve(); _feedbackResolve = null }
}

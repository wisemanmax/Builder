import { ST, persist, getActiveProfile } from '../lib/state.js'
import { $, uid, toast } from '../lib/utils.js'
import { maybeAutoAnalyze } from '../lib/learning.js'
import { attachFeedback } from '../lib/build-record.js'

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
    if (!el) {
      resolve()
      return
    }

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
    if (!profile) {
      _closeFeedback()
      return
    }
    var rating = parseInt(el.dataset.rating || '0', 10)
    if (!rating) {
      toast('Tap a star rating first')
      return
    }

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
      createdAt: new Date().toISOString(),
    }
    if (!profile.feedback) profile.feedback = []
    profile.feedback.push(entry)
    persist()

    // Attach feedback to the most recent build record for this app
    attachFeedback(entry.appId, rating, tags)

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
  if (_feedbackResolve) {
    _feedbackResolve()
    _feedbackResolve = null
  }
}

/* ---- Thought-level feedback ---- */

var _thoughtFbResolve = null

/**
 * Show thought feedback card after a build that used a thought.
 * Only shows once per thought and only if a profile is active.
 */
export function showThoughtFeedback(thoughtId) {
  var profile = getActiveProfile()
  if (!profile) return Promise.resolve()

  // Find thought
  var thought = null
  for (var i = 0; i < ST.thoughts.length; i++) {
    if (ST.thoughts[i].id === thoughtId) { thought = ST.thoughts[i]; break }
  }
  if (!thought) return Promise.resolve()
  // Already rated
  if (thought.feedback && thought.feedback.rating) return Promise.resolve()

  return new Promise(function (resolve) {
    _thoughtFbResolve = resolve
    var el = $('thought-fb-overlay')
    if (!el) { resolve(); return }

    $('tfb-thought-name').textContent = thought.name || 'Thought'
    var stars = el.querySelectorAll('.tfb-star')
    for (var i = 0; i < stars.length; i++) stars[i].classList.remove('active')
    $('tfb-text').value = ''
    el.dataset.thoughtId = thoughtId
    el.dataset.rating = '0'
    el.classList.add('on')
  })
}

export function initThoughtFeedback() {
  var el = $('thought-fb-overlay')
  if (!el) return

  el.addEventListener('click', function (e) {
    var star = e.target.closest('.tfb-star')
    if (star) {
      var rating = parseInt(star.dataset.val, 10)
      el.dataset.rating = rating
      var stars = el.querySelectorAll('.tfb-star')
      for (var i = 0; i < stars.length; i++) {
        stars[i].classList.toggle('active', parseInt(stars[i].dataset.val, 10) <= rating)
      }
    }
  })

  $('tfb-submit').addEventListener('click', function () {
    var rating = parseInt(el.dataset.rating || '0', 10)
    if (!rating) {
      toast('Tap a star rating first')
      return
    }
    var thoughtId = el.dataset.thoughtId
    for (var i = 0; i < ST.thoughts.length; i++) {
      if (ST.thoughts[i].id === thoughtId) {
        ST.thoughts[i].feedback = {
          rating: rating,
          text: ($('tfb-text').value || '').trim(),
          ts: new Date().toISOString(),
        }
        break
      }
    }
    persist()
    toast('Thought feedback saved')
    _closeThoughtFb()
  })

  $('tfb-skip').addEventListener('click', _closeThoughtFb)
}

function _closeThoughtFb() {
  var el = $('thought-fb-overlay')
  if (el) el.classList.remove('on')
  if (_thoughtFbResolve) {
    _thoughtFbResolve()
    _thoughtFbResolve = null
  }
}

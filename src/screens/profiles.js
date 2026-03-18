import { ST, persist, setActiveProfile, getActiveProfile } from '../lib/state.js'
import { $, esc, uid, toast } from '../lib/utils.js'
import { createProfile, deleteProfile, renderProfileChip } from '../components/profile-switcher.js'
import { openOrgThink } from './org-think.js'
import { analyzeFeedback } from '../lib/learning.js'

/**
 * Render profiles section in settings.
 */
export function renderProfilesSettings() {
  var container = $('profiles-section')
  if (!container) return

  var html = ''
  if (ST.profiles.length === 0) {
    html += '<div class="prof-empty">No profiles yet. Create one to get started.</div>'
  }

  for (var i = 0; i < ST.profiles.length; i++) {
    var p = ST.profiles[i]
    var isActive = p.id === ST.activeProfileId
    var gr = p.globalRules || {}
    var ruleCount = (gr.mustRules || []).length + (gr.mustNotRules || []).length + (gr.niceToHave || []).length
    var fbCount = (p.feedback || []).length
    var hasOrg = !!(p.orgProfile && p.orgProfile.vision)
    var prefs = p.learnedPreferences || {}
    var prefCount = (prefs.positivePatterns || []).length + (prefs.negativePatterns || []).length
      + (prefs.designPrefs || []).length + (prefs.functionalPrefs || []).length

    html += '<div class="prof-card' + (isActive ? ' active' : '') + '" data-id="' + p.id + '">'
    html += '<div class="prof-header">'
    html += '<div class="prof-info">'
    html += '<div class="prof-name">' + esc(p.name) + '</div>'
    html += '<div class="prof-meta">' + ruleCount + ' rules \u00B7 ' + fbCount + ' feedback \u00B7 ' + prefCount + ' insights</div>'
    html += '</div>'
    html += '<div class="pill' + (isActive ? ' on' : '') + '" data-action="toggle" data-id="' + p.id + '"></div>'
    html += '</div>'

    // Org profile section
    html += '<div class="prof-section">'
    html += '<div class="prof-sec-title">\uD83C\uDFE2 Org Profile</div>'
    if (hasOrg) {
      html += '<div class="prof-sec-body">'
      html += '<div class="prof-detail">' + esc((p.orgProfile.vision || '').slice(0, 120)) + (p.orgProfile.vision.length > 120 ? '\u2026' : '') + '</div>'
      html += '<button class="prof-btn" data-action="edit-org" data-id="' + p.id + '">\u270F\uFE0F Edit Profile</button>'
      html += '</div>'
    } else {
      html += '<button class="prof-btn primary" data-action="setup-org" data-id="' + p.id + '">\uD83C\uDFE2 Set Up Profile</button>'
    }
    html += '</div>'

    // Rules section
    html += '<div class="prof-section">'
    html += '<div class="prof-sec-title">\uD83D\uDCCB Global Rules</div>'
    if (ruleCount > 0) {
      html += '<div class="prof-sec-body">'
      if (gr.mustRules && gr.mustRules.length) {
        html += '<div class="prof-rule-cat">Must Do</div>'
        for (var m = 0; m < gr.mustRules.length; m++) {
          html += '<div class="prof-rule-item"><span>' + esc(gr.mustRules[m]) + '</span>'
            + '<button class="prof-rule-rm" data-action="rm-rule" data-id="' + p.id + '" data-cat="mustRules" data-idx="' + m + '">\u2715</button></div>'
        }
      }
      if (gr.mustNotRules && gr.mustNotRules.length) {
        html += '<div class="prof-rule-cat">Must Not Do</div>'
        for (var n = 0; n < gr.mustNotRules.length; n++) {
          html += '<div class="prof-rule-item"><span>' + esc(gr.mustNotRules[n]) + '</span>'
            + '<button class="prof-rule-rm" data-action="rm-rule" data-id="' + p.id + '" data-cat="mustNotRules" data-idx="' + n + '">\u2715</button></div>'
        }
      }
      if (gr.niceToHave && gr.niceToHave.length) {
        html += '<div class="prof-rule-cat">Nice to Have</div>'
        for (var nh = 0; nh < gr.niceToHave.length; nh++) {
          html += '<div class="prof-rule-item"><span>' + esc(gr.niceToHave[nh]) + '</span>'
            + '<button class="prof-rule-rm" data-action="rm-rule" data-id="' + p.id + '" data-cat="niceToHave" data-idx="' + nh + '">\u2715</button></div>'
        }
      }
      html += '</div>'
    }
    html += '<div class="prof-rule-add">'
    html += '<select class="prof-rule-select" data-id="' + p.id + '"><option value="mustRules">Must Do</option><option value="mustNotRules">Must Not</option><option value="niceToHave">Nice to Have</option></select>'
    html += '<input class="fi prof-rule-input" data-id="' + p.id + '" placeholder="Add a rule\u2026" autocomplete="off">'
    html += '<button class="prof-btn" data-action="add-rule" data-id="' + p.id + '">+</button>'
    html += '</div>'
    html += '</div>'

    // Learning insights section
    html += '<div class="prof-section">'
    html += '<div class="prof-sec-title">\uD83E\uDDE0 Learning Insights</div>'
    if (prefCount > 0) {
      html += '<div class="prof-sec-body">'
      if (prefs.positivePatterns && prefs.positivePatterns.length) {
        html += '<div class="prof-rule-cat">Likes</div>'
        for (var pp = 0; pp < prefs.positivePatterns.length; pp++) html += '<div class="prof-insight">\u2705 ' + esc(prefs.positivePatterns[pp]) + '</div>'
      }
      if (prefs.negativePatterns && prefs.negativePatterns.length) {
        html += '<div class="prof-rule-cat">Dislikes</div>'
        for (var np = 0; np < prefs.negativePatterns.length; np++) html += '<div class="prof-insight">\u274C ' + esc(prefs.negativePatterns[np]) + '</div>'
      }
      if (prefs.designPrefs && prefs.designPrefs.length) {
        html += '<div class="prof-rule-cat">Design Prefs</div>'
        for (var dp = 0; dp < prefs.designPrefs.length; dp++) html += '<div class="prof-insight">\uD83C\uDFA8 ' + esc(prefs.designPrefs[dp]) + '</div>'
      }
      if (prefs.functionalPrefs && prefs.functionalPrefs.length) {
        html += '<div class="prof-rule-cat">Functional Prefs</div>'
        for (var fp = 0; fp < prefs.functionalPrefs.length; fp++) html += '<div class="prof-insight">\u2699\uFE0F ' + esc(prefs.functionalPrefs[fp]) + '</div>'
      }
      html += '<div class="prof-insight-meta">Last analyzed: ' + (prefs.lastAnalyzedAt ? new Date(prefs.lastAnalyzedAt).toLocaleDateString() : 'never') + ' \u00B7 ' + (prefs.feedbackCount || 0) + ' entries</div>'
      html += '</div>'
    } else {
      html += '<div class="prof-detail" style="color:rgba(255,255,255,.3)">No insights yet \u2014 ' + (fbCount < 3 ? 'need at least 3 feedback entries' : 'click Refresh to analyze') + '</div>'
    }
    html += '<button class="prof-btn" data-action="refresh-insights" data-id="' + p.id + '" ' + (fbCount < 3 ? 'disabled' : '') + '>\uD83E\uDDE0 Refresh Insights</button>'
    html += '</div>'

    // Delete
    html += '<button class="prof-btn danger" data-action="delete" data-id="' + p.id + '">\uD83D\uDDD1\uFE0F Delete Profile</button>'
    html += '</div>'
  }

  html += '<button class="btn-p prof-create-btn" id="prof-create-btn">+ New Profile</button>'
  container.innerHTML = html
}

export function initProfilesSettings() {
  var container = $('profiles-section')
  if (!container) return

  container.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]')
    if (!btn) return
    var action = btn.dataset.action
    var id = btn.dataset.id

    if (action === 'toggle') {
      if (ST.activeProfileId === id) setActiveProfile(null)
      else setActiveProfile(id)
      renderProfileChip()
      renderProfilesSettings()
      toast(ST.activeProfileId ? 'Profile activated' : 'Profile deactivated')
      return
    }
    if (action === 'setup-org' || action === 'edit-org') {
      openOrgThink(id)
      return
    }
    if (action === 'add-rule') {
      var input = container.querySelector('.prof-rule-input[data-id="' + id + '"]')
      var select = container.querySelector('.prof-rule-select[data-id="' + id + '"]')
      if (!input || !select) return
      var text = input.value.trim()
      if (!text) { toast('Enter a rule'); return }
      var cat = select.value
      var profile = null
      for (var i = 0; i < ST.profiles.length; i++) { if (ST.profiles[i].id === id) { profile = ST.profiles[i]; break } }
      if (!profile) return
      if (!profile.globalRules) profile.globalRules = { mustRules: [], mustNotRules: [], niceToHave: [] }
      if (!profile.globalRules[cat]) profile.globalRules[cat] = []
      profile.globalRules[cat].push(text)
      profile.updatedAt = new Date().toISOString()
      persist()
      input.value = ''
      renderProfilesSettings()
      toast('Rule added')
      return
    }
    if (action === 'rm-rule') {
      var cat2 = btn.dataset.cat
      var idx = parseInt(btn.dataset.idx, 10)
      var p2 = null
      for (var j = 0; j < ST.profiles.length; j++) { if (ST.profiles[j].id === id) { p2 = ST.profiles[j]; break } }
      if (!p2 || !p2.globalRules || !p2.globalRules[cat2]) return
      p2.globalRules[cat2].splice(idx, 1)
      p2.updatedAt = new Date().toISOString()
      persist()
      renderProfilesSettings()
      return
    }
    if (action === 'refresh-insights') {
      btn.disabled = true
      btn.textContent = 'Analyzing\u2026'
      analyzeFeedback(id).then(function (prefs) {
        toast('Insights updated \u2014 ' + ((prefs.positivePatterns || []).length + (prefs.negativePatterns || []).length) + ' patterns found')
        renderProfilesSettings()
      }).catch(function (err) {
        toast('Analysis failed: ' + (err.message || String(err)))
        renderProfilesSettings()
      })
      return
    }
    if (action === 'delete') {
      if (!confirm('Delete this profile and all its data?')) return
      deleteProfile(id)
      renderProfilesSettings()
      toast('Profile deleted')
      return
    }
  })

  // Handle enter key on rule input
  container.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList.contains('prof-rule-input')) {
      var id2 = e.target.dataset.id
      var addBtn = container.querySelector('[data-action="add-rule"][data-id="' + id2 + '"]')
      if (addBtn) addBtn.click()
    }
  })

  // New profile button
  container.addEventListener('click', function (e) {
    if (e.target.id === 'prof-create-btn' || e.target.closest('#prof-create-btn')) {
      var name = prompt('Profile name (e.g., "grad Bridge", "Client X"):')
      if (!name || !name.trim()) return
      var newProf = createProfile(name.trim())
      renderProfilesSettings()
      toast('Profile "' + newProf.name + '" created')
    }
  })
}

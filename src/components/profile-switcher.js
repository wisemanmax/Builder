import { ST, persist, setActiveProfile } from '../lib/state.js'
import { $, uid, toast } from '../lib/utils.js'

/**
 * Render the profile switcher chip in the home header.
 * Shows active profile name or "No Profile". Tap to cycle/switch.
 */
export function renderProfileChip() {
  var el = $('profile-chip')
  if (!el) return
  var profile = null
  if (ST.activeProfileId) {
    for (var i = 0; i < ST.profiles.length; i++) {
      if (ST.profiles[i].id === ST.activeProfileId) { profile = ST.profiles[i]; break }
    }
  }
  if (profile) {
    el.textContent = profile.name || 'Profile'
    el.className = 'profile-chip active'
  } else {
    el.textContent = 'No Profile'
    el.className = 'profile-chip'
  }
}

/**
 * Toggle through profiles: none -> profile1 -> profile2 -> ... -> none
 */
export function cycleProfile() {
  if (ST.profiles.length === 0) {
    toast('No profiles yet \u2014 create one in Settings')
    return
  }
  var currentIdx = -1
  if (ST.activeProfileId) {
    for (var i = 0; i < ST.profiles.length; i++) {
      if (ST.profiles[i].id === ST.activeProfileId) { currentIdx = i; break }
    }
  }
  var nextIdx = currentIdx + 1
  if (nextIdx >= ST.profiles.length) {
    // Turn off
    setActiveProfile(null)
    toast('Profile deactivated')
  } else {
    setActiveProfile(ST.profiles[nextIdx].id)
    toast('Profile: ' + ST.profiles[nextIdx].name)
  }
  renderProfileChip()
}

/**
 * Show profile picker dropdown.
 */
export function showProfilePicker() {
  var el = $('profile-picker')
  if (!el) return
  var html = '<div class="pp-item' + (!ST.activeProfileId ? ' active' : '') + '" data-id="">'
    + '<span class="pp-name">No Profile</span>'
    + '<span class="pp-desc">Vanilla Builder mode</span>'
    + '</div>'
  for (var i = 0; i < ST.profiles.length; i++) {
    var p = ST.profiles[i]
    var isActive = p.id === ST.activeProfileId
    var fbCount = (p.feedback || []).length
    var ruleCount = 0
    var gr = p.globalRules || {}
    ruleCount += (gr.mustRules || []).length + (gr.mustNotRules || []).length + (gr.niceToHave || []).length
    html += '<div class="pp-item' + (isActive ? ' active' : '') + '" data-id="' + p.id + '">'
      + '<span class="pp-name">' + (p.name || 'Unnamed') + '</span>'
      + '<span class="pp-desc">' + ruleCount + ' rules \u00B7 ' + fbCount + ' feedback</span>'
      + '</div>'
  }
  el.innerHTML = html
  el.classList.add('on')
}

export function initProfilePicker() {
  var picker = $('profile-picker')
  if (!picker) return
  picker.addEventListener('click', function (e) {
    var item = e.target.closest('.pp-item')
    if (!item) return
    var id = item.dataset.id || null
    setActiveProfile(id)
    renderProfileChip()
    picker.classList.remove('on')
    if (id) {
      var p = null
      for (var i = 0; i < ST.profiles.length; i++) { if (ST.profiles[i].id === id) { p = ST.profiles[i]; break } }
      toast('Profile: ' + (p ? p.name : 'Active'))
    } else {
      toast('Profile deactivated')
    }
  })
  // Close on outside click
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#profile-picker') && !e.target.closest('#profile-chip')) {
      picker.classList.remove('on')
    }
  })
}

/**
 * Create a new empty profile with the given name.
 */
export function createProfile(name) {
  var profile = {
    id: uid(),
    name: name || 'New Profile',
    orgProfile: {
      vision: '',
      principles: [],
      brandIdentity: { theme: 'dark', accentColor: '', fonts: '', tone: '' },
      roadmap: []
    },
    globalRules: { mustRules: [], mustNotRules: [], niceToHave: [] },
    learnedPreferences: {
      positivePatterns: [], negativePatterns: [],
      designPrefs: [], functionalPrefs: [],
      lastAnalyzedAt: '', feedbackCount: 0
    },
    feedback: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  ST.profiles.push(profile)
  persist()
  return profile
}

export function deleteProfile(profileId) {
  ST.profiles = ST.profiles.filter(function (p) { return p.id !== profileId })
  if (ST.activeProfileId === profileId) setActiveProfile(null)
  persist()
  renderProfileChip()
}

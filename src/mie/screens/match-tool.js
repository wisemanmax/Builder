// Borrower Match Tool — Multi-step form + results
import { CREDIT_RANGES, ENROLLMENT_TYPES, SCHOOL_TYPES, DEGREE_LEVELS, CITIZENSHIP_TYPES, LOAN_RANGES, US_STATES } from '../data/thresholds.js'
import { runMatch } from '../lib/match-engine.js'
import { tierLabel, tierColor, confidenceLabel } from '../lib/scoring.js'
import { scoreBar, tierBadge } from '../components/score-bar.js'

var formState = {
  step: 1,
  creditRange: '',
  cosignerAvailable: false,
  enrollmentStatus: '',
  schoolType: '',
  degreeLevel: '',
  loanAmount: '',
  citizenshipStatus: '',
  state: '',
}

var matchResults = null

export function renderMatchTool(container) {
  if (matchResults) {
    renderResults(container)
    return
  }

  var html = '<div class="mie-match-wrap">'

  // Intro
  html += '<div class="mie-match-intro">'
  html += '<h2>Find Your Best Student Loan Match</h2>'
  html += '<p>Answer a few questions and we\'ll show you which lenders you likely qualify for — no hard credit pull, no impact to your score.</p>'
  html += '<div class="mie-match-trust">'
  html += '<span class="mie-match-trust-item">No hard credit pull</span>'
  html += '<span class="mie-match-trust-item">100% transparent</span>'
  html += '<span class="mie-match-trust-item">Takes 60 seconds</span>'
  html += '</div></div>'

  // Progress
  html += '<div class="mie-progress">'
  for (var p = 1; p <= 3; p++) {
    var cls = p < formState.step ? 'done' : p === formState.step ? 'active' : ''
    html += '<div class="mie-progress-step ' + cls + '"></div>'
  }
  html += '</div>'

  // Step content
  html += '<div class="mie-card">'
  if (formState.step === 1) html += renderStep1()
  else if (formState.step === 2) html += renderStep2()
  else html += renderStep3()
  html += '</div>'

  // Buttons
  html += '<div class="mie-btn-row">'
  if (formState.step > 1) html += '<button class="mie-btn mie-btn-secondary" id="mie-match-prev">Back</button>'
  if (formState.step < 3) html += '<button class="mie-btn mie-btn-primary" id="mie-match-next">Continue</button>'
  else html += '<button class="mie-btn mie-btn-primary" id="mie-match-submit">See My Matches</button>'
  html += '</div>'

  html += '</div>'
  container.innerHTML = html

  attachFormHandlers(container)
}

function renderStep1() {
  var html = '<div class="mie-card-title">Step 1: Credit & Cosigner</div>'

  // Credit range
  html += '<div class="mie-field">'
  html += '<div class="mie-field-label">Estimated Credit Score Range</div>'
  html += '<div class="mie-radio-group">'
  var ranges = Object.keys(CREDIT_RANGES)
  for (var i = 0; i < ranges.length; i++) {
    var r = ranges[i]
    var sel = formState.creditRange === r ? ' selected' : ''
    html += '<button class="mie-radio-btn' + sel + '" data-field="creditRange" data-value="' + r + '">' + CREDIT_RANGES[r].label + '</button>'
  }
  html += '</div>'
  html += '<div class="mie-field-hint">Don\'t know? Most people 18-25 fall in the Fair to Good range.</div>'
  html += '</div>'

  // Cosigner
  html += '<div class="mie-field">'
  html += '<div class="mie-field-label">Do you have a cosigner available?</div>'
  html += '<button class="mie-toggle-btn' + (formState.cosignerAvailable ? ' active' : '') + '" id="mie-cosigner-toggle">'
  html += '<div class="mie-toggle-dot"></div>'
  html += '<span>' + (formState.cosignerAvailable ? 'Yes, I have a cosigner' : 'No cosigner available') + '</span>'
  html += '</button>'
  html += '<div class="mie-field-hint">A cosigner with good credit can significantly improve your options.</div>'
  html += '</div>'

  return html
}

function renderStep2() {
  var html = '<div class="mie-card-title">Step 2: Enrollment</div>'

  // Enrollment status
  html += '<div class="mie-field">'
  html += '<div class="mie-field-label">Enrollment Status</div>'
  html += '<div class="mie-radio-group">'
  for (var i = 0; i < ENROLLMENT_TYPES.length; i++) {
    var e = ENROLLMENT_TYPES[i]
    var sel = formState.enrollmentStatus === e.value ? ' selected' : ''
    html += '<button class="mie-radio-btn' + sel + '" data-field="enrollmentStatus" data-value="' + e.value + '">' + e.label + '</button>'
  }
  html += '</div></div>'

  // School type
  html += '<div class="mie-field">'
  html += '<div class="mie-field-label">School Type</div>'
  html += '<div class="mie-radio-group">'
  for (var j = 0; j < SCHOOL_TYPES.length; j++) {
    var s = SCHOOL_TYPES[j]
    var sel2 = formState.schoolType === s.value ? ' selected' : ''
    html += '<button class="mie-radio-btn' + sel2 + '" data-field="schoolType" data-value="' + s.value + '">' + s.label + '</button>'
  }
  html += '</div></div>'

  // Degree level
  html += '<div class="mie-field">'
  html += '<div class="mie-field-label">Degree Level</div>'
  html += '<div class="mie-radio-group">'
  for (var k = 0; k < DEGREE_LEVELS.length; k++) {
    var d = DEGREE_LEVELS[k]
    var sel3 = formState.degreeLevel === d.value ? ' selected' : ''
    html += '<button class="mie-radio-btn' + sel3 + '" data-field="degreeLevel" data-value="' + d.value + '">' + d.label + '</button>'
  }
  html += '</div></div>'

  return html
}

function renderStep3() {
  var html = '<div class="mie-card-title">Step 3: Loan Details</div>'

  // Loan amount
  html += '<div class="mie-field">'
  html += '<div class="mie-field-label">How much do you need to borrow?</div>'
  html += '<div class="mie-radio-group">'
  for (var i = 0; i < LOAN_RANGES.length; i++) {
    var lr = LOAN_RANGES[i]
    var sel = formState.loanAmount === lr.value ? ' selected' : ''
    html += '<button class="mie-radio-btn' + sel + '" data-field="loanAmount" data-value="' + lr.value + '">' + lr.label + '</button>'
  }
  html += '</div></div>'

  // Citizenship
  html += '<div class="mie-field">'
  html += '<div class="mie-field-label">Citizenship Status</div>'
  html += '<select class="mie-select" id="mie-citizenship">'
  html += '<option value="">Select...</option>'
  for (var j = 0; j < CITIZENSHIP_TYPES.length; j++) {
    var ct = CITIZENSHIP_TYPES[j]
    var sel2 = formState.citizenshipStatus === ct.value ? ' selected' : ''
    html += '<option value="' + ct.value + '"' + sel2 + '>' + ct.label + '</option>'
  }
  html += '</select></div>'

  // State
  html += '<div class="mie-field">'
  html += '<div class="mie-field-label">State of Residence</div>'
  html += '<select class="mie-select" id="mie-state">'
  html += '<option value="">Select...</option>'
  for (var k = 0; k < US_STATES.length; k++) {
    var sel3 = formState.state === US_STATES[k] ? ' selected' : ''
    html += '<option value="' + US_STATES[k] + '"' + sel3 + '>' + US_STATES[k] + '</option>'
  }
  html += '</select></div>'

  return html
}

function attachFormHandlers(container) {
  // Radio buttons
  container.addEventListener('click', function (e) {
    var btn = e.target.closest('.mie-radio-btn')
    if (btn && btn.dataset.field) {
      formState[btn.dataset.field] = btn.dataset.value
      renderMatchTool(container)
      return
    }
  })

  // Cosigner toggle
  var tog = document.getElementById('mie-cosigner-toggle')
  if (tog) tog.addEventListener('click', function () {
    formState.cosignerAvailable = !formState.cosignerAvailable
    renderMatchTool(container)
  })

  // Dropdowns
  var cit = document.getElementById('mie-citizenship')
  if (cit) cit.addEventListener('change', function () { formState.citizenshipStatus = this.value })
  var st = document.getElementById('mie-state')
  if (st) st.addEventListener('change', function () { formState.state = this.value })

  // Navigation
  var prev = document.getElementById('mie-match-prev')
  if (prev) prev.addEventListener('click', function () {
    formState.step = Math.max(1, formState.step - 1)
    renderMatchTool(container)
  })

  var next = document.getElementById('mie-match-next')
  if (next) next.addEventListener('click', function () {
    formState.step = Math.min(3, formState.step + 1)
    renderMatchTool(container)
  })

  var submit = document.getElementById('mie-match-submit')
  if (submit) submit.addEventListener('click', function () {
    // Save dropdown values before submitting
    var citEl = document.getElementById('mie-citizenship')
    if (citEl) formState.citizenshipStatus = citEl.value
    var stEl = document.getElementById('mie-state')
    if (stEl) formState.state = stEl.value

    // Get loan midpoint
    var loanRange = LOAN_RANGES.find(function (lr) { return lr.value === formState.loanAmount })
    var profile = {
      creditRange: formState.creditRange,
      cosignerAvailable: formState.cosignerAvailable,
      enrollmentStatus: formState.enrollmentStatus,
      schoolType: formState.schoolType,
      degreeLevel: formState.degreeLevel,
      loanAmount: formState.loanAmount,
      loanMid: loanRange ? (loanRange.min + loanRange.max) / 2 : 15000,
      citizenshipStatus: formState.citizenshipStatus,
      state: formState.state,
    }

    // Show loading, then results
    container.innerHTML = '<div class="mie-match-wrap"><div class="mie-loading"><div class="mie-loading-dots"><div class="mie-loading-dot"></div><div class="mie-loading-dot"></div><div class="mie-loading-dot"></div></div><div class="mie-loading-text">Checking your profile against lenders...</div></div></div>'

    setTimeout(function () {
      matchResults = runMatch(profile)
      renderResults(container)
    }, 1500)
  })
}

function renderResults(container) {
  var res = matchResults
  var html = '<div class="mie-match-wrap">'

  // Result state header
  html += '<div class="mie-result-state">'
  html += '<h3>' + res.state.label + '</h3>'
  var stateMessages = {
    gb_best: 'Based on your profile, GradBridge is your strongest option. You\'re likely to be rejected by most other lenders.',
    gb_and_one: 'You have strong options. Here\'s how they compare on what matters most.',
    multiple_match: 'Good news — several lenders match your profile. Compare the details below.',
    competitor_wins: 'A competitor may offer better rates, but there\'s more to consider than rate alone.',
    rejected_widely: 'Your options are limited with most traditional lenders. Let\'s explore your best path forward.',
    borderline: 'Your profile is on the edge for several lenders. Here\'s what you should know.',
  }
  html += '<p>' + (stateMessages[res.state.key] || '') + '</p>'
  if (res.gbAdvantage > 10) {
    html += '<div style="margin-top:8px;font-size:12px;color:var(--mie-accent);font-weight:600">GradBridge Advantage Score: +' + res.gbAdvantage + '</div>'
  }
  html += '</div>'

  // Result cards
  for (var i = 0; i < res.results.length; i++) {
    var r = res.results[i]
    var isRecommended = r.isSelf && res.gbAdvantage > 10
    html += '<div class="mie-result-card' + (isRecommended ? ' recommended' : '') + '">'

    html += '<div class="mie-result-header">'
    html += '<div class="mie-result-name">'
    html += '<span class="mie-comp-dot" style="background:' + r.competitor.color + '"></span>'
    html += r.competitor.name
    if (isRecommended) html += ' <span class="mie-recommended-badge">Recommended for You</span>'
    html += '</div>'
    html += tierBadge(r.matchTier, tierLabel(r.matchTier))
    html += '</div>'

    html += scoreBar(r.matchScore, { label: 'Match Score', color: tierColor(r.matchTier) })

    // Reasons
    html += '<div class="mie-result-reasons">'
    for (var rr = 0; rr < r.reasons.length; rr++) {
      html += '<div class="mie-result-reason positive">&#x2713; ' + r.reasons[rr] + '</div>'
    }
    for (var w = 0; w < r.warnings.length; w++) {
      html += '<div class="mie-result-reason warning">&#x26A0; ' + r.warnings[w] + '</div>'
    }
    html += '</div>'

    // CTA
    if (r.isSelf) {
      html += '<div class="mie-result-cta">'
      if (r.matchScore >= 60) {
        html += '<button class="mie-result-cta-btn mie-result-cta-primary">Apply Now</button>'
        html += '<button class="mie-result-cta-btn mie-result-cta-secondary">Talk to Advisor</button>'
      } else {
        html += '<button class="mie-result-cta-btn mie-result-cta-secondary">Talk to Advisor</button>'
        html += '<button class="mie-result-cta-btn mie-result-cta-secondary">Learn More</button>'
      }
      html += '</div>'
    }

    html += '</div>'
  }

  // Confidence note
  html += '<div class="mie-confidence-note">'
  html += confidenceLabel(res.confidence)
  html += '<br><span style="margin-top:4px;display:inline-block">This tool does not perform a hard credit check. Results are estimates based on publicly available lender criteria.</span>'
  html += '</div>'

  // Reset button
  html += '<div style="text-align:center;margin-top:16px">'
  html += '<button class="mie-btn mie-btn-secondary" id="mie-match-reset">Start Over</button>'
  html += '</div>'

  html += '</div>'
  container.innerHTML = html

  // Reset handler
  document.getElementById('mie-match-reset').addEventListener('click', function () {
    matchResults = null
    formState.step = 1
    formState.creditRange = ''
    formState.cosignerAvailable = false
    formState.enrollmentStatus = ''
    formState.schoolType = ''
    formState.degreeLevel = ''
    formState.loanAmount = ''
    formState.citizenshipStatus = ''
    formState.state = ''
    renderMatchTool(container)
  })
}

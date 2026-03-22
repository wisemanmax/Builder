// Scoring formulas for the Market Intelligence Engine

// Composite score: weighted average of all dimensions
export function compositeScore(scores) {
  var w = { accessibility: 0.2, value: 0.25, pricing: 0.25, ux: 0.15, trust: 0.15 }
  var total = 0
  for (var k in w) {
    total += (scores[k] || 0) * w[k]
  }
  return Math.round(total)
}

// Determine match tier from score
export function matchTier(score) {
  if (score >= 80) return 'strong'
  if (score >= 60) return 'likely'
  if (score >= 40) return 'possible'
  if (score >= 20) return 'unlikely'
  return 'rejected'
}

export function tierLabel(tier) {
  var labels = {
    strong: 'Strong Match',
    likely: 'Likely Match',
    possible: 'Possible',
    unlikely: 'Likely Rejected',
    rejected: 'Almost Certainly Rejected',
  }
  return labels[tier] || tier
}

export function tierColor(tier) {
  var colors = { strong: '#00E676', likely: '#AAFF00', possible: '#FFD600', unlikely: '#FF9100', rejected: '#FF5252' }
  return colors[tier] || '#888'
}

// Match confidence based on data completeness
export function matchConfidence(profile, thresholdAge) {
  var points = 0
  if (profile.creditRange) points++
  if (profile.enrollmentStatus) points++
  if (profile.schoolType) points++
  if (profile.cosignerAvailable !== undefined) points++
  if (profile.loanAmount) points++
  if (profile.citizenshipStatus) points++
  if (profile.degreeLevel) points++
  if (profile.state) points++

  var age = thresholdAge || 15 // days since last data update
  if (points >= 7 && age < 30) return 'high'
  if (points >= 5 && age < 90) return 'medium'
  return 'low'
}

export function confidenceLabel(level) {
  var labels = {
    high: 'Based on your profile, we are confident in this match.',
    medium: 'This is our best estimate based on what you have shared.',
    low: 'We have limited data for this profile. Results may vary.',
  }
  return labels[level] || ''
}

// GradBridge Advantage Score
export function advantageScore(
  gbMatchScore,
  bestCompetitorScore,
  gbAccessibility,
  compAccessibility,
  gbPricing,
  compPricing,
  gbSentiment,
  compSentiment
) {
  return Math.round(
    (gbMatchScore - bestCompetitorScore) * 0.5 +
      ((gbAccessibility - compAccessibility) / 100) * 50 * 0.25 +
      ((gbPricing - compPricing) / 100) * 50 * 0.15 +
      ((gbSentiment - compSentiment) / 5) * 50 * 0.1
  )
}

// Format score for display
export function scoreColor(score) {
  if (score >= 75) return '#00E676'
  if (score >= 55) return '#AAFF00'
  if (score >= 40) return '#FFD600'
  if (score >= 25) return '#FF9100'
  return '#FF5252'
}

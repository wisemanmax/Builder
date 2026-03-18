// Match Engine: Calculates borrower match scores against each lender
import { COMPETITORS } from '../data/competitors.js'
import { THRESHOLDS, CREDIT_RANGES } from '../data/thresholds.js'
import { SENTIMENT_SCORES } from '../data/sentiment.js'
import { matchTier, matchConfidence, advantageScore } from './scoring.js'

// Calculate match score for a single borrower-competitor pair
function calcMatchScore(profile, competitorId) {
  var t = THRESHOLDS[competitorId]
  if (!t) return { score: 0, reasons: ['No data available for this lender.'] }

  var creditMid = CREDIT_RANGES[profile.creditRange] ? CREDIT_RANGES[profile.creditRange].mid : 650
  var reasons = []
  var warnings = []

  // Credit alignment (30%)
  var creditScore = 0
  var creditDelta = creditMid - t.minCredit
  if (creditDelta >= 80) { creditScore = 100; reasons.push('Your credit profile exceeds their requirements') }
  else if (creditDelta >= 40) { creditScore = 80; reasons.push('Your credit score is well within their range') }
  else if (creditDelta >= 0) { creditScore = 55; reasons.push('Your credit score meets their minimum threshold') }
  else if (creditDelta >= -30) { creditScore = 30; warnings.push('Your credit score is near or below their estimated minimum') }
  else { creditScore = 10; warnings.push('Your credit score is likely below their requirements') }

  // Enrollment compatibility (20%)
  var enrollScore = 0
  if (t.enrollmentTypes.indexOf(profile.enrollmentStatus) >= 0) {
    enrollScore = 100
    if (profile.enrollmentStatus !== 'full-time') reasons.push('Your enrollment type (' + profile.enrollmentStatus + ') is accepted')
  } else {
    enrollScore = 10
    warnings.push('Your enrollment type (' + profile.enrollmentStatus + ') may not be accepted')
  }

  // Cosigner logic (20%)
  var cosignerScore = 0
  if (profile.cosignerAvailable) {
    cosignerScore = 90
    reasons.push('Having a cosigner strengthens your application')
  } else {
    if (t.cosignerRequired === 'always') { cosignerScore = 5; warnings.push('This lender typically requires a cosigner') }
    else if (t.cosignerRequired === 'often') {
      cosignerScore = creditMid >= t.minCredit + 50 ? 50 : 20
      if (cosignerScore <= 20) warnings.push('Cosigner typically required below ' + (t.minCredit + 50) + ' credit score')
    }
    else if (t.cosignerRequired === 'sometimes') { cosignerScore = 65; reasons.push('No cosigner required at your credit tier') }
    else { cosignerScore = 95; reasons.push('No cosigner needed') }
  }

  // Loan amount fit (15%)
  var loanScore = 0
  var loanMid = profile.loanMid || 15000
  if (loanMid >= t.minLoan && loanMid <= t.maxLoan) {
    loanScore = 90
  } else if (loanMid < t.minLoan) {
    loanScore = 20
    warnings.push('Your loan amount may be below their minimum ($' + t.minLoan.toLocaleString() + ')')
  } else {
    loanScore = 40
    warnings.push('Your loan amount may exceed their maximum')
  }

  // School type eligibility (15%)
  var schoolScore = 0
  if (t.schoolTypes.indexOf(profile.schoolType) >= 0) {
    schoolScore = 100
  } else {
    schoolScore = 5
    warnings.push('This lender may not serve your school type')
  }

  // Citizenship check (bonus/penalty)
  var citizenPenalty = 0
  if (profile.citizenshipStatus && t.citizenshipTypes.indexOf(profile.citizenshipStatus) < 0) {
    citizenPenalty = -15
    warnings.push('Your citizenship status may not be eligible')
  }

  var total = Math.round(
    creditScore * 0.30
    + enrollScore * 0.20
    + cosignerScore * 0.20
    + loanScore * 0.15
    + schoolScore * 0.15
    + citizenPenalty
  )
  total = Math.max(0, Math.min(100, total))

  return {
    score: total,
    tier: matchTier(total),
    creditScore: creditScore,
    enrollScore: enrollScore,
    cosignerScore: cosignerScore,
    loanScore: loanScore,
    schoolScore: schoolScore,
    reasons: reasons,
    warnings: warnings,
  }
}

// Run profile against all competitors, return ranked results
export function runMatch(profile) {
  var results = []
  var gbResult = null

  for (var i = 0; i < COMPETITORS.length; i++) {
    var c = COMPETITORS[i]
    var match = calcMatchScore(profile, c.id)
    var result = {
      competitor: c,
      matchScore: match.score,
      matchTier: match.tier,
      confidence: matchConfidence(profile),
      reasons: match.reasons,
      warnings: match.warnings,
      isSelf: c.isSelf,
      breakdown: {
        credit: match.creditScore,
        enrollment: match.enrollScore,
        cosigner: match.cosignerScore,
        loanAmount: match.loanScore,
        school: match.schoolScore,
      },
    }
    results.push(result)
    if (c.isSelf) gbResult = result
  }

  // Sort by score descending
  results.sort(function (a, b) { return b.matchScore - a.matchScore })

  // Calculate GradBridge advantage score
  var bestNonGb = null
  for (var j = 0; j < results.length; j++) {
    if (!results[j].isSelf) { bestNonGb = results[j]; break }
  }

  var gbAdvantage = 0
  if (gbResult && bestNonGb) {
    var gbComp = COMPETITORS.find(function (c) { return c.isSelf })
    var bestComp = bestNonGb.competitor
    var gbSent = SENTIMENT_SCORES['gradbridge'] ? SENTIMENT_SCORES['gradbridge'].overall : 4.0
    var compSent = SENTIMENT_SCORES[bestComp.id] ? SENTIMENT_SCORES[bestComp.id].overall : 3.5
    gbAdvantage = advantageScore(
      gbResult.matchScore, bestNonGb.matchScore,
      gbComp.scores.accessibility, bestComp.scores.accessibility,
      gbComp.scores.pricing, bestComp.scores.pricing,
      gbSent, compSent
    )
  }

  // Determine result state and messaging variant
  var state = determineResultState(results, gbResult, gbAdvantage)

  return {
    results: results,
    gbAdvantage: gbAdvantage,
    state: state,
    confidence: matchConfidence(profile),
  }
}

function determineResultState(results, gbResult, advantage) {
  if (!gbResult) return { key: 'unknown', label: 'Unable to determine', messaging: 'trust' }

  var gbScore = gbResult.matchScore
  var topCompScore = 0
  var matchCount65 = 0
  for (var i = 0; i < results.length; i++) {
    if (!results[i].isSelf) {
      if (results[i].matchScore > topCompScore) topCompScore = results[i].matchScore
      if (results[i].matchScore >= 65) matchCount65++
    }
  }

  if (gbScore > 75 && topCompScore < 60)
    return { key: 'gb_best', label: 'GradBridge is your best fit', messaging: 'accessibility', cta: 'apply' }
  if (gbScore >= 70 && topCompScore >= 70)
    return { key: 'gb_and_one', label: 'Strong options available', messaging: 'differentiation', cta: 'apply' }
  if (matchCount65 >= 3)
    return { key: 'multiple_match', label: 'Multiple matches found', messaging: 'rate_comparison', cta: 'apply' }
  if (topCompScore > gbScore + 10)
    return { key: 'competitor_wins', label: 'Compare your options', messaging: 'non_rate', cta: 'compare' }
  if (gbScore < 50 && topCompScore < 50)
    return { key: 'rejected_widely', label: 'Limited options available', messaging: 'empathy', cta: 'advisor' }
  return { key: 'borderline', label: 'Worth exploring', messaging: 'trust', cta: 'advisor' }
}

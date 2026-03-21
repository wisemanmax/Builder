// MIE AI — GPT calls for data refresh and page generation
import {
  getCompetitors,
  getSegments,
  getSentimentScores,
  getSampleReviews,
  getAlerts,
  setCachedCompetitors,
  setCachedAlerts,
  setCachedSegments,
  setCachedSentiment,
} from './mie-data.js'

function callGPT(key, systemPrompt, userMsg, maxTokens) {
  maxTokens = maxTokens || 4000
  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: maxTokens,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
    }),
  })
    .then(function (r) {
      if (!r.ok)
        return r
          .json()
          .catch(function () {
            return {}
          })
          .then(function (e) {
            var msg = (e.error && e.error.message) || 'HTTP ' + r.status
            throw new Error(msg)
          })
      return r.json()
    })
    .then(function (d) {
      var raw = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || ''
      return raw
        .replace(/^```[\w]*\n?/, '')
        .replace(/\n?```$/, '')
        .trim()
    })
}

var SYS_REFRESH =
  'You are a student lending market intelligence analyst. You update competitive data for GradBridge, a student loan fintech. Return ONLY valid JSON matching the exact schema provided. No markdown, no commentary.'

export function refreshCompetitors(key) {
  var current = getCompetitors()
  var schema = JSON.stringify(
    current.map(function (c) {
      return {
        id: c.id,
        name: c.name,
        scores: c.scores,
        products: c.products.map(function (p) {
          return {
            name: p.name,
            fixedAprMin: p.fixedAprMin,
            fixedAprMax: p.fixedAprMax,
            variableAprMin: p.variableAprMin,
            variableAprMax: p.variableAprMax,
          }
        }),
      }
    })
  )
  var prompt =
    'Here is the current competitor data for the private student loan market:\n' +
    schema +
    '\n\nGenerate updated, realistic competitor data reflecting current 2026 market conditions. Update scores (0-100) and APR ranges based on realistic market movements. Keep the same structure. Return the full competitor array with ALL original fields preserved, just update scores and product APR values. Return as a JSON array.'

  return callGPT(key, SYS_REFRESH, prompt, 6000).then(function (raw) {
    var parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Invalid competitors format')
    // Merge updated fields back into full objects
    var merged = current.map(function (orig) {
      var updated = parsed.find(function (u) {
        return u.id === orig.id
      })
      if (!updated) return orig
      var result = Object.assign({}, orig)
      if (updated.scores) result.scores = Object.assign({}, orig.scores, updated.scores)
      if (updated.products) {
        result.products = orig.products.map(function (op, idx) {
          var up = updated.products && updated.products[idx]
          return up ? Object.assign({}, op, up) : op
        })
      }
      return result
    })
    setCachedCompetitors(merged)
    return merged
  })
}

export function refreshSentiment(key) {
  var scores = getSentimentScores()
  var reviews = getSampleReviews()
  var prompt =
    'Here are current sentiment scores for student loan lenders:\n' +
    JSON.stringify(scores) +
    '\n\nAnd sample reviews:\n' +
    JSON.stringify(reviews) +
    '\n\nGenerate updated sentiment scores (1.0-5.0 per category) and 3-5 new realistic sample reviews per lender reflecting 2026 market conditions. Categories: trust, approval_ease, application_friction, service_quality, rate_fairness, repayment_experience, digital_experience, brand_reputation. Each review needs: source (Google/Reddit/Trustpilot/CFPB), rating (1-5 or null), polarity (positive/negative/neutral), category, date (recent 2026), text, strength (1-5), actionable (boolean). Return JSON: { "scores": {...}, "reviews": {...} }'

  return callGPT(key, SYS_REFRESH, prompt, 6000).then(function (raw) {
    var parsed = JSON.parse(raw)
    if (!parsed.scores && !parsed.reviews) throw new Error('Invalid sentiment format')
    var newScores = parsed.scores || scores
    var newReviews = parsed.reviews || reviews
    setCachedSentiment(newScores, newReviews)
    return { scores: newScores, reviews: newReviews }
  })
}

export function refreshSegments(key) {
  var current = getSegments()
  var prompt =
    'Here are current underserved borrower segments for the student lending market:\n' +
    JSON.stringify(
      current.map(function (s) {
        return {
          id: s.id,
          name: s.name,
          opportunityScore: s.opportunityScore,
          rejectionRate: s.rejectionRate,
          gbApprovalProbability: s.gbApprovalProbability,
          marketSizeIndex: s.marketSizeIndex,
          competitorGap: s.competitorGap,
        }
      })
    ) +
    '\n\nGenerate updated opportunity scores, rejection rates, and market size indices reflecting 2026 conditions. Return as a JSON array with the same fields.'

  return callGPT(key, SYS_REFRESH, prompt, 4000).then(function (raw) {
    var parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Invalid segments format')
    var merged = current.map(function (orig) {
      var updated = parsed.find(function (u) {
        return u.id === orig.id
      })
      if (!updated) return orig
      return Object.assign({}, orig, {
        opportunityScore: updated.opportunityScore || orig.opportunityScore,
        rejectionRate: updated.rejectionRate || orig.rejectionRate,
        gbApprovalProbability: updated.gbApprovalProbability || orig.gbApprovalProbability,
        marketSizeIndex: updated.marketSizeIndex || orig.marketSizeIndex,
        competitorGap: updated.competitorGap || orig.competitorGap,
      })
    })
    setCachedSegments(merged)
    return merged
  })
}

export function refreshAlerts(key) {
  var current = getAlerts()
  var competitors = getCompetitors()
  var prompt =
    'Here are current competitive alerts in the private student loan market:\n' +
    JSON.stringify(current) +
    '\n\nCompetitors: ' +
    competitors
      .map(function (c) {
        return c.name
      })
      .join(', ') +
    '\n\nGenerate 3-4 new realistic competitive alerts for March 2026. Types: sentiment, rate_change, product. Severities: high, medium, low. Each alert needs: id, type, severity, date (2026-03-XX), title, description, competitor (slug), action. Return as a JSON array.'

  return callGPT(key, SYS_REFRESH, prompt, 3000).then(function (raw) {
    var parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Invalid alerts format')
    setCachedAlerts(parsed)
    return parsed
  })
}

export function refreshAll(key) {
  return Promise.all([
    refreshCompetitors(key).catch(function (e) {
      return { error: 'competitors: ' + e.message }
    }),
    refreshSentiment(key).catch(function (e) {
      return { error: 'sentiment: ' + e.message }
    }),
    refreshSegments(key).catch(function (e) {
      return { error: 'segments: ' + e.message }
    }),
    refreshAlerts(key).catch(function (e) {
      return { error: 'alerts: ' + e.message }
    }),
  ]).then(function (results) {
    var errors = results.filter(function (r) {
      return r && r.error
    })
    if (errors.length > 0) {
      throw new Error(
        errors
          .map(function (e) {
            return e.error
          })
          .join('; ')
      )
    }
    return results
  })
}

export function refreshSection(key, section) {
  switch (section) {
    case 'competitors':
      return refreshCompetitors(key)
    case 'sentiment':
      return refreshSentiment(key)
    case 'segments':
      return refreshSegments(key)
    case 'alerts':
      return refreshAlerts(key)
    default:
      throw new Error('Unknown section: ' + section)
  }
}

export function generatePage(key, prompt, onComplete) {
  var competitors = getCompetitors()
  var sentiment = getSentimentScores()
  var segments = getSegments()

  var sysPrompt =
    'You are a market intelligence analyst for GradBridge, a student loan fintech. Generate an analytical page as a self-contained HTML snippet (no <html>, <head>, or <body> tags — just the content div). Use inline styles matching a dark theme (background: transparent, text: #e0e0e0, accent: #FF3CAC, secondary: #3D5AFE). Include charts using inline SVG or CSS-based visualizations. The content should be data-driven and insightful.'

  var userMsg =
    'User request: "' +
    prompt +
    '"\n\nAvailable data:\nCompetitors: ' +
    JSON.stringify(
      competitors.map(function (c) {
        return { id: c.id, name: c.name, scores: c.scores, products: c.products }
      })
    ) +
    '\nSentiment: ' +
    JSON.stringify(sentiment) +
    '\nSegments: ' +
    JSON.stringify(
      segments.map(function (s) {
        return { id: s.id, name: s.name, opportunityScore: s.opportunityScore, rejectionRate: s.rejectionRate }
      })
    ) +
    '\n\nGenerate a rich HTML content snippet analyzing this request with the available data. Include visualizations, comparisons, and actionable insights. Return ONLY the HTML.'

  return callGPT(key, sysPrompt, userMsg, 8000)
}

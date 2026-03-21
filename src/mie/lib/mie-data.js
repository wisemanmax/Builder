// MIE Data Store — cache layer over hardcoded data
import { COMPETITORS, SCORE_DIMENSIONS, MAP_DIMENSIONS, COMPETITIVE_ALERTS } from '../data/competitors.js'
import { SEGMENTS } from '../data/segments.js'
import { SENTIMENT_SCORES, SENTIMENT_LABELS, SENTIMENT_CATEGORIES, SAMPLE_REVIEWS } from '../data/sentiment.js'

var CACHE_KEY = 'mie_cache'
var PAGES_KEY = 'mie_custom_pages'
var _cache = null

function loadCache() {
  if (_cache) return _cache
  try {
    var raw = localStorage.getItem(CACHE_KEY)
    _cache = raw ? JSON.parse(raw) : {}
  } catch (e) {
    _cache = {}
  }
  return _cache
}

function saveCache(section, data) {
  var c = loadCache()
  c[section] = data
  c._ts = Date.now()
  _cache = c
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch (e) {}
}

export function getCompetitors() {
  var c = loadCache()
  return c.competitors || COMPETITORS
}

export function getScoreDimensions() {
  return SCORE_DIMENSIONS
}
export function getMapDimensions() {
  return MAP_DIMENSIONS
}

export function getAlerts() {
  var c = loadCache()
  return c.alerts || COMPETITIVE_ALERTS
}

export function getSegments() {
  var c = loadCache()
  return c.segments || SEGMENTS
}

export function getSentimentScores() {
  var c = loadCache()
  return c.sentimentScores || SENTIMENT_SCORES
}

export function getSampleReviews() {
  var c = loadCache()
  return c.sampleReviews || SAMPLE_REVIEWS
}

export function getSentimentLabels() {
  return SENTIMENT_LABELS
}
export function getSentimentCategories() {
  return SENTIMENT_CATEGORIES
}

export function getCacheTimestamp() {
  var c = loadCache()
  return c._ts || null
}

export function clearCache() {
  _cache = {}
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch (e) {}
}

export function hasApiKey() {
  var k = localStorage.getItem('bldr_gptKey')
  return !!(k && k.trim())
}

export function getApiKey() {
  return (localStorage.getItem('bldr_gptKey') || '').trim()
}

export function setCachedCompetitors(data) {
  saveCache('competitors', data)
}
export function setCachedAlerts(data) {
  saveCache('alerts', data)
}
export function setCachedSegments(data) {
  saveCache('segments', data)
}
export function setCachedSentiment(scores, reviews) {
  var c = loadCache()
  c.sentimentScores = scores
  c.sampleReviews = reviews
  c._ts = Date.now()
  _cache = c
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch (e) {}
}

// Custom pages
export function getCustomPages() {
  try {
    var raw = localStorage.getItem(PAGES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    return []
  }
}

export function saveCustomPage(page) {
  var pages = getCustomPages()
  var idx = pages.findIndex(function (p) {
    return p.id === page.id
  })
  if (idx >= 0) pages[idx] = page
  else pages.push(page)
  try {
    localStorage.setItem(PAGES_KEY, JSON.stringify(pages))
  } catch (e) {}
}

export function deleteCustomPage(id) {
  var pages = getCustomPages().filter(function (p) {
    return p.id !== id
  })
  try {
    localStorage.setItem(PAGES_KEY, JSON.stringify(pages))
  } catch (e) {}
}

export function getCustomPage(id) {
  return (
    getCustomPages().find(function (p) {
      return p.id === id
    }) || null
  )
}

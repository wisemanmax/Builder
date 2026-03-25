import {
  retryStep,
  resolveThoughtContext,
  saveAppLocally,
  notifyUser,
  formatTemplateInjection,
  ST,
  persist,
  persistBuildSession,
  clearBuildSession,
  checkPipelineCancel,
  clearPipelineCancel,
  $,
  esc,
  toast,
  grad,
  uniqueSlug,
  autoName,
  scrubKeys,
  ghPageUrl,
  callClaudeRaw,
  callClaude,
  callClaudeWithThinkingStream,
  callGPTRaw2,
  resetCostAccum,
  calculateBuildCost,
  ghCreateBranch,
  ghPushFile,
  ghGetFileSha,
  ghMergeBranch,
  ghDeleteBranch,
  ghPushManifest,
  runLocalChecks,
  addMsg,
  updatePS,
  setPreview,
  clearPreview,
  waitForApproval,
  createStreamingPreview,
  autoInjectSupabase,
  showFeedbackCard,
  renderGrid,
  openProjectSheet,
  injectProfileContext,
  getThoughtDesignOverrides,
  getTemplateSkeleton,
  telemetry,
  shouldSkipStep,
  buildResumeContext,
} from './pipeline-shared.js'
import { waitForBlueprintApproval } from '../components/approval-card.js'
import {
  SYS_STITCH_ENHANCE,
  SYS_STITCH_VERIFY,
  GPT4O_STITCH_REVIEW,
  SYS_STITCH_FIX1,
  SYS_STITCH_FIX2,
} from '../config/prompts-stitch.js'
import { PIPE5_STATUS, GRADS } from '../config/constants.js'
import { fetchWithRetry } from '../lib/ai.js'
import { updateStitchStage, updateStitchEstimate, updateStitchTime } from '../components/stitch-tracker.js'

// --- Stitch API helpers ---

var STITCH_MCP_URL = 'https://stitch.googleapis.com/mcp'

function stitchHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': ST.stitchKey,
  }
}

var _stitchProjectId = null

function _mcpCall(method, params) {
  return fetchWithRetry(
    STITCH_MCP_URL,
    {
      method: 'POST',
      headers: stitchHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', method: method, params: params || {}, id: Date.now() }),
    },
    120000
  )
    .then(function (r) {
      if (!r.ok) {
        return r
          .json()
          .catch(function () {
            return {}
          })
          .then(function (e) {
            var msg = (e.error && e.error.message) || 'HTTP ' + r.status
            throw new Error('Stitch: ' + scrubKeys(msg))
          })
      }
      return r.json()
    })
    .then(function (rpc) {
      if (rpc.error) {
        throw new Error('Stitch: ' + scrubKeys(rpc.error.message || JSON.stringify(rpc.error)))
      }
      return rpc.result
    })
}

function _ensureProject() {
  if (_stitchProjectId) return Promise.resolve(_stitchProjectId)
  return _mcpCall('tools/call', {
    name: 'create_project',
    arguments: { title: 'Builder App' },
  }).then(function (result) {
    var content = (result && result.content) || []
    for (var i = 0; i < content.length; i++) {
      if (content[i].type === 'text') {
        try {
          var parsed = JSON.parse(content[i].text)
          _stitchProjectId = parsed.projectId || parsed.id || null
        } catch (e) {
          // Try extracting project ID from plain text
          var match = (content[i].text || '').match(/[a-zA-Z0-9_-]{10,}/)
          if (match) _stitchProjectId = match[0]
        }
      }
    }
    return _stitchProjectId
  })
}

/**
 * Strip markdown code fences from text, returning inner content.
 */
function _stripCodeFences(text) {
  // Match ```html ... ``` or ``` ... ```
  var match = text.match(/```(?:html|htm)?\s*\n?([\s\S]*?)```/)
  return match ? match[1].trim() : text
}

function callStitchBlueprint(appDescription) {
  return _ensureProject()
    .then(function (projectId) {
      var args = { prompt: appDescription }
      if (projectId) args.projectId = projectId
      return _mcpCall('tools/call', {
        name: 'generate_screen_from_text',
        arguments: args,
      })
    })
    .then(function (result) {
      var content = (result && result.content) || []
      var html = ''
      for (var i = 0; i < content.length; i++) {
        var item = content[i]
        if (item.type === 'text') {
          var text = item.text || ''
          // Strip markdown code fences if present
          var stripped = _stripCodeFences(text)
          // Check if it contains HTML tags
          if (stripped.indexOf('<') >= 0 && stripped.indexOf('>') >= 0) {
            html = stripped
            break
          }
          // Try parsing as JSON with html/code field
          try {
            var parsed = JSON.parse(text)
            html =
              parsed.html ||
              parsed.scaffold ||
              parsed.code ||
              parsed.screen ||
              parsed.content ||
              parsed.output ||
              parsed.result ||
              ''
            if (html) {
              html = _stripCodeFences(html)
              break
            }
          } catch (e) {
            /* not JSON, continue */
          }
        }
      }
      // If no HTML found in text blocks, check for resource content
      if (!html) {
        for (var j = 0; j < content.length; j++) {
          var item2 = content[j]
          if (item2.type === 'resource' && item2.resource) {
            var res = item2.resource
            if (res.text && res.text.length > 10) {
              // Accept any resource with HTML content, not just html mime type
              var resText = _stripCodeFences(res.text)
              if (resText.indexOf('<') >= 0) {
                html = resText
                break
              }
            }
          }
          // Handle blob/base64 content
          if (item2.type === 'resource' && item2.resource && item2.resource.blob) {
            try {
              var decoded = atob(item2.resource.blob)
              if (decoded.indexOf('<') >= 0 && decoded.indexOf('>') >= 0) {
                html = decoded
                break
              }
            } catch (e) {
              /* not valid base64 */
            }
          }
        }
      }
      if (!html || html.length < 50) {
        throw new Error('Stitch: Blueprint returned empty or invalid HTML')
      }
      return html
    })
}

// --- Progressive Learner storage ---

function storeInProgressiveLearner(runId, stageKey, data) {
  try {
    var plKey = 'bldr_pl_' + runId
    var existing = JSON.parse(localStorage.getItem(plKey) || '{}')
    existing[stageKey] = {
      data: data,
      ts: new Date().toISOString(),
    }
    localStorage.setItem(plKey, JSON.stringify(existing))
  } catch (e) {
    // Storage quota — non-critical
    console.warn('[Stitch PL] Storage failed for ' + stageKey + ':', e.message)
  }
}

// --- Retry logic with exponential backoff & rate limit handling ---

function retryStage(fn, stageName, maxRetries, statusCallback) {
  return retryStep(fn, maxRetries, stageName, { statusCallback: statusCallback, retryRateLimits: true })
}

// --- Stage implementations ---

/**
 * Stage 1 — Intake (The Contract)
 * Pull Thought Engine output + user rules, prep full context payload.
 * NEW: Generate a Data Mapping Schema to prevent Claude from guessing where data goes.
 */
function runIntake(context) {
  var thoughtCtx = resolveThoughtContext()
  var specText = thoughtCtx.specText
  var rulesText = thoughtCtx.rulesText
  var activeThought = thoughtCtx.activeThought
  var dataMapping = []

  if (activeThought && activeThought.brief) {
    dataMapping = _generateDataMapping(activeThought.brief)
  }

  return {
    prompt: context.prompt,
    specText: specText,
    rulesText: rulesText,
    dataMapping: dataMapping,
    activeThought: activeThought,
    appDescription: _buildAppDescription(context, specText, rulesText),
  }
}

/**
 * Generate a Data Mapping Schema from the thought brief.
 * Maps UI fields/features to their storage keys in localStorage/Supabase.
 * This prevents Claude from inventing arbitrary data keys during hydration.
 */
function _generateDataMapping(brief) {
  var mappings = []
  var appName = (brief.name || 'app').toLowerCase().replace(/[^a-z0-9]/g, '_')

  // Map each feature to a storage key
  var features = brief.features || []
  for (var i = 0; i < features.length; i++) {
    var feature = features[i]
    var slug = feature
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
    mappings.push({
      uiElement: feature,
      storageKey: appName + '_' + slug,
      storageType: 'localStorage',
      dataType: 'array',
    })
  }

  // Map common UI patterns to standard keys
  var whatItDoes = brief.whatItDoes || []
  for (var j = 0; j < whatItDoes.length; j++) {
    var action = whatItDoes[j].toLowerCase()
    if (action.indexOf('user') >= 0 || action.indexOf('profile') >= 0 || action.indexOf('account') >= 0) {
      mappings.push({
        uiElement: 'User Profile',
        storageKey: appName + '_user_profile',
        storageType: 'localStorage',
        dataType: 'object',
      })
    }
    if (action.indexOf('setting') >= 0 || action.indexOf('preference') >= 0 || action.indexOf('config') >= 0) {
      mappings.push({
        uiElement: 'Settings',
        storageKey: appName + '_settings',
        storageType: 'localStorage',
        dataType: 'object',
      })
    }
    if (
      action.indexOf('list') >= 0 ||
      action.indexOf('item') >= 0 ||
      action.indexOf('task') >= 0 ||
      action.indexOf('todo') >= 0
    ) {
      mappings.push({
        uiElement: 'Items List',
        storageKey: appName + '_items',
        storageType: 'localStorage',
        dataType: 'array',
      })
    }
  }

  // Always include app state key
  mappings.push({
    uiElement: 'App State',
    storageKey: appName + '_state',
    storageType: 'localStorage',
    dataType: 'object',
  })

  return mappings
}

/**
 * Build a comprehensive app description from all context sources.
 */
function _buildAppDescription(context, specText, rulesText) {
  var desc = context.prompt || ''
  if (specText !== 'No specification provided') {
    desc += '\n\nAPP SPECIFICATION:\n' + specText
  }
  if (rulesText !== 'No specific rules') {
    desc += '\n\nDESIGN RULES:\n' + rulesText
  }
  if (context._templateSkeleton) {
    desc +=
      '\n\nTEMPLATE SKELETON (use as your starting architecture — expand, customize, and fill in all features):\n' +
      context._templateSkeleton +
      '\n\nUse the skeleton above as your base structure. Keep its layout pattern, state shape, and responsive strategy. Replace all placeholder content with fully implemented features.'
  }
  return desc
}

var SYS_CLAUDE_BLUEPRINT =
  'You are a senior UI engineer. Generate a clean, well-structured HTML scaffold for the requested app.\n' +
  '\nOUTPUT RULES:\n' +
  '1. Return ONLY raw HTML — no markdown, no code fences, no explanation\n' +
  '2. All CSS inside <style>, all JS inside <script>\n' +
  '3. ZERO external dependencies — no CDN scripts/links. You may use @import for Google Fonts only\n' +
  '4. Must work as a standalone HTML file. Begin with <!DOCTYPE html>\n' +
  '5. Focus on LAYOUT and STRUCTURE — create the full visual scaffold with placeholder content\n' +
  '6. Include all screens/views, navigation, modals, and interactive elements as HTML structure\n' +
  '7. Style it beautifully with a modern dark theme by default, responsive design, and clean typography\n' +
  '8. Add minimal JS: view switching, modal toggles, navigation — but NOT full business logic\n' +
  '9. Use semantic HTML: <header>, <main>, <nav>, <section>, <button>\n' +
  '10. Mobile-first responsive design with CSS Grid/Flexbox\n' +
  '\nThis scaffold will be enhanced with full logic in the next stage. Focus on creating a complete, beautiful UI shell.'

/**
 * Extract the structural tag skeleton from HTML (tags only, no text/attributes content values).
 * Used to generate a "clean copy" fingerprint for structure diffing in Stage 4.
 */
function _extractHtmlStructure(html) {
  // Extract all opening and self-closing HTML tags with their tag names
  var tags = html.match(/<\/?[a-zA-Z][a-zA-Z0-9]*[^>]*\/?>/g) || []
  // Normalize: keep only tag names and key structural attributes (id, class, data-)
  var structure = []
  for (var i = 0; i < tags.length; i++) {
    var tag = tags[i]
    // Extract tag name
    var nameMatch = tag.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/)
    if (!nameMatch) continue
    var tagName = nameMatch[1].toLowerCase()
    // Skip script/style content tags — we only care about DOM structure
    if (tagName === 'script' || tagName === 'style') continue
    structure.push(tag.replace(/\s+/g, ' ').trim())
  }
  return structure
}

/**
 * Generate a simple hash of an array of strings for quick comparison.
 */
function _simpleHash(arr) {
  var str = arr.join('|')
  var hash = 0
  for (var i = 0; i < str.length; i++) {
    var ch = str.charCodeAt(i)
    hash = (hash << 5) - hash + ch
    hash = hash & hash // Convert to 32-bit integer
  }
  return 'sh_' + Math.abs(hash).toString(36)
}

/**
 * Stage 2 — Blueprint (Stitch)
 * Call Stitch API with app description → return HTML scaffold.
 * Falls back to Claude if Stitch API fails.
 * NEW: Output is now LOCKED. Saves a clean copy + structural hash for Stage 4 diffing.
 */
function runBlueprint(intakePayload) {
  return callStitchBlueprint(intakePayload.appDescription)
    .catch(function (stitchErr) {
      console.warn('[Stitch] Blueprint API failed, falling back to Claude:', stitchErr.message)
      // Fall back to Claude for scaffold generation
      return callClaude(SYS_CLAUDE_BLUEPRINT, intakePayload.appDescription, 0.4).then(function (html) {
        if (!html || html.length < 50) {
          throw new Error('Blueprint fallback also returned empty HTML (original: ' + stitchErr.message + ')')
        }
        return html
      })
    })
    .then(function (html) {
      // Lock the blueprint: save clean copy structure for Stage 4 comparison
      var structure = _extractHtmlStructure(html)
      return {
        html: html,
        cleanCopy: {
          structure: structure,
          hash: _simpleHash(structure),
          tagCount: structure.length,
        },
      }
    })
}

/**
 * Stage 3 — Assemble (Claude "Hydration")
 * Pass Stitch HTML + full context + Data Mapping Schema to Claude using SYS_STITCH_ENHANCE.
 * Claude is forbidden from adding new HTML tags — hydration only.
 */
function runAssemble(stitchHTML, intakePayload, streamPreview) {
  var sys = SYS_STITCH_ENHANCE

  // Inject user rules into system prompt
  if (intakePayload.rulesText !== 'No specific rules') {
    sys += '\n\nUSER RULES (follow these constraints strictly):\n' + intakePayload.rulesText
  }

  // Inject spec into system prompt
  if (intakePayload.specText !== 'No specification provided') {
    sys += '\n\nAPP SPECIFICATION (from user ideation session):\n' + intakePayload.specText
  }

  // Inject Data Mapping Schema so Claude knows exactly where data goes
  if (intakePayload.dataMapping && intakePayload.dataMapping.length > 0) {
    sys += '\n\nDATA MAPPING SCHEMA (use these exact keys — do NOT invent your own):\n'
    for (var i = 0; i < intakePayload.dataMapping.length; i++) {
      var m = intakePayload.dataMapping[i]
      sys +=
        '- UI: "' +
        m.uiElement +
        '" → storage: ' +
        m.storageType +
        '["' +
        m.storageKey +
        '"] (type: ' +
        m.dataType +
        ')\n'
    }
  }

  // Inject profile context (org identity, global rules, learned preferences)
  sys = injectProfileContext(sys)

  var userMsg =
    '⛔ STITCH BLUEPRINT — STRUCTURE-LOCKED SCAFFOLD ⛔\n' +
    'This HTML is IMMUTABLE. Your output will be machine-diffed tag-by-tag against this scaffold.\n' +
    'Add JavaScript logic inside <script> and CSS inside <style> ONLY. Do NOT add, remove, or modify ANY HTML tags in <body>.\n\n' +
    stitchHTML +
    '\n\nORIGINAL USER REQUEST:\n' +
    intakePayload.prompt

  var _assembleThinking = ''
  return callClaudeWithThinkingStream(sys, userMsg, 10000, function (type, text) {
    if (type === 'thinking') {
      _assembleThinking += text
    } else if (type === 'text' && streamPreview) {
      streamPreview.pushChunk(text)
    }
  }).then(function (html) {
    if (streamPreview) {
      streamPreview.finalize(html)
      streamPreview.destroy()
    }
    return { html: html, thinkingText: _assembleThinking }
  })
}

/**
 * Stage 4 — Verify (Automated Guardrails)
 * Run automated checks + Structure Diff → return checksReport JSON.
 * NEW: Compares assembled HTML structure against Blueprint clean copy.
 * If Claude added even one <div>, the build fails and loops back to Stage 3.
 *
 * @param {string} assembledHTML - The assembled HTML from Stage 3
 * @param {Object} [blueprintCleanCopy] - The clean copy from Stage 2 { structure, hash, tagCount }
 */
function runVerify(assembledHTML, blueprintCleanCopy) {
  // Run local static analysis checks
  var localChecks = runLocalChecks(assembledHTML)

  // Build structured report
  var htmlValidity = { passed: true, issues: [] }
  var brokenRefs = { passed: true, issues: [] }
  var accessibility = { passed: true, issues: [] }
  var responsive = { passed: true, issues: [] }
  var totalElements = 0
  var withHandlers = 0
  var orphaned = []

  for (var i = 0; i < localChecks.length; i++) {
    var c = localChecks[i]
    if (!c.passed) {
      var issue = c.label + (c.detail ? ' — ' + c.detail : '')
      if (c.cat === 'Syntax' || c.cat === 'Structure') {
        htmlValidity.passed = false
        htmlValidity.issues.push(issue)
      } else if (c.cat === 'Accessibility') {
        accessibility.passed = false
        accessibility.issues.push(issue)
      } else if (c.cat === 'Responsive') {
        responsive.passed = false
        responsive.issues.push(issue)
      } else {
        brokenRefs.issues.push(issue)
      }
    }
  }
  if (brokenRefs.issues.length) brokenRefs.passed = false

  // Count interactive elements in HTML
  var buttonMatches = assembledHTML.match(/<button[\s>]/gi)
  var inputMatches = assembledHTML.match(/<input[\s>]/gi)
  var formMatches = assembledHTML.match(/<form[\s>]/gi)
  var linkMatches = assembledHTML.match(/<a[\s][^>]*href/gi)
  totalElements =
    (buttonMatches ? buttonMatches.length : 0) +
    (inputMatches ? inputMatches.length : 0) +
    (formMatches ? formMatches.length : 0) +
    (linkMatches ? linkMatches.length : 0)

  // Check for addEventListener or onclick to estimate handler coverage
  var handlerMatches = assembledHTML.match(/addEventListener|onclick|onsubmit|onchange|oninput/gi)
  withHandlers = handlerMatches ? handlerMatches.length : 0

  // --- Structure Diff: compare against Blueprint clean copy ---
  var structureDiff = { passed: true, addedTags: [], removedTags: [], violations: 0 }

  if (blueprintCleanCopy && blueprintCleanCopy.structure) {
    var assembledStructure = _extractHtmlStructure(assembledHTML)
    var assembledHash = _simpleHash(assembledStructure)

    if (assembledHash !== blueprintCleanCopy.hash) {
      // Hashes differ — find which tags were added/removed
      var blueprintSet = {}
      for (var bi = 0; bi < blueprintCleanCopy.structure.length; bi++) {
        var bTag = blueprintCleanCopy.structure[bi]
        blueprintSet[bTag] = (blueprintSet[bTag] || 0) + 1
      }
      var assembledSet = {}
      for (var ai = 0; ai < assembledStructure.length; ai++) {
        var aTag = assembledStructure[ai]
        assembledSet[aTag] = (assembledSet[aTag] || 0) + 1
      }

      // Find added tags (in assembled but not in blueprint)
      for (var tag in assembledSet) {
        var diff = assembledSet[tag] - (blueprintSet[tag] || 0)
        if (diff > 0) {
          for (var d = 0; d < diff; d++) {
            structureDiff.addedTags.push(tag.length > 80 ? tag.slice(0, 80) + '…' : tag)
          }
        }
      }

      // Find removed tags (in blueprint but not in assembled)
      for (var rTag in blueprintSet) {
        var rDiff = blueprintSet[rTag] - (assembledSet[rTag] || 0)
        if (rDiff > 0) {
          for (var rd = 0; rd < rDiff; rd++) {
            structureDiff.removedTags.push(rTag.length > 80 ? rTag.slice(0, 80) + '…' : rTag)
          }
        }
      }

      structureDiff.violations = structureDiff.addedTags.length
      if (structureDiff.violations > 0) {
        structureDiff.passed = false
      }
    }
  }

  // Also detect STRUCTURAL_GAP comments left by Claude
  var gapMatches = assembledHTML.match(/STRUCTURAL_GAP:\s*[^\n*]+/g) || []
  var structuralGaps = gapMatches.map(function (g) {
    return g.replace('STRUCTURAL_GAP:', '').trim()
  })

  var failCount = localChecks.filter(function (c) {
    return !c.passed
  }).length
  // Structure violations count as failures too
  if (!structureDiff.passed) failCount += structureDiff.violations
  var totalCount = localChecks.length + (blueprintCleanCopy ? 1 : 0)
  var score = totalCount > 0 ? Math.round(((totalCount - Math.min(failCount, totalCount)) / totalCount) * 100) : 100

  return {
    valid: htmlValidity.passed,
    score: score,
    htmlValidity: htmlValidity,
    brokenReferences: brokenRefs,
    contentManifest: {
      totalElements: totalElements,
      withHandlers: withHandlers,
      orphaned: orphaned,
    },
    accessibility: accessibility,
    responsive: responsive,
    logicCompleteness: {
      passed: /DOMContentLoaded/.test(assembledHTML) && /localStorage/.test(assembledHTML),
      issues: (!/DOMContentLoaded/.test(assembledHTML) ? ['Missing DOMContentLoaded init'] : []).concat(
        !/localStorage/.test(assembledHTML) ? ['Missing localStorage persistence'] : []
      ),
    },
    structureDiff: structureDiff,
    structuralGaps: structuralGaps,
    summary:
      score >= 80
        ? 'Good quality — ' + failCount + ' minor issues'
        : 'Needs attention — ' + failCount + ' issues found',
    localChecks: localChecks,
  }
}

/**
 * Stage 5 — Review
 * Send assembledHTML + checksReport to GPT-4o → parse reviewFindings[].
 */
function runReview(assembledHTML, checksReport) {
  var userMsg =
    'HTML APP:\n\n' + assembledHTML.slice(0, 60000) + '\n\nCHECKS REPORT:\n' + JSON.stringify(checksReport, null, 2)
  return callGPTRaw2(GPT4O_STITCH_REVIEW, userMsg, 4000).then(function (raw) {
    try {
      var parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) parsed = []
      return parsed
    } catch (e) {
      // Try to extract JSON array from response
      var match = raw.match(/\[[\s\S]*\]/)
      if (match) {
        try {
          return JSON.parse(match[0])
        } catch (e2) {
          /* fall through */
        }
      }
      return []
    }
  })
}

/**
 * Populate the expandable findings panel in the stitch tracker.
 */
function populateReviewFindings(containerId, findings) {
  var body = $(containerId + '-review-body')
  if (!body) return
  if (!findings || !findings.length) {
    body.innerHTML = '<div class="stitch-review-empty">No issues found — app passed GPT-4o review.</div>'
    return
  }
  var html = ''
  var critCount = 0,
    warnCount = 0,
    infoCount = 0
  for (var i = 0; i < findings.length; i++) {
    var f = findings[i]
    var sev = (f.severity || 'info').toLowerCase()
    if (sev === 'critical') critCount++
    else if (sev === 'warning') warnCount++
    else infoCount++
    var sevColor = sev === 'critical' ? '#ff5252' : sev === 'warning' ? '#ffd600' : '#64b5f6'
    var sevIcon = sev === 'critical' ? '\u2717' : sev === 'warning' ? '\u26A0' : '\u2139'
    html +=
      '<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)">' +
      '<div style="display:flex;align-items:center;gap:6px">' +
      '<span style="color:' +
      sevColor +
      ';font-size:11px;font-weight:700">' +
      sevIcon +
      ' ' +
      esc(sev.toUpperCase()) +
      '</span>' +
      '<span style="font-size:10px;color:rgba(255,255,255,.4);font-family:var(--fm)">' +
      esc(f.location || '') +
      '</span>' +
      '</div>' +
      '<div style="font-size:11px;color:rgba(255,255,255,.7);margin-top:2px">' +
      esc(f.description || '') +
      '</div>' +
      (f.suggestedFix
        ? '<div style="font-size:10px;color:rgba(139,92,246,.7);margin-top:2px">Fix: ' + esc(f.suggestedFix) + '</div>'
        : '') +
      '</div>'
  }
  var summary =
    '<div style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:6px">' +
    critCount +
    ' critical \u00B7 ' +
    warnCount +
    ' warning \u00B7 ' +
    infoCount +
    ' info' +
    '</div>'
  body.innerHTML = summary + html
}

/**
 * Stage 6 — Polish
 * Feed HTML + reviewFindings[] to Claude using SYS_STITCH_FIX1.
 * If critical findings existed, re-run Stage 4 checks — if issues remain fire SYS_STITCH_FIX2.
 */
/**
 * Stage 6 — Polish (Claude "The Surgeon")
 * Feed HTML + reviewFindings[] to Claude using Functional Patching.
 * Claude locates specific functions/blocks and replaces only that logic.
 *
 * @param {string} assembledHTML
 * @param {Array} reviewFindings
 * @param {Object} [cleanCopy] - Blueprint clean copy for re-verification
 */
function runPolish(assembledHTML, reviewFindings, cleanCopy) {
  var hasCritical = reviewFindings.some(function (f) {
    return (f.severity || '').toLowerCase() === 'critical'
  })
  var hasWarning = reviewFindings.some(function (f) {
    return (f.severity || '').toLowerCase() === 'warning'
  })

  // If no critical/warning findings, skip polish
  if (!hasCritical && !hasWarning) {
    return Promise.resolve({ html: assembledHTML, secondPass: false })
  }

  var findingsText = JSON.stringify(reviewFindings, null, 2)
  var userMsg =
    'REVIEW FINDINGS (apply Functional Patching — fix ONLY the specific functions/blocks listed):\n' +
    findingsText +
    '\n\nHTML APP TO PATCH:\n\n' +
    assembledHTML.slice(0, 60000)
  var sys = injectProfileContext(SYS_STITCH_FIX1)

  return callClaude(sys, userMsg, 0.2).then(function (patchedV1) {
    if (!hasCritical) {
      return { html: patchedV1, secondPass: false }
    }
    // Re-run Stage 4 checks on patched v1 (with structure diff)
    var recheck = runVerify(patchedV1, cleanCopy)
    var stillHasIssues = recheck.score < 80

    if (!stillHasIssues) {
      return { html: patchedV1, secondPass: false }
    }

    // Second pass repair
    var recheckText = JSON.stringify(recheck, null, 2)
    var userMsg2 =
      'REMAINING ISSUES (from re-verification — apply Functional Patching):\n' +
      recheckText +
      '\n\nHTML APP:\n\n' +
      patchedV1.slice(0, 60000)
    var sys2 = injectProfileContext(SYS_STITCH_FIX2)

    return callClaude(sys2, userMsg2, 0.2).then(function (finalHTML) {
      return { html: finalHTML, secondPass: true }
    })
  })
}

/**
 * Generate a Build Manifest summarizing which requirements were met,
 * structural gaps identified, and overall build quality.
 */
function _generateBuildManifest(intakePayload, checksReport, reviewFindings, cleanCopy) {
  var manifest = {
    timestamp: new Date().toISOString(),
    requirementsMet: [],
    requirementsPartial: [],
    structuralGaps: [],
    qualityScore: checksReport ? checksReport.score : 0,
    structureIntegrity: 'unknown',
    reviewFindingsSummary: { critical: 0, warning: 0, info: 0, total: 0 },
  }

  // Map features to requirement status
  var brief = (intakePayload.activeThought && intakePayload.activeThought.brief) || {}
  var features = brief.features || []
  var whatItDoes = brief.whatItDoes || []

  // All features from the brief are "requirements"
  var allReqs = features.concat(whatItDoes)
  for (var i = 0; i < allReqs.length; i++) {
    manifest.requirementsMet.push(allReqs[i])
  }

  // Structural gaps from STRUCTURAL_GAP comments in the code
  if (checksReport && checksReport.structuralGaps) {
    manifest.structuralGaps = checksReport.structuralGaps
    // Move any gapped requirements from "met" to "partial"
    for (var g = 0; g < manifest.structuralGaps.length; g++) {
      var gap = manifest.structuralGaps[g].toLowerCase()
      for (var r = manifest.requirementsMet.length - 1; r >= 0; r--) {
        if (manifest.requirementsMet[r].toLowerCase().indexOf(gap.split(' ')[0]) >= 0) {
          manifest.requirementsPartial.push(
            manifest.requirementsMet.splice(r, 1)[0] + ' (structural gap — missing from blueprint)'
          )
        }
      }
    }
  }

  // Structure integrity
  if (cleanCopy && checksReport && checksReport.structureDiff) {
    manifest.structureIntegrity = checksReport.structureDiff.passed
      ? 'intact'
      : 'modified (' + checksReport.structureDiff.violations + ' violations)'
  }

  // Review findings summary
  if (reviewFindings && reviewFindings.length) {
    manifest.reviewFindingsSummary.total = reviewFindings.length
    for (var f = 0; f < reviewFindings.length; f++) {
      var sev = ((reviewFindings[f].severity || '') + '').toLowerCase()
      if (sev === 'critical') manifest.reviewFindingsSummary.critical++
      else if (sev === 'warning') manifest.reviewFindingsSummary.warning++
      else manifest.reviewFindingsSummary.info++
    }
  }

  return manifest
}

// --- Main pipeline orchestrator ---

/**
 * runStitchPipeline — Runs stages 1-7 of the Flawless Pipeline.
 *
 * @param {Object} context - { prompt, activeThought, pid, containerId, existingApp, customName }
 * @param {Object} callbacks - { updateStage, updateEstimate, updateTime }
 * @returns {Promise<void>}
 */
export function runStitchPipeline(context, callbacks, resumeSession) {
  var customName = typeof resumeSession === 'string' ? resumeSession : null
  if (resumeSession && typeof resumeSession === 'string') resumeSession = null
  var cb = callbacks || {}
  var updateStage = cb.updateStage || function () {}
  var updateEstimate = cb.updateEstimate || function () {}
  var updateTime = cb.updateTime || function () {}

  var runId = 'stitch_' + Date.now().toString(36)
  var pid = context.pid || 'sp' + Date.now()
  var containerId = context.containerId || null
  var startTime = Date.now()
  var timerInterval = null

  // Track elapsed time
  timerInterval = setInterval(function () {
    var elapsed = Math.floor((Date.now() - startTime) / 1000)
    var mins = Math.floor(elapsed / 60)
    var secs = elapsed % 60
    var timeStr = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs
    updateTime(timeStr)
    if (containerId) updateStitchTime(containerId, timeStr)
  }, 1000)

  updateEstimate('~2-4 min')
  if (containerId) updateStitchEstimate(containerId, '~2-4 min')

  var existingApp = context.existingApp || null
  customName = context.customName || ''
  var prompt = context.prompt || ''
  var appName = customName || (existingApp ? existingApp.name : '') || autoName(prompt)
  var appId = existingApp ? existingApp.id : uniqueSlug(appName)
  var appIcon = ST.pendingIcon || '\uD83C\uDFAF'
  var appCi = ST.pendingColor != null ? ST.pendingColor : Math.floor(Math.random() * GRADS.length)
  var hasGitHub = !!(ST.ghToken && ST.ghUser && ST.ghRepo)
  var branchName = (resumeSession && resumeSession.branchName) || (hasGitHub ? 'stitch/' + appId : null)

  var intakePayload = null
  var stitchHTML = null
  var blueprintCleanCopy = null
  var assembledHTML = null
  var checksReport = null
  var reviewFindings = null
  var finalHTML = null
  var buildManifest = null

  var _buildId = telemetry.startBuild(appId, 'stitch')
  var _br = telemetry.createBuildRecord(appId, 'stitch', prompt, {
    isUpdate: !!existingApp,
    thoughtId: ST.activeThoughtId || null,
    hasImages: false,
  })
  var _approvalStartTs = 0

  var _resumeCtx = resumeSession ? buildResumeContext(resumeSession) : ''
  var _isResuming = !!resumeSession
  if (_isResuming) {
    addMsg({ role: 'system', text: 'Resuming from previous session \u2014 skipping completed steps.' })
  }
  ST._resumeSession = null

  // --- Halt handler ---
  function haltWithOptions(stageName, stageIndex, error) {
    clearInterval(timerInterval)
    var safeMsg = scrubKeys(error.message || String(error))

    updateStage(stageIndex, 'failed', safeMsg)
    if (containerId) updateStitchStage(containerId, stageIndex, PIPE5_STATUS.FAILED, safeMsg)

    // Create halt error with recovery options
    var haltError = new Error('STITCH_HALT')
    haltError.stageName = stageName
    haltError.stageIndex = stageIndex
    haltError.originalError = safeMsg
    haltError.runId = runId
    haltError.partialResult = {
      stitchHTML: stitchHTML,
      assembledHTML: assembledHTML,
      checksReport: checksReport,
    }
    // Recovery options: (a) retry from failed stage, (b) fallback, (c) abort
    haltError.options = {
      retryFromStage: stageIndex,
      fallbackToStandard: true,
      abort: true,
    }
    throw haltError
  }

  // --- Stage execution ---

  // Resolve template skeleton before pipeline starts (same pattern as thought engine)
  var tplPromise = Promise.resolve()
  if (!existingApp && ST._pendingTemplate) {
    var pending = ST._pendingTemplate
    ST._pendingTemplate = null
    var activeThoughtTpl = ST.activeThoughtId
      ? ST.thoughts.find(function (t) {
          return t.id === ST.activeThoughtId
        })
      : null
    var _thoughtDesign = getThoughtDesignOverrides(activeThoughtTpl)
    tplPromise = (pending.skeleton ? Promise.resolve(pending.skeleton) : getTemplateSkeleton(pending.id)).then(
      function (skeleton) {
        context._templateSkeleton = skeleton
      }
    )
  }

  return tplPromise
    .then(function () {
      // ── Stage 1: Intake ──
      checkPipelineCancel()
      updateStage(0, 'running', 'Preparing context…')
      if (containerId) updateStitchStage(containerId, 0, PIPE5_STATUS.RUNNING, 'Preparing context…')
      updatePS(pid, 0, 'active', 'Preparing context…')

      return retryStage(
        function () {
          return Promise.resolve().then(function () {
            intakePayload = runIntake(context)
            return intakePayload
          })
        },
        'Intake',
        2,
        function (statusMsg) {
          updateStage(0, 'running', statusMsg)
          if (containerId) updateStitchStage(containerId, 0, PIPE5_STATUS.RUNNING, statusMsg)
        }
      )
    })
    .then(function (payload) {
      intakePayload = payload
      storeInProgressiveLearner(runId, 'intake', {
        prompt: intakePayload.prompt,
        specText: intakePayload.specText,
        rulesText: intakePayload.rulesText,
        dataMappingCount: (intakePayload.dataMapping || []).length,
        hasThought: !!intakePayload.activeThought,
      })

      var mappingCount = (intakePayload.dataMapping || []).length
      var intakeDetail = 'Context ready' + (mappingCount > 0 ? ' · ' + mappingCount + ' data mappings' : '')
      updateStage(0, 'passed', intakeDetail)
      if (containerId) updateStitchStage(containerId, 0, PIPE5_STATUS.PASSED, intakeDetail)
      updatePS(pid, 0, 'done', intakeDetail + ' ✓')
      addMsg({
        role: 'asst',
        type: 'text',
        text:
          'Intake complete — unified payload assembled' +
          (mappingCount > 0 ? ' with ' + mappingCount + ' data mappings.' : '.'),
      })

      // ── Stage 2: Blueprint ──
      checkPipelineCancel()
      if (_resumeCtx) intakePayload.appDescription += '\n\n' + _resumeCtx
      updateStage(1, 'running', 'Calling Stitch API…')
      if (containerId) updateStitchStage(containerId, 1, PIPE5_STATUS.RUNNING, 'Calling Stitch API…')
      updatePS(pid, 1, 'active', 'Generating blueprint…')
      updateEstimate('~2-3 min remaining')
      if (containerId) updateStitchEstimate(containerId, '~2-3 min remaining')

      return retryStage(
        function () {
          return runBlueprint(intakePayload)
        },
        'Blueprint',
        2,
        function (statusMsg) {
          updateStage(1, 'running', statusMsg)
          if (containerId) updateStitchStage(containerId, 1, PIPE5_STATUS.RUNNING, statusMsg)
          updatePS(pid, 1, 'active', statusMsg)
        }
      )
    })
    .then(function (blueprintResult) {
      stitchHTML = blueprintResult.html
      blueprintCleanCopy = blueprintResult.cleanCopy
      storeInProgressiveLearner(runId, 'blueprint', {
        htmlLength: stitchHTML.length,
        structureHash: blueprintCleanCopy.hash,
        tagCount: blueprintCleanCopy.tagCount,
        preview: stitchHTML.slice(0, 500),
      })

      updateStage(
        1,
        'passed',
        'Scaffold locked (' + Math.round(stitchHTML.length / 1024) + 'KB · ' + blueprintCleanCopy.tagCount + ' tags)'
      )
      if (containerId) updateStitchStage(containerId, 1, PIPE5_STATUS.PASSED, 'Scaffold locked')
      updatePS(pid, 1, 'done', 'Blueprint locked ✓')

      // ── Stage 2: Blueprint Review (User Approval Gate) ──
      checkPipelineCancel()
      updateStage(2, 'running', 'Awaiting your review…')
      if (containerId) updateStitchStage(containerId, 2, PIPE5_STATUS.RUNNING, 'Awaiting review…')
      updatePS(pid, 2, 'wait', 'Review the scaffold…')

      // Show blueprint preview in chat with approve/reject buttons
      addMsg({
        role: 'asst',
        type: 'blueprint-preview',
        code: stitchHTML,
        appName: appName,
        pid: pid,
        meta:
          Math.round(stitchHTML.length / 1024) +
          'KB · ' +
          blueprintCleanCopy.tagCount +
          ' tags — review before Claude adds logic',
      })
      notifyUser('Blueprint Ready', appName + ' scaffold is waiting for your review.')

      return waitForBlueprintApproval(pid)
    })
    .then(function () {
      // Blueprint approved — continue
      updateStage(2, 'passed', 'Approved')
      if (containerId) updateStitchStage(containerId, 2, PIPE5_STATUS.PASSED, 'Approved')
      updatePS(pid, 2, 'done', 'Approved ✓')
      addMsg({ role: 'asst', type: 'text', text: 'Blueprint approved — proceeding to hydration.' })

      // ── Stage 3: Assemble (Hydration) ──
      checkPipelineCancel()
      updateStage(3, 'running', 'Claude adding logic layer…')
      if (containerId) updateStitchStage(containerId, 3, PIPE5_STATUS.RUNNING, 'Claude adding logic layer…')
      updatePS(pid, 3, 'active', 'Assembling full app…')
      updateEstimate('~1-2 min remaining')
      if (containerId) updateStitchEstimate(containerId, '~1-2 min remaining')

      // Set up streaming live preview for hydration
      var _assemblePreview = null
      var _previewIframe = $('viewer-iframe')
      if (_previewIframe) _assemblePreview = createStreamingPreview('viewer-iframe')

      return retryStage(
        function () {
          return runAssemble(stitchHTML, intakePayload, _assemblePreview)
        },
        'Assemble',
        2,
        function (statusMsg) {
          updateStage(3, 'running', statusMsg)
          if (containerId) updateStitchStage(containerId, 3, PIPE5_STATUS.RUNNING, statusMsg)
          updatePS(pid, 3, 'active', statusMsg)
        }
      )
    })
    .then(function (assembleResult) {
      assembledHTML = assembleResult.html
      var assembleThinking = assembleResult.thinkingText || ''
      storeInProgressiveLearner(runId, 'assemble', {
        htmlLength: assembledHTML.length,
        preview: assembledHTML.slice(0, 500),
      })

      updateStage(3, 'passed', 'App assembled (' + Math.round(assembledHTML.length / 1024) + 'KB)')
      if (containerId) updateStitchStage(containerId, 3, PIPE5_STATUS.PASSED, 'App assembled')
      updatePS(pid, 3, 'done', 'Assembly complete ✓')
      telemetry.emit('build.code', { charCount: assembledHTML.length })
      telemetry.updateBuildRecord(_buildId, 'thinking', assembleThinking || '')
      if (assembleThinking.trim()) {
        addMsg({ role: 'asst', type: 'thinking', text: assembleThinking.trim() })
      }

      // ── Stage 4: Verify (Automated Guardrails) ──
      checkPipelineCancel()
      updateStage(4, 'running', 'Running verification checks…')
      if (containerId) updateStitchStage(containerId, 4, PIPE5_STATUS.RUNNING, 'Running checks…')
      updatePS(pid, 4, 'active', 'Verifying quality…')
      updateEstimate('< 1 min remaining')
      if (containerId) updateStitchEstimate(containerId, '< 1 min remaining')

      return retryStage(
        function () {
          return Promise.resolve().then(function () {
            return runVerify(assembledHTML, blueprintCleanCopy)
          })
        },
        'Verify',
        2,
        function (statusMsg) {
          updateStage(4, 'running', statusMsg)
          if (containerId) updateStitchStage(containerId, 4, PIPE5_STATUS.RUNNING, statusMsg)
        }
      )
    })
    .then(function (report) {
      checksReport = report
      storeInProgressiveLearner(runId, 'verify', {
        score: checksReport.score,
        valid: checksReport.valid,
        structureViolations: checksReport.structureDiff ? checksReport.structureDiff.violations : 0,
        structuralGaps: (checksReport.structuralGaps || []).length,
        summary: checksReport.summary,
      })
      var _localChecks = checksReport.localChecks || []
      var _criticalFails = _localChecks.filter(function (c) {
        return !c.passed
      }).length
      telemetry.emit('build.checks', {
        passCount: _localChecks.filter(function (c) {
          return c.passed
        }).length,
        totalCount: _localChecks.length,
        criticalFails: _criticalFails,
      })
      telemetry.updateBuildRecord(_buildId, 'checks', _localChecks)

      // --- Structure Diff violation loop-back ---
      // If Claude added HTML tags, loop back to Stage 3 with a violation report (one retry)
      if (checksReport.structureDiff && !checksReport.structureDiff.passed && !context._structureRetried) {
        var violationCount = checksReport.structureDiff.violations
        var addedTags = checksReport.structureDiff.addedTags.slice(0, 10)
        addMsg({
          role: 'asst',
          type: 'text',
          text:
            'Structure violation: Claude added ' +
            violationCount +
            ' HTML tag(s). Re-running hydration with violation report…',
        })

        updateStage(4, 'failed', violationCount + ' structure violation(s)')
        if (containerId) updateStitchStage(containerId, 4, PIPE5_STATUS.FAILED, violationCount + ' violation(s)')
        context._structureRetried = true

        // Re-run Stage 3 with violation report injected
        updateStage(3, 'running', 'Re-hydrating (structure fix)…')
        if (containerId) updateStitchStage(containerId, 3, PIPE5_STATUS.RUNNING, 'Re-hydrating…')

        var violationSys =
          SYS_STITCH_ENHANCE +
          '\n\n⛔⛔⛔ STRUCTURE VIOLATION REPORT — YOUR PREVIOUS OUTPUT FAILED THE AUTOMATED DIFF ⛔⛔⛔\n' +
          'You added ' +
          violationCount +
          ' HTML tags that were NOT in the original blueprint. This FAILED the build.\n' +
          'Your output was MACHINE-DIFFED and these extra tags were detected:\n' +
          addedTags
            .map(function (t) {
              return '  ✗ REMOVE: ' + t
            })
            .join('\n') +
          '\n\nCRITICAL INSTRUCTIONS FOR THIS RETRY:\n' +
          '1. Start from the ORIGINAL scaffold below — do NOT start from your previous (rejected) output\n' +
          '2. Add ONLY <script> and <style> blocks — absolutely NO new HTML elements anywhere in <body>\n' +
          '3. Every tag in your <body> MUST exist in the original scaffold. The diff tool will catch any addition.\n' +
          '4. If a feature needs new DOM elements, use: /* STRUCTURAL_GAP: [feature] not in blueprint */\n' +
          '5. Use JavaScript to manipulate textContent/value of EXISTING elements — do NOT create new ones\n' +
          '\nThis is your LAST attempt. If you add even ONE extra HTML tag, the build will permanently fail.'
        violationSys = injectProfileContext(violationSys)

        var violationMsg =
          '⛔ ORIGINAL SCAFFOLD (IMMUTABLE — start from THIS, not your previous output) ⛔\n' +
          'Your output will be machine-diffed against this scaffold. Any new HTML tag = build failure.\n\n' +
          stitchHTML +
          '\n\n--- YOUR PREVIOUS (REJECTED) OUTPUT (for reference ONLY — do NOT copy its structure) ---\n' +
          assembledHTML.slice(0, 30000) +
          '\n\nORIGINAL USER REQUEST:\n' +
          intakePayload.prompt

        return callClaude(violationSys, violationMsg, 0.2).then(function (retriedHTML) {
          assembledHTML = retriedHTML
          // Re-verify
          checksReport = runVerify(assembledHTML, blueprintCleanCopy)

          var statusDetail = 'Score: ' + checksReport.score + '/100'
          if (checksReport.structureDiff && !checksReport.structureDiff.passed) {
            statusDetail += ' (' + checksReport.structureDiff.violations + ' structural violation(s) remain)'
          }
          var verifyStatus = checksReport.score >= 60 ? 'passed' : 'failed'

          updateStage(3, 'passed', 'Re-hydrated')
          if (containerId) updateStitchStage(containerId, 3, PIPE5_STATUS.PASSED, 'Re-hydrated')
          updateStage(4, verifyStatus, statusDetail)
          if (containerId)
            updateStitchStage(
              containerId,
              4,
              verifyStatus === 'passed' ? PIPE5_STATUS.PASSED : PIPE5_STATUS.FAILED,
              statusDetail
            )
          updatePS(pid, 4, verifyStatus === 'passed' ? 'done' : 'warn', statusDetail)

          if (checksReport.localChecks) {
            addMsg({ role: 'asst', type: 'checks', checks: checksReport.localChecks })
          }
          addMsg({ role: 'asst', type: 'text', text: 'Re-verification: ' + checksReport.summary })
          return checksReport
        })
      }

      var statusDetail = 'Score: ' + checksReport.score + '/100'
      if (checksReport.structureDiff && checksReport.structureDiff.violations > 0) {
        statusDetail += ' (' + checksReport.structureDiff.violations + ' structural violation(s))'
      }
      var verifyStatus = checksReport.score >= 60 ? 'passed' : 'failed'

      updateStage(4, verifyStatus, statusDetail)
      if (containerId) {
        updateStitchStage(
          containerId,
          4,
          verifyStatus === 'passed' ? PIPE5_STATUS.PASSED : PIPE5_STATUS.FAILED,
          statusDetail
        )
      }
      updatePS(pid, 4, verifyStatus === 'passed' ? 'done' : 'warn', statusDetail)

      // Show checks in chat
      if (checksReport.localChecks) {
        addMsg({ role: 'asst', type: 'checks', checks: checksReport.localChecks })
      }
      addMsg({ role: 'asst', type: 'text', text: 'Verification: ' + checksReport.summary })

      updateEstimate('~1-2 min remaining')
      if (containerId) updateStitchEstimate(containerId, '~1-2 min remaining')

      // ── Stage 5: Review ──
      checkPipelineCancel()
      updateStage(5, 'running', 'GPT-4o reviewing…')
      if (containerId) updateStitchStage(containerId, 5, PIPE5_STATUS.RUNNING, 'GPT-4o reviewing…')
      updatePS(pid, 5, 'active', 'GPT-4o review…')

      return retryStage(
        function () {
          return runReview(assembledHTML, checksReport)
        },
        'Review',
        2,
        function (statusMsg) {
          updateStage(5, 'running', statusMsg)
          if (containerId) updateStitchStage(containerId, 5, PIPE5_STATUS.RUNNING, statusMsg)
          updatePS(pid, 5, 'active', statusMsg)
        }
      )
    })
    .then(function (findings) {
      reviewFindings = findings || []
      storeInProgressiveLearner(runId, 'review', {
        findingCount: reviewFindings.length,
        critical: reviewFindings.filter(function (f) {
          return (f.severity || '').toLowerCase() === 'critical'
        }).length,
        warning: reviewFindings.filter(function (f) {
          return (f.severity || '').toLowerCase() === 'warning'
        }).length,
        info: reviewFindings.filter(function (f) {
          return (f.severity || '').toLowerCase() === 'info'
        }).length,
      })
      telemetry.emit('build.audit', { bugCount: reviewFindings.length, auditor: 'gpt4o' })
      telemetry.updateBuildRecord(_buildId, 'auditBugs', reviewFindings)

      var findingSummary = reviewFindings.length + ' finding' + (reviewFindings.length !== 1 ? 's' : '')
      var criticals = reviewFindings.filter(function (f) {
        return (f.severity || '').toLowerCase() === 'critical'
      }).length
      if (criticals) findingSummary += ' (' + criticals + ' critical)'

      updateStage(5, 'passed', findingSummary)
      if (containerId) {
        updateStitchStage(containerId, 5, PIPE5_STATUS.PASSED, findingSummary)
        populateReviewFindings(containerId, reviewFindings)
      }
      updatePS(pid, 5, 'done', findingSummary + ' ✓')
      addMsg({ role: 'asst', type: 'text', text: 'GPT-4o review complete — ' + findingSummary })

      // ── Stage 6: Polish ──
      checkPipelineCancel()
      updateStage(6, 'running', 'Claude polishing…')
      if (containerId) updateStitchStage(containerId, 6, PIPE5_STATUS.RUNNING, 'Claude polishing…')
      updatePS(pid, 6, 'active', 'Polishing…')
      updateEstimate('< 1 min remaining')
      if (containerId) updateStitchEstimate(containerId, '< 1 min remaining')

      return retryStage(
        function () {
          return runPolish(assembledHTML, reviewFindings, blueprintCleanCopy)
        },
        'Polish',
        2,
        function (statusMsg) {
          updateStage(6, 'running', statusMsg)
          if (containerId) updateStitchStage(containerId, 6, PIPE5_STATUS.RUNNING, statusMsg)
          updatePS(pid, 6, 'active', statusMsg)
        }
      )
    })
    .then(function (polishResult) {
      finalHTML = polishResult.html
      storeInProgressiveLearner(runId, 'polish', {
        htmlLength: finalHTML.length,
        secondPass: polishResult.secondPass,
        preview: finalHTML.slice(0, 500),
      })

      var polishDetail = polishResult.secondPass
        ? '2 passes applied'
        : reviewFindings.length
          ? 'Fixes applied'
          : 'Clean — no fixes needed'
      updateStage(6, 'passed', polishDetail)
      if (containerId) updateStitchStage(containerId, 6, PIPE5_STATUS.PASSED, polishDetail)
      updatePS(pid, 6, 'done', polishDetail + ' ✓')
      addMsg({ role: 'asst', type: 'text', text: 'Polish complete — ' + polishDetail })

      // Supabase auto-injection
      if (finalHTML && ST.backendEnabled && ST.sbUrl) {
        finalHTML = autoInjectSupabase(finalHTML)
      }

      // Save locally before deliver stage
      saveAppLocally(appId, appName, appIcon, appCi, finalHTML, prompt, existingApp, false)

      // ── Stage 7: Deliver ──
      checkPipelineCancel()
      updateStage(7, 'running', 'Generating build manifest…')
      if (containerId) updateStitchStage(containerId, 7, PIPE5_STATUS.RUNNING, 'Generating manifest…')
      updatePS(pid, 7, 'active', 'Delivering…')

      // Generate Build Manifest — tells the user exactly what was met and what gaps exist
      buildManifest = _generateBuildManifest(intakePayload, checksReport, reviewFindings, blueprintCleanCopy)
      storeInProgressiveLearner(runId, 'manifest', buildManifest)

      // Push to GitHub branch if configured
      if (hasGitHub) {
        updateStage(7, 'running', 'Pushing to ' + branchName + '…')
        if (containerId) updateStitchStage(containerId, 7, PIPE5_STATUS.RUNNING, 'Pushing to branch…')
        var appPath = 'apps/' + appId + '.html'
        return retryStage(
          function () {
            return (
              _isResuming && branchName
                ? Promise.resolve()
                : ghCreateBranch(branchName).catch(function () {
                    /* branch may exist */
                  })
            ).then(function () {
              return ghGetFileSha(appPath, branchName).then(function (existingSha) {
                return ghPushFile(
                  appPath,
                  finalHTML,
                  (existingApp ? 'Update' : 'Add') + ' ' + appName + ' [stitch]',
                  branchName,
                  existingSha
                )
              })
            })
          },
          'Deliver-Push',
          2,
          function (statusMsg) {
            updateStage(7, 'running', statusMsg)
            if (containerId) updateStitchStage(containerId, 7, PIPE5_STATUS.RUNNING, statusMsg)
          }
        )
          .then(function () {
            return 'github'
          })
          .catch(function (e) {
            addMsg({ role: 'asst', type: 'text', text: 'GitHub push skipped: ' + scrubKeys(e.message || String(e)) })
            return 'local'
          })
      } else {
        return Promise.resolve('local')
      }
    })
    .then(function (mode) {
      // Preview in split-screen
      setPreview(appId, finalHTML)
      addMsg({
        role: 'asst',
        type: 'preview-card',
        code: finalHTML,
        appName: appName,
        branch: branchName || 'local',
        appId: appId,
        pid: pid,
      })

      // Approval gate
      updateStage(7, 'running', 'Awaiting approval…')
      if (containerId) updateStitchStage(containerId, 7, PIPE5_STATUS.RUNNING, 'Awaiting approval…')
      updatePS(pid, 7, 'wait', 'Waiting for your approval…')
      addMsg({ role: 'asst', type: 'approval', id: 'appr-' + Date.now(), pid: pid, branch: branchName || 'local' })
      notifyUser('Stitch Build Ready', appName + ' is waiting for your approval.')
      _approvalStartTs = Date.now()

      return waitForApproval(pid)
    })
    .then(function () {
      // Approved — merge if GitHub, otherwise finalize local
      var _approvalMs = _approvalStartTs ? Date.now() - _approvalStartTs : null
      telemetry.emit('user.approval', { approved: true, timeMs: _approvalMs })
      telemetry.updateBuildRecord(_buildId, 'approvalDecision', 'approved')
      telemetry.updateBuildRecord(_buildId, 'approvalTimeMs', _approvalMs)
      if (hasGitHub) {
        updateStage(7, 'running', 'Merging to main…')
        if (containerId) updateStitchStage(containerId, 7, PIPE5_STATUS.RUNNING, 'Merging…')
        var mergeStatusId = 'merge-' + Date.now()
        addMsg({ role: 'asst', type: 'merge-status', mergeId: mergeStatusId, status: 'merging' })

        return retryStage(
          function () {
            return ghMergeBranch(branchName, appName)
          },
          'Deliver-Merge',
          2
        )
          .then(function () {
            return ghPushManifest('main').catch(function () {})
          })
          .then(function () {
            ghDeleteBranch(branchName)
            var liveUrl = ghPageUrl(appId)
            saveAppLocally(appId, appName, appIcon, appCi, finalHTML, prompt, existingApp, true)
            clearPreview(appId)

            var mc = $(mergeStatusId)
            if (mc) {
              var card = mc.querySelector('.merge-card')
              if (card)
                card.innerHTML =
                  '<div class="merge-ico">\uD83D\uDC19</div><div class="merge-info"><span class="merge-title">Merged to main \u2713</span><a class="merge-url" href="' +
                  liveUrl +
                  '" target="_blank">' +
                  liveUrl +
                  '</a><span class="merge-meta">GitHub Pages deploys in ~60s</span></div>'
            }
            toast('\uD83D\uDE80 ' + appName + ' is deploying!', 3500)
            return 'github'
          })
          .catch(function (e) {
            var safeE = scrubKeys(e.message || String(e))
            saveAppLocally(appId, appName, appIcon, appCi, finalHTML, prompt, existingApp, false)
            clearPreview(appId)
            addMsg({
              role: 'asst',
              type: 'text',
              html: 'Merge failed: <strong>' + esc(safeE) + '</strong>. App saved locally.',
            })
            return 'local'
          })
      } else {
        saveAppLocally(appId, appName, appIcon, appCi, finalHTML, prompt, existingApp, false)
        clearPreview(appId)
        toast('\u2705 ' + appName + ' saved!', 2800)
        return 'local'
      }
    })
    .then(function (mode) {
      // Deliver = passed
      updateStage(7, 'passed', mode === 'github' ? 'Merged & deploying' : 'Saved locally')
      if (containerId)
        updateStitchStage(
          containerId,
          7,
          PIPE5_STATUS.PASSED,
          mode === 'github' ? 'Merged & deploying' : 'Saved locally'
        )
      updatePS(pid, 7, 'done', 'Delivered ✓')

      storeInProgressiveLearner(runId, 'deliver', {
        mode: mode,
        appId: appId,
        appName: appName,
        manifest: buildManifest,
      })

      clearInterval(timerInterval)
      var elapsed = Math.floor((Date.now() - startTime) / 1000)
      var mins = Math.floor(elapsed / 60)
      var secs = elapsed % 60
      var finalTime = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs
      updateTime(finalTime)
      if (containerId) updateStitchTime(containerId, finalTime)
      updateEstimate('Complete')
      if (containerId) updateStitchEstimate(containerId, 'Complete')

      ST.activeAppId = appId
      ST._building = false
      var sb = $('send-btn')
      if (sb) sb.disabled = false
      notifyUser(
        'Stitch Build Complete',
        appName + (mode === 'github' ? ' is live on GitHub Pages!' : ' has been saved.')
      )
      $('bs-proj-btn').style.display = 'flex'
      renderGrid()

      // Cost analysis
      var costData = calculateBuildCost()
      if (costData.breakdown.length > 0) {
        addMsg({ role: 'asst', type: 'cost', cost: costData })
        for (var ci = 0; ci < ST.apps.length; ci++) {
          if (ST.apps[ci].id === appId) {
            if (!ST.apps[ci].costs) ST.apps[ci].costs = []
            ST.apps[ci].costs.push({
              rawCost: costData.rawCost,
              userPrice: costData.userPrice,
              markup: costData.markup,
              totalInput: costData.totalInput,
              totalOutput: costData.totalOutput,
              ts: costData.ts,
            })
            if (ST.apps[ci].costs.length > 50) ST.apps[ci].costs = ST.apps[ci].costs.slice(-50)
            break
          }
        }
      }

      // Show Build Manifest
      if (buildManifest) {
        var manifestHtml =
          '<div style="margin-top:8px;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;font-size:11px">' +
          '<div style="font-weight:700;color:rgba(255,255,255,.9);margin-bottom:6px">\uD83D\uDCCB Build Manifest</div>'
        if (buildManifest.requirementsMet.length) {
          manifestHtml += '<div style="color:rgba(255,255,255,.5);margin-bottom:3px">Requirements met:</div>'
          for (var mi = 0; mi < buildManifest.requirementsMet.length; mi++) {
            manifestHtml +=
              '<div style="color:rgba(139,92,246,.8);padding-left:8px">\u2713 ' +
              esc(buildManifest.requirementsMet[mi]) +
              '</div>'
          }
        }
        if (buildManifest.requirementsPartial.length) {
          manifestHtml +=
            '<div style="color:rgba(255,214,0,.6);margin-top:4px;margin-bottom:3px">Partial (structural gaps):</div>'
          for (var pi = 0; pi < buildManifest.requirementsPartial.length; pi++) {
            manifestHtml +=
              '<div style="color:rgba(255,214,0,.5);padding-left:8px">\u26A0 ' +
              esc(buildManifest.requirementsPartial[pi]) +
              '</div>'
          }
        }
        if (buildManifest.structuralGaps.length) {
          manifestHtml +=
            '<div style="color:rgba(255,82,82,.6);margin-top:4px;margin-bottom:3px">Structural gaps (missing from blueprint):</div>'
          for (var gi = 0; gi < buildManifest.structuralGaps.length; gi++) {
            manifestHtml +=
              '<div style="color:rgba(255,82,82,.5);padding-left:8px">\u2717 ' +
              esc(buildManifest.structuralGaps[gi]) +
              '</div>'
          }
        }
        manifestHtml +=
          '<div style="color:rgba(255,255,255,.3);margin-top:6px;font-size:10px">' +
          'Quality: ' +
          buildManifest.qualityScore +
          '/100 \u00B7 Structure: ' +
          buildManifest.structureIntegrity +
          ' \u00B7 Findings: ' +
          buildManifest.reviewFindingsSummary.critical +
          'C/' +
          buildManifest.reviewFindingsSummary.warning +
          'W/' +
          buildManifest.reviewFindingsSummary.info +
          'I' +
          '</div></div>'
        addMsg({ role: 'asst', type: 'text', html: manifestHtml })
      }

      var g = grad(appCi)
      addMsg({
        role: 'asst',
        type: 'text',
        html:
          '<strong>' +
          esc(appName) +
          '</strong> ' +
          (mode === 'github' ? 'is live on GitHub Pages' : 'has been saved') +
          ' \uD83C\uDF89<br><br>' +
          '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:6px">' +
          '<button onclick="B.openApp(\'' +
          appId +
          '\')" style="padding:8px 16px;border-radius:9px;background:' +
          g +
          ';border:none;color:#fff;font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83D\uDE80 Open in Studio</button>' +
          '<button onclick="B.openProjectSheet(\'' +
          appId +
          '\')" style="padding:8px 16px;border-radius:9px;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.7);font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83D\uDCCB Project</button>' +
          '</div>',
      })

      telemetry.completeBuildRecord(_buildId, {
        finalCodeSize: finalHTML ? finalHTML.length : 0,
        costData: costData.breakdown.length
          ? {
              rawCost: costData.rawCost,
              userPrice: costData.userPrice,
              totalInput: costData.totalInput,
              totalOutput: costData.totalOutput,
            }
          : null,
        approved: true,
      })
      return showFeedbackCard(appId, appName, prompt)
    })
    .catch(function (err) {
      clearInterval(timerInterval)
      ST._building = false
      var sb = $('send-btn')
      if (sb) sb.disabled = false

      // Re-throw halt errors and cancellation as-is
      if (err.message === 'STITCH_HALT') {
        throw err
      }

      if (err.message === 'PIPELINE_CANCELLED') {
        clearPreview(appId)
        saveAppLocally(appId, appName, appIcon, appCi, finalHTML || assembledHTML || '', prompt, existingApp, false)
        ST.activeAppId = appId
        addMsg({ role: 'asst', type: 'text', text: 'Pipeline stopped by user. Progress saved.' })
        toast('Pipeline stopped', 3000)
        $('bs-proj-btn').style.display = 'flex'
        renderGrid()
        return
      }

      if (err.message === 'BUILDER_CLOSED') {
        clearPreview(appId)
        saveAppLocally(appId, appName, appIcon, appCi, finalHTML || assembledHTML || '', prompt, existingApp, false)
        ST.activeAppId = appId
        renderGrid()
        return
      }

      if (err.message === 'CHANGES_REQUESTED') {
        telemetry.emit('user.approval', {
          approved: false,
          timeMs: _approvalStartTs ? Date.now() - _approvalStartTs : null,
        })
        telemetry.updateBuildRecord(_buildId, 'approvalDecision', 'rejected')
        clearPreview(appId)
        saveAppLocally(appId, appName, appIcon, appCi, finalHTML || assembledHTML || '', prompt, existingApp, false)
        ST.activeAppId = appId
        addMsg({ role: 'asst', type: 'text', text: 'No problem! Describe what you want changed.' })
        $('bs-proj-btn').style.display = 'flex'
        renderGrid()
        return
      }

      if (err.message === 'BLUEPRINT_REJECTED') {
        updateStage(2, 'failed', 'Rejected')
        if (containerId) updateStitchStage(containerId, 2, PIPE5_STATUS.FAILED, 'Rejected')
        updatePS(pid, 2, 'error', 'Blueprint rejected')
        addMsg({
          role: 'asst',
          type: 'text',
          text: "Blueprint rejected. Describe what you'd like different and try again.",
        })
        $('bs-proj-btn').style.display = 'flex'
        renderGrid()
        return
      }

      // Determine which stage failed based on what we have
      var failedStage = 0
      if (intakePayload && !stitchHTML) failedStage = 1
      else if (stitchHTML && !assembledHTML) failedStage = 3
      else if (assembledHTML && !checksReport) failedStage = 4
      else if (checksReport && !reviewFindings) failedStage = 5
      else if (reviewFindings && !finalHTML) failedStage = 6
      else if (finalHTML) failedStage = 7

      // Blueprint failure gets special treatment: offer fallback to standard pipeline
      if (failedStage === 1) {
        var safeMsg = scrubKeys(err.message || String(err))
        toast('Stitch API error: ' + safeMsg + ' — you can try the standard pipeline', 5000)
      }

      var _safeErrMsg = scrubKeys(err.message || String(err))
      telemetry.emit('build.error', { message: _safeErrMsg })
      telemetry.completeBuildRecord(_buildId, { cancelled: true })

      haltWithOptions(
        ['Intake', 'Blueprint', 'Blueprint Review', 'Assemble', 'Verify', 'Review', 'Polish', 'Deliver'][failedStage],
        failedStage,
        err
      )
    })
    .finally(function () {
      telemetry.endBuild(_buildId)
      persist()
      clearBuildSession()
    })
}

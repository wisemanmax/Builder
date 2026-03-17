import { ST } from './state.js'
import { slugify, ghHeaders, ghApiUrl, ghPageUrl, scrubKeys, toast } from './utils.js'
import { fetchWithRetry } from './ai.js'
import { persist } from './state.js'

export function safeBase64(str) {
  try {
    var bytes = new TextEncoder().encode(str)
    var bin = ''; var CHUNK = 8192
    for (var i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
    return btoa(bin)
  } catch (e) { return btoa(unescape(encodeURIComponent(str))) }
}

export function ghFetch(url, opts) {
  opts = opts || {}
  var headers = ghHeaders()
  if (opts.headers) { for (var k in opts.headers) headers[k] = opts.headers[k] }
  opts.headers = headers
  return fetchWithRetry(url, opts, 30000).then(function (res) {
    if (!res.ok) return res.json().catch(function () { return {} }).then(function (e) { throw new Error(e.message || 'GitHub HTTP ' + res.status) })
    return res.status === 204 ? {} : res.json()
  })
}

export function ghGetMainSha() {
  return ghFetch('https://api.github.com/repos/' + ST.ghUser + '/' + ST.ghRepo + '/branches/main').then(function (d) {
    var sha = d && d.commit && d.commit.sha
    if (!sha) throw new Error('Could not read main branch SHA')
    return sha
  })
}

export function ghCreateBranch(branchName) {
  return ghGetMainSha().then(function (sha) {
    return ghFetch('https://api.github.com/repos/' + ST.ghUser + '/' + ST.ghRepo + '/git/refs', {
      method: 'POST',
      body: JSON.stringify({ ref: 'refs/heads/' + branchName, sha: sha }),
    }).then(function () { return sha })
  })
}

export function ghPushFile(path, content, message, branch, existingSha) {
  var body = { message: message, content: safeBase64(content), branch: branch }
  if (existingSha) body.sha = existingSha
  return ghFetch(ghApiUrl(path), { method: 'PUT', body: JSON.stringify(body) })
}

export function ghGetFileSha(path, branch) {
  branch = branch || 'main'
  var url = ghApiUrl(path) + (branch !== 'main' ? '?ref=' + encodeURIComponent(branch) : '')
  return fetchWithRetry(url, { headers: ghHeaders() }, 30000).then(function (res) {
    if (res.status === 404) return null
    if (!res.ok) return null
    return res.json().then(function (d) { return d.sha || null })
  }).catch(function () { return null })
}

export function ghMergeBranch(branchName, appName) {
  return fetchWithRetry('https://api.github.com/repos/' + ST.ghUser + '/' + ST.ghRepo + '/merges', {
    method: 'POST', headers: ghHeaders(),
    body: JSON.stringify({ base: 'main', head: branchName, commit_message: '\u2705 Merge ' + branchName + ' \u2014 ' + appName + ' via The Builder' }),
  }, 30000).then(function (res) {
    if (res.status === 204) return { noChange: true }
    if (res.status === 409) throw new Error('Merge conflict')
    if (!res.ok) return res.json().catch(function () { return {} }).then(function (e) { throw new Error(e.message || 'Merge failed') })
    return res.json()
  })
}

export function ghDeleteBranch(branchName) {
  fetch('https://api.github.com/repos/' + ST.ghUser + '/' + ST.ghRepo + '/git/refs/heads/' + branchName, { method: 'DELETE', headers: ghHeaders() }).catch(function () { })
}

export function ghPushManifest(branch) {
  var manifestData = ST.apps.map(function (a) {
    return {
      id: a.id, name: a.name, icon: a.icon, ci: a.ci, url: ghPageUrl(a.id), path: 'apps/' + a.id + '.html',
      prompts: (a.prompts || []).map(function (p) { return { ts: p.ts, type: p.type, text: p.text.slice(0, 120) } }),
      createdAt: a.createdAt, updatedAt: a.updatedAt,
    }
  })
  return ghGetFileSha('apps/manifest.json', branch).then(function (existingSha) {
    return ghPushFile('apps/manifest.json', JSON.stringify(manifestData, null, 2), 'Update Builder manifest', branch, existingSha)
  })
}

export function ghPushThought(thought) {
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) return Promise.resolve(null)
  var slug = slugify(thought.name || 'thought')
  var path = 'thoughts/' + slug + '.json'
  var content = JSON.stringify({
    id: thought.id, name: thought.name, status: thought.status,
    originalPrompt: thought.originalPrompt, rounds: thought.rounds,
    conversation: thought.conversation, brief: thought.brief,
    linkedRulesId: thought.linkedRulesId, linkedAppId: thought.linkedAppId,
    createdAt: thought.createdAt, updatedAt: thought.updatedAt,
  }, null, 2)
  return ghGetFileSha(path, 'main').then(function (sha) {
    return ghPushFile(path, content, 'Save thought: ' + thought.name, 'main', sha)
  })
}

export function ghPushThoughtsManifest() {
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) return Promise.resolve(null)
  var manifestData = ST.thoughts.map(function (t) {
    return {
      id: t.id, name: t.name, status: t.status, rounds: t.rounds,
      linkedRulesId: t.linkedRulesId, linkedAppId: t.linkedAppId,
      path: 'thoughts/' + slugify(t.name || 'thought') + '.json',
      createdAt: t.createdAt, updatedAt: t.updatedAt,
    }
  })
  return ghGetFileSha('thoughts/manifest.json', 'main').then(function (sha) {
    return ghPushFile('thoughts/manifest.json', JSON.stringify(manifestData, null, 2), 'Update thoughts manifest', 'main', sha)
  })
}

export function ghPushRuleSet(rules) {
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) return Promise.resolve(null)
  var slug = slugify(rules.name || 'rules')
  var path = 'rules/' + slug + '.json'
  var content = JSON.stringify({
    id: rules.id, name: rules.name, linkedThoughtId: rules.linkedThoughtId,
    mustRules: rules.mustRules, mustNotRules: rules.mustNotRules,
    niceToHave: rules.niceToHave,
    createdAt: rules.createdAt, updatedAt: rules.updatedAt,
  }, null, 2)
  return ghGetFileSha(path, 'main').then(function (sha) {
    return ghPushFile(path, content, 'Save rules: ' + rules.name, 'main', sha)
  })
}

export function ghPushRulesManifest() {
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) return Promise.resolve(null)
  var manifestData = ST.rules.map(function (r) {
    return {
      id: r.id, name: r.name, linkedThoughtId: r.linkedThoughtId,
      ruleCount: ((r.mustRules || []).length + (r.mustNotRules || []).length + (r.niceToHave || []).length),
      path: 'rules/' + slugify(r.name || 'rules') + '.json',
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }
  })
  return ghGetFileSha('rules/manifest.json', 'main').then(function (sha) {
    return ghPushFile('rules/manifest.json', JSON.stringify(manifestData, null, 2), 'Update rules manifest', 'main', sha)
  })
}

export function ghSyncThoughtAndRules(thought, rules) {
  var promises = [ghPushThought(thought), ghPushThoughtsManifest()]
  if (rules) { promises.push(ghPushRuleSet(rules)); promises.push(ghPushRulesManifest()) }
  return Promise.all(promises).catch(function (e) { console.warn('GitHub thought/rules sync:', e) })
}

export function testGitHub() {
  return fetchWithRetry('https://api.github.com/repos/' + ST.ghUser + '/' + ST.ghRepo, { headers: ghHeaders() }, 30000).then(function (res) { return res.ok }).catch(function () { return false })
}

export function pullFromGitHub() {
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) { toast('GitHub credentials required \u2014 set them in Settings', 4000); return }
  toast('Syncing from GitHub\u2026', 2000)
  var url = ghApiUrl('apps/manifest.json')
  return fetch(url, { headers: ghHeaders() }).then(function (res) {
    if (res.status === 404) { toast('No apps/manifest.json in repo yet', 3000); return Promise.reject('NO_MANIFEST') }
    if (!res.ok) throw new Error('GitHub HTTP ' + res.status)
    return res.json()
  }).then(function (file) {
    var raw = atob(file.content.replace(/\n/g, ''))
    var manifest = JSON.parse(raw)
    if (!Array.isArray(manifest)) { toast('Invalid manifest format', 3000); return }
    var localIds = {}; ST.apps.forEach(function (a) { localIds[a.id] = true })
    var newApps = manifest.filter(function (a) { return !localIds[a.id] })
    if (!newApps.length) { toast('All apps already synced \u2714\uFE0F', 2500); return }
    var fetches = newApps.map(function (app) {
      return fetch(ghApiUrl('apps/' + app.id + '.html'), { headers: ghHeaders() }).then(function (r) {
        if (!r.ok) return null
        return r.json().then(function (f) {
          var code = decodeURIComponent(escape(atob(f.content.replace(/\n/g, ''))))
          return { id: app.id, name: app.name, icon: app.icon || '\uD83D\uDCE6', ci: app.ci || 0, desc: (app.prompts && app.prompts[0] ? app.prompts[0].text : '').slice(0, 90), code: code, versions: [], prompts: app.prompts || [], createdAt: app.createdAt || new Date().toISOString(), updatedAt: app.updatedAt || new Date().toISOString(), ghPushed: true }
        })
      }).catch(function () { return null })
    })
    return Promise.all(fetches).then(function (results) {
      var added = 0
      results.forEach(function (a) { if (a) { ST.apps.push(a); added++ } })
      if (added > 0) { persist(); /* renderGrid called from settings */ }
      toast('Synced ' + added + ' app' + (added === 1 ? '' : 's') + ' from GitHub \uD83D\uDD04', 3000)
    })
  }).catch(function (e) {
    if (e === 'NO_MANIFEST') return
    toast('Sync failed: ' + scrubKeys(String(e.message || e)), 4000)
  })
}

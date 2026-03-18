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

export function ghPushTree(files, message, branch) {
  var repoBase = 'https://api.github.com/repos/' + ST.ghUser + '/' + ST.ghRepo
  return ghFetch(repoBase + '/git/refs/heads/' + encodeURIComponent(branch)).then(function (ref) {
    var commitSha = ref.object.sha
    return ghFetch(repoBase + '/git/commits/' + commitSha).then(function (commit) {
      var baseTreeSha = commit.tree.sha
      var paths = Object.keys(files)
      var blobPromises = paths.map(function (path) {
        return ghFetch(repoBase + '/git/blobs', {
          method: 'POST',
          body: JSON.stringify({ content: safeBase64(files[path]), encoding: 'base64' })
        }).then(function (blob) {
          return { path: path, mode: '100644', type: 'blob', sha: blob.sha }
        })
      })
      return Promise.all(blobPromises).then(function (treeItems) {
        return ghFetch(repoBase + '/git/trees', {
          method: 'POST',
          body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems })
        })
      }).then(function (tree) {
        return ghFetch(repoBase + '/git/commits', {
          method: 'POST',
          body: JSON.stringify({ message: message, tree: tree.sha, parents: [commitSha] })
        })
      }).then(function (newCommit) {
        return ghFetch(repoBase + '/git/refs/heads/' + encodeURIComponent(branch), {
          method: 'PATCH',
          body: JSON.stringify({ sha: newCommit.sha })
        })
      })
    })
  })
}

export function testGitHub() {
  return fetchWithRetry('https://api.github.com/repos/' + ST.ghUser + '/' + ST.ghRepo, { headers: ghHeaders() }, 30000).then(function (res) { return res.ok }).catch(function () { return false })
}

var _syncing = false
export function pullFromGitHub() {
  if (_syncing) return Promise.resolve()
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) { toast('GitHub credentials required \u2014 set them in Settings', 4000); return }
  _syncing = true
  toast('Syncing from GitHub\u2026', 2000)

  // Fetch both the directory listing and the manifest in parallel
  var dirUrl = ghApiUrl('apps')
  var manifestUrl = ghApiUrl('apps/manifest.json')

  var dirPromise = fetch(dirUrl, { headers: ghHeaders() }).then(function (res) {
    if (res.status === 404) return []
    if (!res.ok) throw new Error('GitHub HTTP ' + res.status)
    return res.json()
  }).catch(function () { return [] })

  var manifestPromise = fetch(manifestUrl, { headers: ghHeaders() }).then(function (res) {
    if (res.status === 404) return []
    if (!res.ok) return []
    return res.json().then(function (file) {
      try {
        var raw = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ''))))
        var parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch (e) { return [] }
    })
  }).catch(function () { return [] })

  return Promise.all([dirPromise, manifestPromise]).then(function (results) {
    var dirEntries = results[0]
    var manifest = results[1]

    // Build a lookup from manifest for metadata
    var manifestById = {}
    manifest.forEach(function (m) { manifestById[m.id] = m })

    // Find all .html files from the directory listing (excluding manifest.json)
    var htmlFiles = []
    if (Array.isArray(dirEntries)) {
      dirEntries.forEach(function (entry) {
        if (entry.name && entry.name.endsWith('.html') && entry.type === 'file') {
          var id = entry.name.replace(/\.html$/, '')
          htmlFiles.push({ id: id, name: entry.name, download_url: entry.download_url })
        }
      })
    }

    if (!htmlFiles.length) { toast('No apps found in GitHub repo', 3000); return }

    // Build local ID set and refresh existing app metadata from manifest
    var localById = {}
    var metaUpdated = false
    ST.apps.forEach(function (a) {
      localById[a.id] = true
      var m = manifestById[a.id]
      if (m) {
        if (m.icon && m.icon !== a.icon) { a.icon = m.icon; metaUpdated = true }
        if (m.name && m.name !== a.name) { a.name = m.name; metaUpdated = true }
      }
    })
    if (metaUpdated) persist()

    // Fetch code for every app not yet in local state
    var newFiles = htmlFiles.filter(function (f) { return !localById[f.id] })

    if (!newFiles.length) { toast('All ' + htmlFiles.length + ' apps already synced \u2714\uFE0F', 2500); return }

    var fetches = newFiles.map(function (file) {
      return fetch(ghApiUrl('apps/' + file.name), { headers: ghHeaders() }).then(function (r) {
        if (!r.ok) return null
        return r.json().then(function (f) {
          var code = decodeURIComponent(escape(atob(f.content.replace(/\n/g, ''))))
          var meta = manifestById[file.id]
          var name = (meta && meta.name) || file.id
          var icon = (meta && meta.icon) || '\uD83D\uDCE6'
          var ci = (meta && typeof meta.ci === 'number') ? meta.ci : Math.floor(Math.random() * 8)
          var prompts = (meta && meta.prompts) || []
          var desc = (prompts[0] ? prompts[0].text : '').slice(0, 90)
          return {
            id: file.id, name: name, icon: icon, ci: ci, desc: desc,
            code: code, versions: [], prompts: prompts,
            createdAt: (meta && meta.createdAt) || new Date().toISOString(),
            updatedAt: (meta && meta.updatedAt) || new Date().toISOString(),
            ghPushed: true,
          }
        })
      }).catch(function () { return null })
    })

    return Promise.all(fetches).then(function (results) {
      var added = 0
      results.forEach(function (a) { if (a) { ST.apps.push(a); added++ } })
      if (added > 0) {
        persist()
        // Update manifest on GitHub to include all apps
        ghPushManifest('main').catch(function (e) { console.warn('Manifest update after sync:', e) })
      }
      toast('Synced ' + added + ' app' + (added === 1 ? '' : 's') + ' from GitHub (' + htmlFiles.length + ' total) \uD83D\uDD04', 3000)
    })
  }).catch(function (e) {
    toast('Sync failed: ' + scrubKeys(String(e.message || e)), 4000)
  }).finally(function () { _syncing = false })
}

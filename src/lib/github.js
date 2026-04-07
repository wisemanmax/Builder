import { ST } from './state.js'
import { slugify, ghHeaders, ghApiUrl, ghPageUrl, scrubKeys, toast } from './utils.js'
import { fetchWithRetry } from './ai.js'
import { persist } from './state.js'
import { logWarn } from './errors.js'

export function safeBase64(str) {
  try {
    var bytes = new TextEncoder().encode(str)
    var bin = ''
    var CHUNK = 8192
    for (var i = 0; i < bytes.length; i += CHUNK)
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
    return btoa(bin)
  } catch (e) {
    return btoa(unescape(encodeURIComponent(str)))
  }
}

export function ghFetch(url, opts) {
  opts = opts || {}
  var headers = ghHeaders()
  if (opts.headers) {
    for (var k in opts.headers) headers[k] = opts.headers[k]
  }
  opts.headers = headers
  return fetchWithRetry(url, opts, 30000).then(function (res) {
    if (!res.ok)
      return res
        .json()
        .catch(function () {
          return {}
        })
        .then(function (e) {
          throw new Error(e.message || 'GitHub HTTP ' + res.status)
        })
    return res.status === 204 ? {} : res.json()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// External repo linking (Think screen): fetch an arbitrary repo the user's
// PAT can access, build a compact "tree + key files" context blob to inject
// into SYS_THINK. Does NOT use ghApiUrl() because that is hardcoded to the
// user's deploy repo (ST.ghUser/ST.ghRepo).
// ─────────────────────────────────────────────────────────────────────────────

export function ghParseRepoUrl(input) {
  if (!input) return null
  var s = String(input).trim()
  if (!s) return null
  s = s.replace(/\.git$/i, '')
  var m = s.match(/^git@github\.com:([^/]+)\/([^/]+?)$/i)
  if (m) return _validateOwnerRepo(m[1], m[2])
  m = s.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)/i)
  if (m) return _validateOwnerRepo(m[1], m[2])
  m = s.match(/^([^/\s]+)\/([^/\s]+)$/)
  if (m) return _validateOwnerRepo(m[1], m[2])
  return null
}

function _validateOwnerRepo(owner, repo) {
  var re = /^[\w.-]+$/
  if (!re.test(owner) || !re.test(repo)) return null
  return { owner: owner, repo: repo }
}

function _ghApiRepoBase(owner, repo) {
  return 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo)
}

export function ghFetchExternalTree(owner, repo, branch) {
  var base = _ghApiRepoBase(owner, repo)
  var getTree = function (br) {
    return ghFetch(base + '/git/trees/' + encodeURIComponent(br) + '?recursive=1').then(function (d) {
      return { tree: (d && d.tree) || [], truncated: !!(d && d.truncated), branch: br }
    })
  }
  if (branch) return getTree(branch)
  return ghFetch(base).then(function (d) {
    var br = (d && d.default_branch) || 'main'
    return getTree(br)
  })
}

export function ghFetchExternalFile(owner, repo, path, branch) {
  var url =
    _ghApiRepoBase(owner, repo) +
    '/contents/' +
    path.split('/').map(encodeURIComponent).join('/') +
    '?ref=' +
    encodeURIComponent(branch)
  return ghFetch(url)
    .then(function (d) {
      if (!d || !d.content) return null
      if (d.size && d.size > 50000) return null
      try {
        var bin = atob(String(d.content).replace(/\s+/g, ''))
        var bytes = new Uint8Array(bin.length)
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return new TextDecoder('utf-8').decode(bytes)
      } catch (e) {
        return null
      }
    })
    .catch(function () {
      return null
    })
}

function _pickKeyFiles(tree) {
  var paths = []
  for (var i = 0; i < tree.length; i++) {
    if (tree[i].type === 'blob' && tree[i].path) paths.push(tree[i])
  }
  var lower = paths.map(function (e) {
    return { e: e, p: e.path.toLowerCase() }
  })
  var picked = []
  var seen = {}
  var add = function (entry) {
    if (entry && !seen[entry.path]) {
      seen[entry.path] = true
      picked.push(entry)
    }
  }
  var findFirst = function (predicate) {
    for (var j = 0; j < lower.length; j++) if (predicate(lower[j].p, lower[j].e)) return lower[j].e
    return null
  }
  add(
    findFirst(function (p) {
      return p === 'readme.md'
    })
  )
  add(
    findFirst(function (p) {
      return /^readme(\.|$)/.test(p)
    })
  )
  add(
    findFirst(function (p) {
      return p === 'package.json'
    })
  )
  add(
    findFirst(function (p) {
      return p === 'index.html'
    })
  )
  add(
    findFirst(function (p) {
      return /^vite\.config\.(js|ts|mjs|cjs)$/.test(p)
    })
  )
  add(
    findFirst(function (p) {
      return /^src\/main\.(js|ts|jsx|tsx)$/.test(p)
    })
  )
  add(
    findFirst(function (p) {
      return /^src\/app\.(js|ts|jsx|tsx)$/.test(p)
    })
  )
  add(
    findFirst(function (p) {
      return /^src\/index\.(js|ts)$/.test(p)
    })
  )
  // Largest remaining .md
  var mds = lower.filter(function (x) {
    return /\.md$/.test(x.p) && !seen[x.e.path]
  })
  mds.sort(function (a, b) {
    return (b.e.size || 0) - (a.e.size || 0)
  })
  if (mds[0]) add(mds[0].e)
  return picked
}

function _trimTo(str, max) {
  if (!str) return ''
  if (str.length <= max) return str
  return str.slice(0, max) + '\n[\u2026trimmed]'
}

export function ghFetchRepoContext(owner, repo) {
  return ghFetchExternalTree(owner, repo).then(function (res) {
    var tree = res.tree
    var branch = res.branch
    var truncated = res.truncated
    // Tree summary: paths only, cap at 300 entries
    var paths = []
    for (var i = 0; i < tree.length && paths.length < 300; i++) {
      if (tree[i].path) paths.push(tree[i].path)
    }
    var treeSummary = paths.join('\n')
    if (truncated || tree.length > paths.length) treeSummary += '\n[truncated \u2014 repo too large]'

    var picks = _pickKeyFiles(tree)
    var fetches = picks.map(function (p) {
      return ghFetchExternalFile(owner, repo, p.path, branch).then(function (body) {
        return { path: p.path, body: body }
      })
    })
    return Promise.all(fetches).then(function (files) {
      var blocks = ['=== FILE TREE ===\n' + treeSummary]
      var fileCount = 0
      for (var j = 0; j < files.length; j++) {
        if (files[j].body) {
          blocks.push('=== ' + files[j].path + ' ===\n' + _trimTo(files[j].body, 1500))
          fileCount++
        }
      }
      var context = blocks.join('\n\n')
      if (context.length > 8000) context = context.slice(0, 8000) + '\n[context truncated for token budget]'
      return {
        owner: owner,
        repo: repo,
        branch: branch,
        fileCount: fileCount,
        treeSize: tree.length,
        truncated: truncated,
        context: context,
        fetchedAt: Date.now(),
      }
    })
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
    }).then(function () {
      return sha
    })
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
  return fetchWithRetry(url, { headers: ghHeaders() }, 30000)
    .then(function (res) {
      if (res.status === 404) return null
      if (!res.ok) return null
      return res.json().then(function (d) {
        return d.sha || null
      })
    })
    .catch(function () {
      return null
    })
}

export function ghMergeBranch(branchName, appName) {
  return fetchWithRetry(
    'https://api.github.com/repos/' + ST.ghUser + '/' + ST.ghRepo + '/merges',
    {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({
        base: 'main',
        head: branchName,
        commit_message: '\u2705 Merge ' + branchName + ' \u2014 ' + appName + ' via The Builder',
      }),
    },
    30000
  ).then(function (res) {
    if (res.status === 204) return { noChange: true }
    if (res.status === 409) throw new Error('Merge conflict')
    if (!res.ok)
      return res
        .json()
        .catch(function () {
          return {}
        })
        .then(function (e) {
          throw new Error(e.message || 'Merge failed')
        })
    return res.json()
  })
}

export function ghDeleteBranch(branchName) {
  ghFetch('https://api.github.com/repos/' + ST.ghUser + '/' + ST.ghRepo + '/git/refs/heads/' + branchName, {
    method: 'DELETE',
  }).catch(function () {})
}

export function ghPushManifest(branch) {
  var manifestData = ST.apps.map(function (a) {
    return {
      id: a.id,
      name: a.name,
      icon: a.icon,
      ci: a.ci,
      url: ghPageUrl(a.id),
      path: 'apps/' + a.id + '.html',
      prompts: (a.prompts || []).map(function (p) {
        return { ts: p.ts, type: p.type, text: p.text.slice(0, 120) }
      }),
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }
  })
  return ghGetFileSha('apps/manifest.json', branch).then(function (existingSha) {
    return ghPushFile(
      'apps/manifest.json',
      JSON.stringify(manifestData, null, 2),
      'Update Builder manifest',
      branch,
      existingSha
    )
  })
}

export function ghPushThought(thought) {
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) return Promise.resolve(null)
  var slug = slugify(thought.name || 'thought')
  var path = 'thoughts/' + slug + '.json'
  var content = JSON.stringify(
    {
      id: thought.id,
      name: thought.name,
      status: thought.status,
      originalPrompt: thought.originalPrompt,
      rounds: thought.rounds,
      conversation: thought.conversation,
      brief: thought.brief,
      linkedRulesId: thought.linkedRulesId,
      linkedAppId: thought.linkedAppId,
      version: thought.version || 1,
      versions: thought.versions || [],
      createdAt: thought.createdAt,
      updatedAt: thought.updatedAt,
    },
    null,
    2
  )
  return ghGetFileSha(path, 'main').then(function (sha) {
    return ghPushFile(path, content, 'Save thought: ' + thought.name, 'main', sha)
  })
}

export function ghPushThoughtsManifest() {
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) return Promise.resolve(null)
  var manifestData = ST.thoughts.map(function (t) {
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      rounds: t.rounds,
      linkedRulesId: t.linkedRulesId,
      linkedAppId: t.linkedAppId,
      path: 'thoughts/' + slugify(t.name || 'thought') + '.json',
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }
  })
  return ghGetFileSha('thoughts/manifest.json', 'main').then(function (sha) {
    return ghPushFile(
      'thoughts/manifest.json',
      JSON.stringify(manifestData, null, 2),
      'Update thoughts manifest',
      'main',
      sha
    )
  })
}

export function ghPushRuleSet(rules) {
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) return Promise.resolve(null)
  var slug = slugify(rules.name || 'rules')
  var path = 'rules/' + slug + '.json'
  var content = JSON.stringify(
    {
      id: rules.id,
      name: rules.name,
      linkedThoughtId: rules.linkedThoughtId,
      mustRules: rules.mustRules,
      mustNotRules: rules.mustNotRules,
      niceToHave: rules.niceToHave,
      createdAt: rules.createdAt,
      updatedAt: rules.updatedAt,
    },
    null,
    2
  )
  return ghGetFileSha(path, 'main').then(function (sha) {
    return ghPushFile(path, content, 'Save rules: ' + rules.name, 'main', sha)
  })
}

export function ghPushRulesManifest() {
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) return Promise.resolve(null)
  var manifestData = ST.rules.map(function (r) {
    return {
      id: r.id,
      name: r.name,
      linkedThoughtId: r.linkedThoughtId,
      ruleCount: (r.mustRules || []).length + (r.mustNotRules || []).length + (r.niceToHave || []).length,
      path: 'rules/' + slugify(r.name || 'rules') + '.json',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }
  })
  return ghGetFileSha('rules/manifest.json', 'main').then(function (sha) {
    return ghPushFile(
      'rules/manifest.json',
      JSON.stringify(manifestData, null, 2),
      'Update rules manifest',
      'main',
      sha
    )
  })
}

export function ghPushBuildHistory(appId, chatHistory) {
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo || !appId) return Promise.resolve(null)
  var path = 'history/' + appId + '.json'
  var content = JSON.stringify(
    {
      appId: appId,
      sessions: (chatHistory || []).map(function (s) {
        return {
          id: s.id,
          ts: s.ts,
          prompt: s.prompt,
          messages: s.messages || [],
        }
      }),
      updatedAt: new Date().toISOString(),
    },
    null,
    2
  )
  return ghGetFileSha(path, 'main').then(function (sha) {
    return ghPushFile(path, content, 'Save build history: ' + appId, 'main', sha)
  })
}

export function ghPushBuildHistoryManifest() {
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) return Promise.resolve(null)
  var manifestData = ST.apps
    .filter(function (a) {
      return a.chatHistory && a.chatHistory.length > 0
    })
    .map(function (a) {
      return {
        appId: a.id,
        appName: a.name,
        sessionCount: a.chatHistory.length,
        path: 'history/' + a.id + '.json',
        updatedAt: a.updatedAt,
      }
    })
  return ghGetFileSha('history/manifest.json', 'main').then(function (sha) {
    return ghPushFile(
      'history/manifest.json',
      JSON.stringify(manifestData, null, 2),
      'Update build history manifest',
      'main',
      sha
    )
  })
}

export function ghSyncBuildHistory(appId) {
  var app = null
  for (var i = 0; i < ST.apps.length; i++) {
    if (ST.apps[i].id === appId) {
      app = ST.apps[i]
      break
    }
  }
  if (!app || !app.chatHistory || !app.chatHistory.length) return Promise.resolve(null)
  return Promise.all([ghPushBuildHistory(appId, app.chatHistory), ghPushBuildHistoryManifest()]).catch(function (e) {
    logWarn('GitHub', 'build history sync: ' + e)
  })
}

export function ghSyncThoughtAndRules(thought, rules) {
  var promises = [ghPushThought(thought), ghPushThoughtsManifest()]
  if (rules) {
    promises.push(ghPushRuleSet(rules))
    promises.push(ghPushRulesManifest())
  }
  return Promise.all(promises).catch(function (e) {
    logWarn('GitHub', 'thought/rules sync: ' + e)
  })
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
          body: JSON.stringify({ content: safeBase64(files[path]), encoding: 'base64' }),
        }).then(function (blob) {
          return { path: path, mode: '100644', type: 'blob', sha: blob.sha }
        })
      })
      return Promise.all(blobPromises)
        .then(function (treeItems) {
          return ghFetch(repoBase + '/git/trees', {
            method: 'POST',
            body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
          })
        })
        .then(function (tree) {
          return ghFetch(repoBase + '/git/commits', {
            method: 'POST',
            body: JSON.stringify({ message: message, tree: tree.sha, parents: [commitSha] }),
          })
        })
        .then(function (newCommit) {
          return ghFetch(repoBase + '/git/refs/heads/' + encodeURIComponent(branch), {
            method: 'PATCH',
            body: JSON.stringify({ sha: newCommit.sha }),
          })
        })
    })
  })
}

export function testGitHub() {
  return fetchWithRetry('https://api.github.com/repos/' + ST.ghUser + '/' + ST.ghRepo, { headers: ghHeaders() }, 30000)
    .then(function (res) {
      return res.ok
    })
    .catch(function () {
      return false
    })
}

function _pullBuildHistory() {
  var historyManifestUrl = ghApiUrl('history/manifest.json')
  fetch(historyManifestUrl, { headers: ghHeaders() })
    .then(function (res) {
      if (!res.ok) return
      return res.json().then(function (file) {
        var raw = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ''))))
        var entries = JSON.parse(raw)
        if (!Array.isArray(entries)) return
        var fetchPromises = entries.map(function (entry) {
          return fetch(ghApiUrl(entry.path), { headers: ghHeaders() })
            .then(function (r) {
              if (!r.ok) return null
              return r.json().then(function (f) {
                var data = JSON.parse(decodeURIComponent(escape(atob(f.content.replace(/\n/g, '')))))
                return data
              })
            })
            .catch(function () {
              return null
            })
        })
        return Promise.all(fetchPromises).then(function (historyFiles) {
          var merged = 0
          historyFiles.forEach(function (h) {
            if (!h || !h.appId || !h.sessions) return
            var app = null
            for (var i = 0; i < ST.apps.length; i++) {
              if (ST.apps[i].id === h.appId) {
                app = ST.apps[i]
                break
              }
            }
            if (!app) return
            if (!app.chatHistory) app.chatHistory = []
            var existingIds = {}
            app.chatHistory.forEach(function (s) {
              existingIds[s.id] = true
            })
            h.sessions.forEach(function (s) {
              if (!existingIds[s.id]) {
                app.chatHistory.push(s)
                merged++
              }
            })
            app.chatHistory.sort(function (a, b) {
              return (b.ts || '').localeCompare(a.ts || '')
            })
          })
          if (merged > 0) persist()
        })
      })
    })
    .catch(function () {
      // History pull is best-effort
    })
}

var _syncing = false
export function pullFromGitHub() {
  if (_syncing) return Promise.resolve()
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) {
    toast('GitHub credentials required \u2014 set them in Settings', 4000)
    return
  }
  _syncing = true
  toast('Syncing from GitHub\u2026', 2000)

  // Fetch both the directory listing and the manifest in parallel
  var dirUrl = ghApiUrl('apps')
  var manifestUrl = ghApiUrl('apps/manifest.json')

  var dirPromise = fetch(dirUrl, { headers: ghHeaders() })
    .then(function (res) {
      if (res.status === 404) return []
      if (!res.ok) throw new Error('GitHub HTTP ' + res.status)
      return res.json()
    })
    .catch(function () {
      return []
    })

  var manifestPromise = fetch(manifestUrl, { headers: ghHeaders() })
    .then(function (res) {
      if (res.status === 404) return []
      if (!res.ok) return []
      return res.json().then(function (file) {
        try {
          var raw = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ''))))
          var parsed = JSON.parse(raw)
          return Array.isArray(parsed) ? parsed : []
        } catch (e) {
          return []
        }
      })
    })
    .catch(function () {
      return []
    })

  return Promise.all([dirPromise, manifestPromise])
    .then(function (results) {
      var dirEntries = results[0]
      var manifest = results[1]

      // Build a lookup from manifest for metadata
      var manifestById = {}
      manifest.forEach(function (m) {
        manifestById[m.id] = m
      })

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

      if (!htmlFiles.length) {
        toast('No apps found in GitHub repo', 3000)
        return
      }

      // Build local ID set and refresh existing app metadata from manifest
      var localById = {}
      var metaUpdated = false
      ST.apps.forEach(function (a) {
        localById[a.id] = true
        var m = manifestById[a.id]
        if (m) {
          if (m.icon && m.icon !== a.icon) {
            a.icon = m.icon
            metaUpdated = true
          }
          if (m.name && m.name !== a.name) {
            a.name = m.name
            metaUpdated = true
          }
        }
      })
      if (metaUpdated) persist()

      // Fetch code for every app not yet in local state
      var newFiles = htmlFiles.filter(function (f) {
        return !localById[f.id]
      })

      if (!newFiles.length) {
        toast('All ' + htmlFiles.length + ' apps already synced \u2714\uFE0F', 2500)
        return
      }

      var fetches = newFiles.map(function (file) {
        return fetch(ghApiUrl('apps/' + file.name), { headers: ghHeaders() })
          .then(function (r) {
            if (!r.ok) return null
            return r.json().then(function (f) {
              var code = decodeURIComponent(escape(atob(f.content.replace(/\n/g, ''))))
              var meta = manifestById[file.id]
              var name = (meta && meta.name) || file.id
              var icon = (meta && meta.icon) || '\uD83D\uDCE6'
              var ci = meta && typeof meta.ci === 'number' ? meta.ci : Math.floor(Math.random() * 8)
              var prompts = (meta && meta.prompts) || []
              var desc = (prompts[0] ? prompts[0].text : '').slice(0, 90)
              return {
                id: file.id,
                name: name,
                icon: icon,
                ci: ci,
                desc: desc,
                code: code,
                versions: [],
                prompts: prompts,
                createdAt: (meta && meta.createdAt) || new Date().toISOString(),
                updatedAt: (meta && meta.updatedAt) || new Date().toISOString(),
                ghPushed: true,
              }
            })
          })
          .catch(function () {
            return null
          })
      })

      return Promise.all(fetches).then(function (results) {
        var added = 0
        results.forEach(function (a) {
          if (a) {
            ST.apps.push(a)
            added++
          }
        })
        if (added > 0) {
          persist()
          // Update manifest on GitHub to include all apps
          ghPushManifest('main').catch(function (e) {
            logWarn('GitHub', 'manifest update after sync: ' + e)
          })
        }
        // Also pull build history for all apps
        _pullBuildHistory()
        toast(
          'Synced ' +
            added +
            ' app' +
            (added === 1 ? '' : 's') +
            ' from GitHub (' +
            htmlFiles.length +
            ' total) \uD83D\uDD04',
          3000
        )
      })
    })
    .catch(function (e) {
      toast('Sync failed: ' + scrubKeys(String(e.message || e)), 4000)
    })
    .finally(function () {
      _syncing = false
    })
}

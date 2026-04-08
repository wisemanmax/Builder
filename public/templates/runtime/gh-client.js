// Builder runtime GitHub client — loaded by generated apps at runtime to
// talk to their target repo via the GitHub API. Provisioned alongside the
// builder-bridge workflow. See runtime/auth-bootstrap.html for the PAT UX.
//
// The {OWNER} and {REPO} placeholders are substituted by the build pipeline
// when this file is pushed into apps/runtime/ for a specific build.

;(function () {
  var OWNER = '{OWNER}'
  var REPO = '{REPO}'
  var BRIDGE_WORKFLOW = 'builder-bridge.yml'
  var TOKEN_KEY = 'gh_token_' + OWNER + '_' + REPO

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || ''
    } catch (e) {
      return ''
    }
  }

  function setToken(tok) {
    try {
      if (tok) localStorage.setItem(TOKEN_KEY, tok)
      else localStorage.removeItem(TOKEN_KEY)
    } catch (e) {}
  }

  function apiBase() {
    return 'https://api.github.com/repos/' + encodeURIComponent(OWNER) + '/' + encodeURIComponent(REPO)
  }

  function headers(extra) {
    var h = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    var tok = getToken()
    if (tok) h['Authorization'] = 'Bearer ' + tok
    if (extra) {
      for (var k in extra) h[k] = extra[k]
    }
    return h
  }

  function req(url, opts) {
    opts = opts || {}
    opts.headers = headers(opts.headers)
    return fetch(url, opts).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        setToken('')
        return res
          .json()
          .catch(function () {
            return {}
          })
          .then(function (e) {
            throw new Error('GitHub auth failed: ' + (e.message || res.status))
          })
      }
      if (res.status === 204) return null
      if (!res.ok)
        return res
          .json()
          .catch(function () {
            return {}
          })
          .then(function (e) {
            throw new Error(e.message || 'GitHub HTTP ' + res.status)
          })
      return res.json()
    })
  }

  function b64encode(str) {
    try {
      var bytes = new TextEncoder().encode(str)
      var bin = ''
      for (var i = 0; i < bytes.length; i += 8192)
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)))
      return btoa(bin)
    } catch (e) {
      return btoa(unescape(encodeURIComponent(str)))
    }
  }

  function b64decode(b64) {
    try {
      var bin = atob(String(b64).replace(/\s+/g, ''))
      var bytes = new Uint8Array(bin.length)
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new TextDecoder('utf-8').decode(bytes)
    } catch (e) {
      return ''
    }
  }

  function encodePath(path) {
    return String(path).split('/').map(encodeURIComponent).join('/')
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  function isConnected() {
    return !!getToken()
  }

  function validateToken(candidate) {
    return fetch('https://api.github.com/user', {
      headers: {
        Authorization: 'Bearer ' + candidate,
        Accept: 'application/vnd.github+json',
      },
    }).then(function (res) {
      if (!res.ok) throw new Error('Invalid token (HTTP ' + res.status + ')')
      return res.json()
    })
  }

  function connect() {
    // Show the auth bootstrap overlay and resolve when the user has pasted a
    // valid token. If the overlay is already open, this is idempotent.
    if (isConnected()) return Promise.resolve(true)
    return new Promise(function (resolve, reject) {
      var existing = document.getElementById('gh-auth-bootstrap')
      if (existing) existing.remove()
      fetch('./runtime/auth-bootstrap.html')
        .then(function (r) {
          if (!r.ok) throw new Error('auth-bootstrap.html not found')
          return r.text()
        })
        .then(function (html) {
          var wrap = document.createElement('div')
          wrap.id = 'gh-auth-bootstrap'
          wrap.innerHTML = html.replace(/\{OWNER\}/g, OWNER).replace(/\{REPO\}/g, REPO)
          document.body.appendChild(wrap)
          var input = wrap.querySelector('#gh-ab-token')
          var btn = wrap.querySelector('#gh-ab-submit')
          var err = wrap.querySelector('#gh-ab-err')
          var onSubmit = function () {
            var v = (input.value || '').trim()
            if (!v) {
              err.textContent = 'Paste a token first.'
              return
            }
            btn.disabled = true
            btn.textContent = 'Checking\u2026'
            validateToken(v)
              .then(function () {
                setToken(v)
                wrap.remove()
                resolve(true)
              })
              .catch(function (e) {
                btn.disabled = false
                btn.textContent = 'Connect'
                err.textContent = e.message || 'Token check failed.'
              })
          }
          btn.addEventListener('click', onSubmit)
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') onSubmit()
          })
          var cancel = wrap.querySelector('#gh-ab-cancel')
          if (cancel) {
            cancel.addEventListener('click', function () {
              wrap.remove()
              reject(new Error('Auth cancelled'))
            })
          }
        })
        .catch(reject)
    })
  }

  function disconnect() {
    setToken('')
  }

  function ensureConnected() {
    return isConnected() ? Promise.resolve(true) : connect()
  }

  function readFile(path, ref) {
    return ensureConnected().then(function () {
      var url = apiBase() + '/contents/' + encodePath(path) + (ref ? '?ref=' + encodeURIComponent(ref) : '')
      return req(url).then(function (d) {
        if (!d || !d.content) return null
        return { content: b64decode(d.content), sha: d.sha, path: d.path, size: d.size }
      })
    })
  }

  function listDir(path, ref) {
    return ensureConnected().then(function () {
      var url = apiBase() + '/contents/' + encodePath(path || '') + (ref ? '?ref=' + encodeURIComponent(ref) : '')
      return req(url).then(function (d) {
        if (!Array.isArray(d)) return []
        return d.map(function (e) {
          return { name: e.name, path: e.path, type: e.type, size: e.size, sha: e.sha }
        })
      })
    })
  }

  function writeFile(path, content, message, branch) {
    return ensureConnected().then(function () {
      // Fetch existing sha first so we can update rather than create.
      var url = apiBase() + '/contents/' + encodePath(path)
      return req(url + '?ref=' + encodeURIComponent(branch || 'main'))
        .catch(function () {
          return null
        })
        .then(function (existing) {
          var body = {
            message: message || 'Update ' + path + ' via generated app',
            content: b64encode(content),
            branch: branch || 'main',
          }
          if (existing && existing.sha) body.sha = existing.sha
          return req(url, { method: 'PUT', body: JSON.stringify(body) })
        })
    })
  }

  function dispatchAction(action, args) {
    return ensureConnected().then(function () {
      var url = apiBase() + '/actions/workflows/' + encodeURIComponent(BRIDGE_WORKFLOW) + '/dispatches'
      var body = {
        ref: 'main',
        inputs: {
          action: String(action),
          args: typeof args === 'string' ? args : JSON.stringify(args || {}),
        },
      }
      return req(url, { method: 'POST', body: JSON.stringify(body) }).then(function () {
        // workflow_dispatch returns 204 with no body; we poll to find the run id.
        var started = Date.now()
        var poll = function () {
          return listRuns({ status: 'in_progress', perPage: 10 }).then(function (runs) {
            var match = (runs && runs.workflow_runs ? runs.workflow_runs : []).find(function (r) {
              return r.name === 'Builder Bridge' || (r.path && r.path.indexOf('builder-bridge.yml') >= 0)
            })
            if (match) return { runId: match.id, htmlUrl: match.html_url }
            if (Date.now() - started > 15000) return { runId: null, htmlUrl: null, pending: true }
            return new Promise(function (res) {
              setTimeout(function () {
                res(poll())
              }, 1500)
            })
          })
        }
        return poll()
      })
    })
  }

  function listRuns(opts) {
    return ensureConnected().then(function () {
      opts = opts || {}
      var qs = []
      if (opts.status) qs.push('status=' + encodeURIComponent(opts.status))
      qs.push('per_page=' + encodeURIComponent(opts.perPage || 20))
      if (opts.branch) qs.push('branch=' + encodeURIComponent(opts.branch))
      var url = apiBase() + '/actions/workflows/' + encodeURIComponent(BRIDGE_WORKFLOW) + '/runs?' + qs.join('&')
      return req(url)
    })
  }

  function getRun(runId) {
    return ensureConnected().then(function () {
      return req(apiBase() + '/actions/runs/' + encodeURIComponent(runId))
    })
  }

  function getRunJobs(runId) {
    return ensureConnected().then(function () {
      return req(apiBase() + '/actions/runs/' + encodeURIComponent(runId) + '/jobs')
    })
  }

  function getRunLogs(runId) {
    // Per-job logs are text; fetch the first job's logs as the primary surface.
    return getRunJobs(runId).then(function (d) {
      var jobs = (d && d.jobs) || []
      if (!jobs.length) return ''
      var jobId = jobs[0].id
      var url = apiBase() + '/actions/jobs/' + encodeURIComponent(jobId) + '/logs'
      return fetch(url, { headers: headers() }).then(function (res) {
        if (!res.ok) return ''
        return res.text()
      })
    })
  }

  window.GH = {
    owner: OWNER,
    repo: REPO,
    connect: connect,
    disconnect: disconnect,
    isConnected: isConnected,
    readFile: readFile,
    writeFile: writeFile,
    listDir: listDir,
    dispatchAction: dispatchAction,
    listRuns: listRuns,
    getRun: getRun,
    getRunJobs: getRunJobs,
    getRunLogs: getRunLogs,
  }
})()

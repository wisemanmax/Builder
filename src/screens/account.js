// Account screen — sign up, sign in, account management
import { ST } from '../lib/state.js'
import { $, toast, esc } from '../lib/utils.js'
import { signUp, signIn, signOut, isLoggedIn, saveKeysWithSync } from '../lib/auth.js'
import { syncKeysToVault, getVaultSetupSQL, getAppsUserScopeSQL } from '../lib/key-vault.js'
import { saveKeys } from '../lib/state.js'
import { renderGrid } from '../components/app-icon.js'

function _renderAccountState() {
  var wrap = $('acct-content')
  if (!wrap) return

  if (isLoggedIn()) {
    wrap.innerHTML =
      '<div class="acct-logged-in">' +
      '<div class="acct-avatar">' + (ST.authEmail ? esc(ST.authEmail.charAt(0).toUpperCase()) : '?') + '</div>' +
      '<div class="acct-email">' + esc(ST.authEmail) + '</div>' +
      '<div class="acct-uid" title="User ID">' + esc(ST.authUser) + '</div>' +
      '<div class="acct-actions">' +
      '<button class="btn-s acct-sync-btn" id="acct-sync-keys">Sync Keys to Cloud</button>' +
      '<button class="btn-s acct-setup-btn" id="acct-show-sql">Database Setup SQL</button>' +
      '<button class="btn-s acct-signout-btn" id="acct-signout">Sign Out</button>' +
      '</div>' +
      '<div id="acct-sql-panel" class="acct-sql-panel" style="display:none"></div>' +
      '</div>'

    $('acct-sync-keys').addEventListener('click', function () {
      toast('Syncing keys to cloud\u2026')
      syncKeysToVault()
        .then(function () {
          toast('Keys synced to cloud (encrypted) \u2713', 3000)
        })
        .catch(function (e) {
          toast('Sync failed: ' + e.message, 4000)
        })
    })

    $('acct-show-sql').addEventListener('click', function () {
      var panel = $('acct-sql-panel')
      if (panel.style.display === 'none') {
        var vaultSQL = getVaultSetupSQL()
        var appsSQL = getAppsUserScopeSQL()
        panel.innerHTML =
          '<div class="acct-sql-title">Run these in your Supabase SQL Editor:</div>' +
          '<div class="acct-sql-section">' +
          '<div class="acct-sql-label">1. Key Vault Table</div>' +
          '<pre class="acct-sql-code">' + esc(vaultSQL) + '</pre>' +
          '<button class="btn-xs" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent);B.toast(\'Copied!\')">Copy</button>' +
          '</div>' +
          '<div class="acct-sql-section">' +
          '<div class="acct-sql-label">2. User-Scoped Apps</div>' +
          '<pre class="acct-sql-code">' + esc(appsSQL) + '</pre>' +
          '<button class="btn-xs" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent);B.toast(\'Copied!\')">Copy</button>' +
          '</div>'
        panel.style.display = 'block'
      } else {
        panel.style.display = 'none'
      }
    })

    $('acct-signout').addEventListener('click', function () {
      if (!confirm('Sign out? Your local keys will remain on this device.')) return
      signOut().then(function () {
        toast('Signed out')
        _renderAccountState()
      })
    })
  } else {
    wrap.innerHTML =
      '<div class="acct-auth-form">' +
      '<div class="acct-tabs">' +
      '<button class="acct-tab active" id="acct-tab-signin">Sign In</button>' +
      '<button class="acct-tab" id="acct-tab-signup">Create Account</button>' +
      '</div>' +
      '<div class="acct-form-body">' +
      '<div class="acct-sb-note">' +
      'Requires Supabase with Auth enabled. ' +
      'Set your Supabase URL and Anon Key in <strong>Settings</strong> first.' +
      '</div>' +
      '<div class="fl"><label>Email</label><input class="fi" type="email" id="acct-email" placeholder="you@example.com" autocomplete="email"></div>' +
      '<div class="fl"><label>Password</label><input class="fi" type="password" id="acct-pass" placeholder="Min 6 characters" autocomplete="current-password"></div>' +
      '<div id="acct-pass-confirm-row" class="fl" style="display:none"><label>Confirm Password</label><input class="fi" type="password" id="acct-pass2" placeholder="Re-enter password" autocomplete="new-password"></div>' +
      '<button class="btn-p" id="acct-submit">Sign In</button>' +
      '<div id="acct-status" class="acct-status"></div>' +
      '</div>' +
      '</div>'

    var isSignUp = false

    $('acct-tab-signin').addEventListener('click', function () {
      isSignUp = false
      $('acct-tab-signin').classList.add('active')
      $('acct-tab-signup').classList.remove('active')
      $('acct-pass-confirm-row').style.display = 'none'
      $('acct-submit').textContent = 'Sign In'
      $('acct-status').textContent = ''
    })

    $('acct-tab-signup').addEventListener('click', function () {
      isSignUp = true
      $('acct-tab-signup').classList.add('active')
      $('acct-tab-signin').classList.remove('active')
      $('acct-pass-confirm-row').style.display = ''
      $('acct-submit').textContent = 'Create Account'
      $('acct-status').textContent = ''
    })

    $('acct-submit').addEventListener('click', function () {
      var email = $('acct-email').value.trim()
      var pass = $('acct-pass').value
      var statusEl = $('acct-status')

      if (!ST.sbUrl || !ST.sbAnon) {
        statusEl.className = 'acct-status err'
        statusEl.textContent = 'Set Supabase URL & Anon Key in Settings first'
        return
      }
      if (!email || !pass) {
        statusEl.className = 'acct-status err'
        statusEl.textContent = 'Enter email and password'
        return
      }
      if (pass.length < 6) {
        statusEl.className = 'acct-status err'
        statusEl.textContent = 'Password must be at least 6 characters'
        return
      }

      if (isSignUp) {
        var pass2 = $('acct-pass2').value
        if (pass !== pass2) {
          statusEl.className = 'acct-status err'
          statusEl.textContent = 'Passwords do not match'
          return
        }
        statusEl.className = 'acct-status'
        statusEl.textContent = 'Creating account\u2026'
        $('acct-submit').disabled = true

        signUp(email, pass)
          .then(function (result) {
            $('acct-submit').disabled = false
            if (result.confirmed) {
              toast('Account created! Welcome \u26A1', 3000)
              _renderAccountState()
            } else {
              statusEl.className = 'acct-status ok'
              statusEl.textContent = 'Check your email to confirm your account, then sign in.'
            }
          })
          .catch(function (e) {
            $('acct-submit').disabled = false
            statusEl.className = 'acct-status err'
            statusEl.textContent = e.message
          })
      } else {
        statusEl.className = 'acct-status'
        statusEl.textContent = 'Signing in\u2026'
        $('acct-submit').disabled = true

        signIn(email, pass)
          .then(function () {
            $('acct-submit').disabled = false
            toast('Signed in as ' + email + ' \u2713', 3000)
            _renderAccountState()
            renderGrid()
          })
          .catch(function (e) {
            $('acct-submit').disabled = false
            statusEl.className = 'acct-status err'
            statusEl.textContent = e.message
          })
      }
    })

    // Enter key submits
    var enterHandler = function (e) {
      if (e.key === 'Enter') $('acct-submit').click()
    }
    $('acct-email').addEventListener('keydown', enterHandler)
    $('acct-pass').addEventListener('keydown', enterHandler)
  }
}

export function openAccount() {
  _renderAccountState()
  $('account-overlay').classList.add('on')
}

export function closeAccount() {
  $('account-overlay').classList.remove('on')
}

export function initAccount() {
  var closeBtn = $('acct-close')
  if (closeBtn) {
    closeBtn.addEventListener('click', closeAccount)
  }
  var overlay = $('account-overlay')
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target.id === 'account-overlay') closeAccount()
    })
  }
}

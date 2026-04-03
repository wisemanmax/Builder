// Supabase Auth — account creation, login, logout, session management
// Uses Supabase GoTrue REST API directly (no SDK dependency)

import { ST, saveKeys } from './state.js'
import { KEY_STORE, AUTH_ENDPOINTS } from '../config/constants.js'
import { toast } from './utils.js'
import { syncKeysToVault, pullKeysFromVault } from './key-vault.js'

// --- Session persistence ---

function _persistSession(access, refresh, user) {
  ST.authToken = access
  ST.authRefresh = refresh
  ST.authUser = user.id || ''
  ST.authEmail = user.email || ''
  localStorage.setItem(KEY_STORE.AUTH_TOKEN, access)
  localStorage.setItem(KEY_STORE.AUTH_REFRESH, refresh)
  localStorage.setItem(KEY_STORE.AUTH_USER, user.id || '')
  localStorage.setItem(KEY_STORE.AUTH_EMAIL, user.email || '')
}

function _clearSession() {
  ST.authToken = ''
  ST.authRefresh = ''
  ST.authUser = ''
  ST.authEmail = ''
  localStorage.removeItem(KEY_STORE.AUTH_TOKEN)
  localStorage.removeItem(KEY_STORE.AUTH_REFRESH)
  localStorage.removeItem(KEY_STORE.AUTH_USER)
  localStorage.removeItem(KEY_STORE.AUTH_EMAIL)
}

export function hydrateAuth() {
  ST.authToken = localStorage.getItem(KEY_STORE.AUTH_TOKEN) || ''
  ST.authRefresh = localStorage.getItem(KEY_STORE.AUTH_REFRESH) || ''
  ST.authUser = localStorage.getItem(KEY_STORE.AUTH_USER) || ''
  ST.authEmail = localStorage.getItem(KEY_STORE.AUTH_EMAIL) || ''
}

export function isLoggedIn() {
  return !!(ST.authToken && ST.authUser)
}

// --- Auth helpers ---

function _authUrl(endpoint) {
  return ST.sbUrl + endpoint
}

function _authHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: ST.sbAnon,
  }
}

function _authedHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: ST.sbAnon,
    Authorization: 'Bearer ' + ST.authToken,
  }
}

// --- Sign Up ---

export function signUp(email, password) {
  if (!ST.sbUrl || !ST.sbAnon) {
    return Promise.reject(new Error('Configure Supabase URL and Anon Key first'))
  }
  return fetch(_authUrl(AUTH_ENDPOINTS.SIGN_UP), {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify({ email: email, password: password }),
  })
    .then(function (r) {
      return r.json().then(function (data) {
        return { status: r.status, data: data }
      })
    })
    .then(function (res) {
      if (res.status >= 400) {
        throw new Error(res.data.error_description || res.data.msg || 'Sign up failed')
      }
      // Some Supabase configs require email confirmation
      if (res.data.access_token) {
        _persistSession(res.data.access_token, res.data.refresh_token, res.data.user || {})
        return { confirmed: true, user: res.data.user }
      }
      // Email confirmation required
      return { confirmed: false, user: res.data }
    })
}

// --- Sign In ---

export function signIn(email, password) {
  if (!ST.sbUrl || !ST.sbAnon) {
    return Promise.reject(new Error('Configure Supabase URL and Anon Key first'))
  }
  return fetch(_authUrl(AUTH_ENDPOINTS.SIGN_IN), {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify({ email: email, password: password }),
  })
    .then(function (r) {
      return r.json().then(function (data) {
        return { status: r.status, data: data }
      })
    })
    .then(function (res) {
      if (res.status >= 400) {
        throw new Error(res.data.error_description || res.data.msg || 'Sign in failed')
      }
      _persistSession(res.data.access_token, res.data.refresh_token, res.data.user || {})
      // Pull cloud keys after login
      return pullKeysFromVault().then(function () {
        return { user: res.data.user }
      })
    })
}

// --- Sign Out ---

export function signOut() {
  if (!ST.sbUrl || !ST.authToken) {
    _clearSession()
    return Promise.resolve()
  }
  return fetch(_authUrl(AUTH_ENDPOINTS.SIGN_OUT), {
    method: 'POST',
    headers: _authedHeaders(),
  })
    .catch(function () {})
    .then(function () {
      _clearSession()
    })
}

// --- Refresh Token ---

export function refreshSession() {
  if (!ST.sbUrl || !ST.sbAnon || !ST.authRefresh) {
    return Promise.reject(new Error('No refresh token'))
  }
  return fetch(_authUrl(AUTH_ENDPOINTS.REFRESH), {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify({ refresh_token: ST.authRefresh }),
  })
    .then(function (r) {
      return r.json().then(function (data) {
        return { status: r.status, data: data }
      })
    })
    .then(function (res) {
      if (res.status >= 400) {
        _clearSession()
        throw new Error('Session expired — please sign in again')
      }
      _persistSession(res.data.access_token, res.data.refresh_token, res.data.user || {})
      return res.data
    })
}

// --- Get Current User ---

export function getCurrentUser() {
  if (!ST.sbUrl || !ST.authToken) return Promise.resolve(null)
  return fetch(_authUrl(AUTH_ENDPOINTS.USER), {
    headers: _authedHeaders(),
  })
    .then(function (r) {
      if (!r.ok) return null
      return r.json()
    })
    .catch(function () {
      return null
    })
}

// --- Auto-refresh on startup ---

export function initAuth() {
  hydrateAuth()
  if (ST.authRefresh && ST.authToken) {
    // Check if token is still valid, refresh if needed
    getCurrentUser().then(function (user) {
      if (!user) {
        // Token expired, try refresh
        refreshSession().catch(function () {
          toast('Session expired — sign in again', 3000)
        })
      }
    })
  }
}

// --- Save keys to cloud after local save ---

export function saveKeysWithSync() {
  saveKeys()
  if (isLoggedIn()) {
    syncKeysToVault().catch(function (e) {
      console.warn('Key vault sync failed:', e.message)
    })
  }
}

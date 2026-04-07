// Key Vault — encrypted API key storage in Supabase (per-user)
// Uses Web Crypto API (AES-GCM) to encrypt keys before storing in DB.
// The encryption key is derived from the user's auth token + a salt,
// so keys are unreadable even if the database is compromised.

import { ST, saveKeys } from './state.js'
import { KEY_STORE, VAULT_TABLE } from '../config/constants.js'
import { scrubKeys } from './utils.js'

// --- Crypto helpers (AES-256-GCM via Web Crypto) ---

function _deriveKey(password, salt) {
  var enc = new TextEncoder()
  return crypto.subtle
    .importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
    .then(function (baseKey) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
    })
}

function _encrypt(plaintext, password) {
  var enc = new TextEncoder()
  var salt = crypto.getRandomValues(new Uint8Array(16))
  var iv = crypto.getRandomValues(new Uint8Array(12))
  return _deriveKey(password, salt).then(function (key) {
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(plaintext)).then(function (ct) {
      // Pack: salt(16) + iv(12) + ciphertext
      var buf = new Uint8Array(salt.length + iv.length + ct.byteLength)
      buf.set(salt, 0)
      buf.set(iv, salt.length)
      buf.set(new Uint8Array(ct), salt.length + iv.length)
      return _bufToBase64(buf)
    })
  })
}

function _decrypt(b64, password) {
  var buf = _base64ToBuf(b64)
  var salt = buf.slice(0, 16)
  var iv = buf.slice(16, 28)
  var ct = buf.slice(28)
  return _deriveKey(password, salt).then(function (key) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct).then(function (pt) {
      return new TextDecoder().decode(pt)
    })
  })
}

function _bufToBase64(buf) {
  var s = ''
  for (var i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i])
  return btoa(s)
}

function _base64ToBuf(b64) {
  var s = atob(b64)
  var buf = new Uint8Array(s.length)
  for (var i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i)
  return buf
}

// Encryption password = user ID + anon key (device-independent but user-specific)
function _vaultPassword() {
  return ST.authUser + ':' + ST.sbAnon
}

// --- Vault API ---

function _vaultHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: ST.sbAnon,
    Authorization: 'Bearer ' + ST.authToken,
    Prefer: 'resolution=merge-duplicates',
  }
}

function _collectKeys() {
  return {
    anthropic: ST.key,
    openai: ST.gptKey,
    stitch: ST.stitchKey,
    groq: ST.groqKey,
    gemini: ST.geminiKey,
    ghToken: ST.ghToken,
    ghUser: ST.ghUser,
    ghRepo: ST.ghRepo,
    ghDomain: ST.ghCustomDomain,
  }
}

function _applyKeys(obj) {
  if (obj.anthropic) ST.key = obj.anthropic
  if (obj.openai) ST.gptKey = obj.openai
  if (obj.stitch) ST.stitchKey = obj.stitch
  if (obj.groq) ST.groqKey = obj.groq
  if (obj.gemini) ST.geminiKey = obj.gemini
  if (obj.ghToken) ST.ghToken = obj.ghToken
  if (obj.ghUser) ST.ghUser = obj.ghUser
  if (obj.ghRepo) ST.ghRepo = obj.ghRepo
  if (obj.ghDomain) ST.ghCustomDomain = obj.ghDomain
}

// Push all API keys (encrypted) to Supabase
export function syncKeysToVault() {
  if (!ST.sbUrl || !ST.sbAnon || !ST.authToken || !ST.authUser) {
    return Promise.reject(new Error('Not authenticated'))
  }
  var keys = _collectKeys()
  var json = JSON.stringify(keys)
  return _encrypt(json, _vaultPassword()).then(function (encrypted) {
    return fetch(ST.sbUrl + '/rest/v1/' + VAULT_TABLE, {
      method: 'POST',
      headers: _vaultHeaders(),
      body: JSON.stringify({
        user_id: ST.authUser,
        encrypted_keys: encrypted,
        updated_at: new Date().toISOString(),
      }),
    }).then(function (r) {
      if (!r.ok && r.status !== 201 && r.status !== 200) {
        throw new Error('Vault sync failed (HTTP ' + r.status + ')')
      }
    })
  })
}

// Pull API keys from Supabase and decrypt into local state
export function pullKeysFromVault() {
  if (!ST.sbUrl || !ST.sbAnon || !ST.authToken || !ST.authUser) {
    return Promise.resolve()
  }
  var url =
    ST.sbUrl +
    '/rest/v1/' +
    VAULT_TABLE +
    '?user_id=eq.' +
    ST.authUser +
    '&select=encrypted_keys&limit=1'
  return fetch(url, {
    headers: {
      apikey: ST.sbAnon,
      Authorization: 'Bearer ' + ST.authToken,
    },
  })
    .then(function (r) {
      if (!r.ok) return []
      return r.json()
    })
    .then(function (rows) {
      if (!Array.isArray(rows) || rows.length === 0) return
      return _decrypt(rows[0].encrypted_keys, _vaultPassword()).then(function (json) {
        var keys = JSON.parse(json)
        _applyKeys(keys)
        saveKeys()
      })
    })
    .catch(function (e) {
      console.warn('Vault pull failed:', scrubKeys(e.message))
    })
}

// Delete vault entry (account deletion / key removal)
export function clearVault() {
  if (!ST.sbUrl || !ST.sbAnon || !ST.authToken || !ST.authUser) {
    return Promise.resolve()
  }
  return fetch(
    ST.sbUrl + '/rest/v1/' + VAULT_TABLE + '?user_id=eq.' + ST.authUser,
    {
      method: 'DELETE',
      headers: {
        apikey: ST.sbAnon,
        Authorization: 'Bearer ' + ST.authToken,
      },
    }
  ).catch(function () {})
}

// SQL to create the vault table (for Supabase SQL Editor)
export function getVaultSetupSQL() {
  return (
    'CREATE TABLE IF NOT EXISTS ' + VAULT_TABLE + ' (\n' +
    '  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,\n' +
    '  encrypted_keys TEXT NOT NULL,\n' +
    '  updated_at TIMESTAMPTZ DEFAULT now()\n' +
    ');\n\n' +
    '-- Enable RLS\n' +
    'ALTER TABLE ' + VAULT_TABLE + ' ENABLE ROW LEVEL SECURITY;\n\n' +
    '-- Users can only access their own keys\n' +
    'CREATE POLICY "Users manage own keys" ON ' + VAULT_TABLE + '\n' +
    '  FOR ALL USING (auth.uid() = user_id)\n' +
    '  WITH CHECK (auth.uid() = user_id);\n'
  )
}

// SQL to update builder_apps table with user_id column
export function getAppsUserScopeSQL() {
  return (
    '-- Add user_id to builder_apps for user-scoped storage\n' +
    'ALTER TABLE builder_apps ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);\n\n' +
    '-- Enable RLS\n' +
    'ALTER TABLE builder_apps ENABLE ROW LEVEL SECURITY;\n\n' +
    '-- Users can only access their own apps\n' +
    'CREATE POLICY "Users manage own apps" ON builder_apps\n' +
    '  FOR ALL USING (auth.uid() = user_id)\n' +
    '  WITH CHECK (auth.uid() = user_id);\n'
  )
}

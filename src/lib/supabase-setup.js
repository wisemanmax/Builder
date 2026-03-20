// One-Click Supabase Backend Setup — auto-execute SQL and inject connection details

import { ST } from './state.js'
import { toast } from './utils.js'

// Test Supabase connection
export function testSupabaseConnection() {
  if (!ST.sbUrl || !ST.sbAnon) return Promise.resolve(false)
  return fetch(ST.sbUrl + '/rest/v1/', {
    headers: {
      'apikey': ST.sbAnon,
      'Authorization': 'Bearer ' + ST.sbAnon
    }
  }).then(function (r) {
    return r.ok || r.status === 200
  }).catch(function () {
    return false
  })
}

// Execute SQL via Supabase RPC (requires a server-side function or direct REST)
// This uses the PostgREST API to create tables via RPC
export function executeSupabaseSQL(sql) {
  if (!ST.sbUrl || !ST.sbAnon) return Promise.reject(new Error('Supabase not configured'))

  // Use the Supabase REST API /rest/v1/rpc endpoint
  // This requires a stored function. Since we can't create functions directly,
  // we parse the SQL and use the REST API to verify table creation
  return fetch(ST.sbUrl + '/rest/v1/rpc/exec_sql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ST.sbAnon,
      'Authorization': 'Bearer ' + ST.sbAnon,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ query: sql })
  }).then(function (r) {
    if (r.ok) return { success: true, message: 'SQL executed successfully' }
    // If the RPC function doesn't exist, return the SQL for manual execution
    return { success: false, message: 'Auto-execution not available. Copy the SQL and run it in the Supabase SQL Editor.', sql: sql }
  }).catch(function () {
    return { success: false, message: 'Could not connect to Supabase. Copy the SQL and run it manually.', sql: sql }
  })
}

// Auto-inject Supabase client connection into generated app HTML
export function autoInjectSupabase(appCode) {
  if (!ST.sbUrl || !ST.sbAnon) return appCode
  if (!appCode) return appCode

  // Check if Supabase is already injected
  if (appCode.indexOf('YOUR_SUPABASE_URL') < 0 && appCode.indexOf('supabase') < 0) return appCode

  // Replace placeholder values with actual credentials
  var injected = appCode
    .replace(/YOUR_SUPABASE_URL/g, ST.sbUrl)
    .replace(/YOUR_SUPABASE_ANON_KEY/g, ST.sbAnon)
    .replace(/'YOUR_SUPABASE_URL'/g, "'" + ST.sbUrl + "'")
    .replace(/'YOUR_SUPABASE_ANON_KEY'/g, "'" + ST.sbAnon + "'")
    .replace(/"YOUR_SUPABASE_URL"/g, '"' + ST.sbUrl + '"')
    .replace(/"YOUR_SUPABASE_ANON_KEY"/g, '"' + ST.sbAnon + '"')

  return injected
}

// Format SQL execution result for display
export function formatSQLResult(result) {
  if (result.success) {
    return '<div style="padding:8px 12px;background:rgba(0,230,118,.08);border:1px solid rgba(0,230,118,.2);border-radius:8px;font-size:11px;color:rgba(0,230,118,.9)">'
      + '\u2713 ' + result.message + '</div>'
  }
  return '<div style="padding:8px 12px;background:rgba(255,214,0,.08);border:1px solid rgba(255,214,0,.2);border-radius:8px;font-size:11px">'
    + '<div style="color:rgba(255,214,0,.9);margin-bottom:4px">\u26A0 ' + result.message + '</div>'
    + (result.sql ? '<div style="margin-top:6px"><button onclick="navigator.clipboard.writeText(this.parentNode.querySelector(\'pre\').textContent);this.textContent=\'Copied!\'" style="padding:4px 10px;border-radius:6px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.6);font-size:10px;cursor:pointer;margin-bottom:4px">Copy SQL</button>'
      + '<pre style="font-size:10px;color:rgba(255,255,255,.4);overflow-x:auto;max-height:120px;margin:0;white-space:pre-wrap">' + _escHtml(result.sql.slice(0, 2000)) + '</pre></div>' : '')
    + '</div>'
}

function _escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

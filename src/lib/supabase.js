// Supabase singleton client — used for auth, storage, and data sync
import { createClient } from '@supabase/supabase-js'

var _supabase = null

export function getSupabase() {
  if (_supabase) return _supabase

  var url = import.meta.env.VITE_SUPABASE_URL || ''
  var anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

  if (!url || !anonKey) return null

  _supabase = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storage: localStorage,
      storageKey: 'bldr_sb_auth',
    },
  })
  return _supabase
}

export function getSupabaseUrl() {
  return import.meta.env.VITE_SUPABASE_URL || ''
}

import { ST, persist } from './state.js'
import { scrubKeys, toast } from './utils.js'
import { renderGrid, renderGridSkeleton } from '../components/app-icon.js'
import { getSupabase } from './supabase.js'

// Push a single app to Supabase (upsert)
export function pushToSupabase(app) {
  var sb = getSupabase()
  if (!sb || !ST.userId || !app || !app.id) return Promise.resolve()

  var payload = {
    id: app.id,
    user_id: ST.userId,
    name: app.name,
    icon: app.icon,
    color_index: app.ci,
    description: app.desc,
    code: app.code,
    prompts: app.prompts || [],
    gh_pushed: app.ghPushed || false,
    published: app.published || false,
    slug: app.slug || null,
    created_at: app.createdAt,
    updated_at: app.updatedAt || new Date().toISOString(),
  }

  return sb
    .from('builder_apps')
    .upsert(payload, { onConflict: 'id' })
    .then(function (result) {
      if (result.error) console.warn('Supabase push failed:', scrubKeys(result.error.message))
    })
    .catch(function (e) {
      console.warn('Supabase push failed:', scrubKeys(e.message))
    })
}

// Pull all apps for the current user from Supabase
export function pullFromSupabase() {
  var sb = getSupabase()
  if (!sb || !ST.userId) {
    toast('Not signed in')
    return Promise.resolve()
  }

  renderGridSkeleton(6)
  return sb
    .from('builder_apps')
    .select('*')
    .order('created_at', { ascending: false })
    .then(function (result) {
      if (result.error) throw new Error(result.error.message)
      var data = result.data || []
      var ids = {}
      data.forEach(function (a) {
        ids[a.id] = true
      })
      var mapped = data.map(function (d) {
        return {
          id: d.id,
          name: d.name,
          icon: d.icon,
          ci: d.color_index,
          desc: d.description,
          code: d.code,
          versions: [],
          prompts: d.prompts || [],
          ghPushed: d.gh_pushed || false,
          published: d.published || false,
          slug: d.slug || null,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        }
      })
      ST.apps = mapped.concat(
        ST.apps.filter(function (a) {
          return !ids[a.id]
        })
      )
      persist()
      renderGrid()
      toast('Pulled ' + data.length + ' apps')
    })
    .catch(function (e) {
      renderGrid()
      toast('Pull failed: ' + scrubKeys(e.message), 4000)
    })
}

// Delete an app from Supabase
export function deleteFromSupabase(appId) {
  var sb = getSupabase()
  if (!sb || !ST.userId || !appId) return Promise.resolve()

  return sb
    .from('builder_apps')
    .delete()
    .eq('id', appId)
    .then(function (result) {
      if (result.error) console.warn('Supabase delete failed:', scrubKeys(result.error.message))
    })
    .catch(function (e) {
      console.warn('Supabase delete failed:', scrubKeys(e.message))
    })
}

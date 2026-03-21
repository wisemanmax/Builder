import { ST, persist } from './state.js'
import { scrubKeys, toast } from './utils.js'
import { renderGrid, renderGridSkeleton } from '../components/app-icon.js'

export function pushToSupabase(app) {
  if (!ST.sbEnabled || !ST.sbUrl || !ST.sbAnon || !app || !app.id) return
  var safePayload = {
    id: app.id,
    name: app.name,
    icon: app.icon,
    color_index: app.ci,
    description: app.desc,
    code: app.code,
    prompts: app.prompts || [],
    gh_pushed: app.ghPushed || false,
    created_at: app.createdAt,
    updated_at: app.updatedAt,
  }
  fetch(ST.sbUrl + '/rest/v1/builder_apps', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ST.sbAnon,
      Authorization: 'Bearer ' + ST.sbAnon,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(safePayload),
  }).catch(function (e) {
    console.warn('Supabase push failed:', scrubKeys(e.message))
  })
}

export function pullFromSupabase() {
  if (!ST.sbUrl || !ST.sbAnon) {
    toast('No Supabase credentials')
    return
  }
  renderGridSkeleton(6)
  fetch(ST.sbUrl + '/rest/v1/builder_apps?select=*&order=created_at.desc', {
    headers: { apikey: ST.sbAnon, Authorization: 'Bearer ' + ST.sbAnon },
  })
    .then(function (r) {
      return r.json()
    })
    .then(function (data) {
      if (!Array.isArray(data)) throw new Error('Bad response')
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
      toast('Pulled ' + data.length + ' apps \u2601\uFE0F')
    })
    .catch(function (e) {
      renderGrid()
      toast('Pull failed: ' + scrubKeys(e.message), 4000)
    })
}

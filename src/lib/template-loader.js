// Lazy-fetch template skeletons from external HTML files with in-memory cache
var _cache = {}

/**
 * Fetch a template skeleton HTML by id.
 * Files live at ./templates/{id}.html (served from public/).
 * Returns a Promise resolving to the HTML string.
 */
export function getTemplateSkeleton(id) {
  if (_cache[id]) return Promise.resolve(_cache[id])
  return fetch('./templates/' + id + '.html')
    .then(function (res) {
      if (!res.ok) throw new Error('Template not found: ' + id)
      return res.text()
    })
    .then(function (html) {
      _cache[id] = html
      return html
    })
}

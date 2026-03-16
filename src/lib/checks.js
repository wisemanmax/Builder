export function runLocalChecks(code) {
  var results = []
  function add(cat, id, label, passed, detail) { results.push({ cat: cat, id: id, label: label, passed: passed, detail: detail || '' }) }
  if (!code || code.length > 500000) { add('Syntax', 'size-guard', 'File size check', false, 'File too large'); return results }
  try {
    add('Syntax', 'doctype', 'DOCTYPE declaration', /<!DOCTYPE/i.test(code.slice(0, 300)))
    add('Syntax', 'html-tag', '<html> element present', /<html[\s>]/i.test(code))
    add('Syntax', 'viewport', 'Viewport meta tag', /<meta[^>]{1,200}viewport/i.test(code))
    add('Syntax', 'charset', 'Charset meta tag', /<meta[^>]{1,200}charset/i.test(code))
    var sizeKB = Math.round(new TextEncoder().encode(code).length / 1024)
    add('Performance', 'file-size', 'File size: ' + sizeKB + 'KB', sizeKB < 600, sizeKB + 'KB')
    add('Accessibility', 'lang', 'html[lang] attribute', /<html[^>]{0,300}lang\s*=/i.test(code))
    add('Security', 'no-eval', 'No eval() usage', !/\beval\s*\(/.test(code))
    add('Security', 'no-docwrite', 'No document.write()', !/document\.write\s*\(/.test(code))
  } catch (e) {
    add('Syntax', 'check-error', 'Check engine error', false, String(e.message || '').slice(0, 80))
  }
  return results
}

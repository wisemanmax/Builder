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

    // New checks
    add('Accessibility', 'button-text', 'Buttons have text content',
      !/<button[^>]*>\s*<\/button>/i.test(code), 'Empty button elements found')
    add('Accessibility', 'no-div-onclick', 'No <div onclick> patterns',
      !/<div[^>]+onclick\s*=/i.test(code), 'Use <button> instead of <div onclick>')
    add('Structure', 'has-title', 'Has <title> element',
      /<title>[^<]+<\/title>/i.test(code))
    add('Structure', 'has-main', 'Uses semantic <main> element',
      /<main[\s>]/i.test(code))
    add('Security', 'no-innerhtml-xss', 'No innerHTML with concatenation',
      !(/\.innerHTML\s*=\s*[^'"<]/.test(code) && /\.innerHTML\s*=\s*.*\+/.test(code)),
      'innerHTML with concatenation may indicate XSS risk')
    add('Design', 'has-css-vars', 'Uses CSS custom properties',
      /--[\w-]+\s*:/.test(code), 'CSS variables enable consistent theming')
    add('Design', 'responsive', 'Has responsive CSS',
      /@media/.test(code) || /max-width\s*:\s*100%/.test(code),
      'No media queries or responsive patterns detected')
  } catch (e) {
    add('Syntax', 'check-error', 'Check engine error', false, String(e.message || '').slice(0, 80))
  }
  return results
}

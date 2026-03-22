export function runLocalChecks(code) {
  var results = []
  function add(cat, id, label, passed, detail) {
    results.push({ cat: cat, id: id, label: label, passed: passed, detail: detail || '' })
  }
  if (!code || code.length > 500000) {
    add('Syntax', 'size-guard', 'File size check', false, 'File too large')
    return results
  }
  try {
    // --- Syntax ---
    add('Syntax', 'doctype', 'DOCTYPE declaration', /<!DOCTYPE/i.test(code.slice(0, 300)))
    add('Syntax', 'html-tag', '<html> element present', /<html[\s>]/i.test(code))
    add('Syntax', 'viewport', 'Viewport meta tag', /<meta[^>]{1,200}viewport/i.test(code))
    add('Syntax', 'charset', 'Charset meta tag', /<meta[^>]{1,200}charset/i.test(code))

    // --- Performance ---
    var sizeKB = Math.round(new TextEncoder().encode(code).length / 1024)
    add('Performance', 'file-size', 'File size: ' + sizeKB + 'KB', sizeKB < 600, sizeKB + 'KB')

    // --- Accessibility ---
    add('Accessibility', 'lang', 'html[lang] attribute', /<html[^>]{0,300}lang\s*=/i.test(code))
    add(
      'Accessibility',
      'button-text',
      'Buttons have text content',
      !/<button[^>]*>\s*<\/button>/i.test(code),
      'Empty button elements found'
    )
    add(
      'Accessibility',
      'no-div-onclick',
      'No <div onclick> patterns',
      !/<div[^>]+onclick\s*=/i.test(code),
      'Use <button> instead of <div onclick>'
    )
    add(
      'Accessibility',
      'img-alt',
      'Images have alt attributes',
      !/<img(?![^>]*alt\s*=)[^>]*>/i.test(code),
      'All <img> elements should have alt attributes for screen readers'
    )
    add(
      'Accessibility',
      'has-aria-or-roles',
      'Uses ARIA labels or roles',
      /(?:aria-label|aria-labelledby|aria-describedby|role\s*=)/i.test(code),
      'Consider adding ARIA attributes for interactive elements'
    )
    add(
      'Accessibility',
      'has-focus-styles',
      'Has focus indicator styles',
      /:focus/.test(code) || /focus-visible/.test(code),
      'Add :focus or :focus-visible styles for keyboard navigation'
    )

    // --- Security ---
    add('Security', 'no-eval', 'No eval() usage', !/\beval\s*\(/.test(code))
    add('Security', 'no-docwrite', 'No document.write()', !/document\.write\s*\(/.test(code))
    add(
      'Security',
      'no-innerhtml-xss',
      'No innerHTML with concatenation',
      !(/\.innerHTML\s*=\s*[^'"<]/.test(code) && /\.innerHTML\s*=\s*.*\+/.test(code)),
      'innerHTML with concatenation may indicate XSS risk'
    )
    add(
      'Security',
      'no-inline-event-handlers',
      'No inline JS event handlers in body',
      !/<(?:div|span|p|a|img|td|tr)[^>]+on(?:click|load|error|mouseover)\s*=/i.test(code),
      'Use addEventListener instead of inline event handlers for better CSP compatibility'
    )

    // --- Structure ---
    add('Structure', 'has-title', 'Has <title> element', /<title>[^<]+<\/title>/i.test(code))
    add('Structure', 'has-main', 'Uses semantic <main> element', /<main[\s>]/i.test(code))

    // --- Design & Theming ---
    add(
      'Design',
      'has-css-vars',
      'Uses CSS custom properties',
      /--[\w-]+\s*:/.test(code),
      'CSS variables enable consistent theming'
    )

    // --- PWA Readiness ---
    add(
      'PWA',
      'has-theme-color',
      'Has theme-color meta tag',
      /<meta[^>]*name\s*=\s*["']theme-color["'][^>]*>/i.test(code),
      'Add <meta name="theme-color"> for mobile browser theming'
    )
    add(
      'PWA',
      'has-mobile-web-app',
      'Mobile web app capable',
      /<meta[^>]*apple-mobile-web-app-capable/i.test(code),
      'Add apple-mobile-web-app-capable for iOS home screen support'
    )

    // --- Responsive Design (Enterprise Quality) ---
    var hasMediaQueries = /@media/.test(code)
    var mediaQueryCount = (code.match(/@media/g) || []).length
    add(
      'Responsive',
      'has-media-queries',
      'Has media queries',
      hasMediaQueries,
      'No media queries found — app will not adapt to different screen sizes'
    )
    add(
      'Responsive',
      'multiple-breakpoints',
      'Has multiple breakpoints (' + mediaQueryCount + ' found)',
      mediaQueryCount >= 2,
      'Need at least 2 breakpoints for mobile/tablet/desktop adaptation'
    )
    add(
      'Responsive',
      'has-mobile-breakpoint',
      'Has mobile/tablet breakpoint',
      /(@media[^{]*max-width\s*:\s*(4[0-9]{2}|5[0-9]{2}|6[0-9]{2}|7[0-9]{2}|8[0-4][0-9])px)|(@media[^{]*min-width\s*:\s*(3[2-9][0-9]|4[0-9]{2}|5[0-9]{2}|6[0-9]{2}|7[0-9]{2})px)/.test(
        code
      ),
      'No breakpoint found for mobile/tablet range (320-849px)'
    )
    add(
      'Responsive',
      'no-fixed-widths',
      'No problematic fixed widths',
      !/width\s*:\s*(5[0-9]{2}|[6-9][0-9]{2}|[1-9][0-9]{3,})px(?!\s*;[^}]*max-width)/.test(code),
      'Fixed widths over 500px found — these may break on mobile devices'
    )
    add(
      'Responsive',
      'uses-flex-or-grid',
      'Uses Flexbox or Grid layout',
      /display\s*:\s*(flex|grid)/.test(code),
      'No flex/grid layouts found — layout may not adapt well'
    )
    add(
      'Responsive',
      'responsive-containers',
      'Containers use relative sizing',
      /max-width\s*:/.test(code) && /(width\s*:\s*100%|margin\s*:\s*0?\s*auto)/.test(code),
      'Containers should use max-width + width:100% or margin:auto for responsive centering'
    )
    add(
      'Responsive',
      'responsive-typography',
      'Uses fluid or responsive typography',
      /clamp\(/.test(code) || /(font-size\s*:.*vw)/.test(code) || (hasMediaQueries && /font-size/.test(code)),
      'Consider using clamp() or media queries for responsive font sizes'
    )
    add(
      'Responsive',
      'touch-friendly-inputs',
      'Inputs are touch-friendly',
      !/input[^{]*\{[^}]*height\s*:\s*([12][0-9]|3[0-9])px/.test(code),
      'Input heights under 40px are hard to tap on mobile — use 44px minimum'
    )
  } catch (e) {
    add('Syntax', 'check-error', 'Check engine error', false, String(e.message || '').slice(0, 80))
  }
  return results
}

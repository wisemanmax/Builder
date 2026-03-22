// Shared design token maps for theme/accent resolution.
// Used by template-loader.js and profile-context.js.

export var THEME_MAP = {
  dark: {
    bg: '#0a0a1a',
    surface: '#12122a',
    text: '#e8e8f0',
    text2: 'rgba(255,255,255,.55)',
    border: 'rgba(255,255,255,.08)',
  },
  light: { bg: '#f5f5f7', surface: '#ffffff', text: '#1a1a2e', text2: 'rgba(0,0,0,.55)', border: 'rgba(0,0,0,.08)' },
  midnight: {
    bg: '#0d1117',
    surface: '#161b22',
    text: '#e6edf3',
    text2: 'rgba(255,255,255,.5)',
    border: 'rgba(255,255,255,.1)',
  },
  warm: {
    bg: '#1a1412',
    surface: '#241e1a',
    text: '#f0e8e0',
    text2: 'rgba(255,255,255,.5)',
    border: 'rgba(255,255,255,.08)',
  },
  cool: {
    bg: '#0a1a2a',
    surface: '#122a3a',
    text: '#e0e8f0',
    text2: 'rgba(224,232,240,.55)',
    border: 'rgba(224,232,240,.08)',
  },
}

export var ACCENT_MAP = {
  blue: '#3D5AFE',
  indigo: '#3D5AFE',
  teal: '#00BFA5',
  cyan: '#00E5FF',
  green: '#00E676',
  emerald: '#00E676',
  purple: '#B44FFF',
  violet: '#B44FFF',
  pink: '#FF3CAC',
  magenta: '#FF3CAC',
  red: '#FF5252',
  orange: '#FF9F43',
  amber: '#FFD600',
  yellow: '#FFD600',
  coral: '#FF6D00',
}

/**
 * Resolve a theme name (possibly fuzzy) to a set of CSS variable values.
 * Returns null if no match.
 */
export function resolveThemeVars(themeName) {
  var name = (themeName || '').toLowerCase()
  if (THEME_MAP[name]) return THEME_MAP[name]
  var keys = Object.keys(THEME_MAP)
  for (var i = 0; i < keys.length; i++) {
    if (name.indexOf(keys[i]) >= 0) return THEME_MAP[keys[i]]
  }
  return null
}

/**
 * Resolve a color name (possibly fuzzy) to a hex code.
 * Returns null if no match. Passes through hex values as-is.
 */
export function resolveAccentColor(colorName) {
  var name = (colorName || '').toLowerCase().trim()
  if (ACCENT_MAP[name]) return ACCENT_MAP[name]
  if (/^#[0-9a-f]{3,8}$/i.test(name)) return name
  var keys = Object.keys(ACCENT_MAP)
  for (var i = 0; i < keys.length; i++) {
    if (name.indexOf(keys[i]) >= 0) return ACCENT_MAP[keys[i]]
  }
  return null
}

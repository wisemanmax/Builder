import { defineConfig } from 'vite'

// Inline CSS into <style> tag in HTML (matches original monolithic behavior)
function inlineCssPlugin() {
  return {
    name: 'inline-css',
    enforce: 'post',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        // Find all CSS assets from the bundle
        const cssAssets = []
        if (ctx.bundle) {
          for (const [, asset] of Object.entries(ctx.bundle)) {
            if (asset.type === 'asset' && asset.fileName.endsWith('.css')) {
              cssAssets.push(asset.source)
            }
          }
        }
        if (!cssAssets.length) return html
        // Build inline <style> tag
        const styleTag = '<style>' + cssAssets.join('') + '</style>'
        // Remove <link rel="stylesheet"> tags that reference our assets
        html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="\.\/assets\/[^"]*\.css"[^>]*>/g, '')
        // Insert <style> before </head>
        html = html.replace('</head>', styleTag + '\n</head>')
        return html
      },
    },
    generateBundle(_, bundle) {
      // Remove CSS files from the bundle (they're now inlined)
      for (const [key, asset] of Object.entries(bundle)) {
        if (asset.type === 'asset' && key.endsWith('.css')) {
          delete bundle[key]
        }
      }
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [inlineCssPlugin()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Disable CSS code splitting — bundle all CSS together
    cssCodeSplit: false,
    modulePreload: false,
  },
  server: {
    port: 3000,
    open: false,
  },
})

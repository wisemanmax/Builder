import { defineConfig } from 'vite'
import { readFileSync, unlinkSync } from 'fs'
import { resolve } from 'path'

/**
 * Vite plugin: inline all CSS into <style> tags in the HTML.
 * Eliminates external stylesheet requests — no CORS issues, no FOUC.
 * Matches how the original monolithic index.html delivered CSS.
 */
function inlineCssPlugin() {
  return {
    name: 'inline-css',
    enforce: 'post',
    generateBundle(_, bundle) {
      // Collect all CSS assets
      const cssAssets = []
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (fileName.endsWith('.css') && asset.type === 'asset') {
          cssAssets.push({ fileName, source: asset.source })
        }
      }
      if (cssAssets.length === 0) return

      // Find the HTML file and inject CSS as <style> tags
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (fileName.endsWith('.html') && asset.type === 'asset') {
          let html = typeof asset.source === 'string'
            ? asset.source
            : new TextDecoder().decode(asset.source)

          // Build the inline <style> block
          const inlineStyles = cssAssets
            .map(css => `<style>${css.source}</style>`)
            .join('\n')

          // Remove <link rel="stylesheet"> tags that reference the bundled CSS
          for (const css of cssAssets) {
            const linkPattern = new RegExp(
              `<link[^>]+href=["'][^"']*${css.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
              'g'
            )
            html = html.replace(linkPattern, '')
          }

          // Inject styles right before </head>
          html = html.replace('</head>', `${inlineStyles}\n</head>`)

          asset.source = html

          // Remove the external CSS files from the bundle
          for (const css of cssAssets) {
            delete bundle[css.fileName]
          }
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
  },
  server: {
    port: 3000,
    open: false,
  },
})

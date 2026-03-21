# CLAUDE.md — Development Guide for The Builder

## Project Overview
AI-powered PWA that automates web app development using Claude and GPT-4o, deploying to GitHub Pages. Vanilla JS (ES6 modules), no framework, built with Vite. Single-page app with overlay-based navigation.

## Quick Start
```
npm install
npm run dev     # Starts on http://localhost:3000
```

## Architecture
```
src/
  lib/          Core libraries (AI calls, GitHub API, state, utils, checks)
  screens/      UI screens (build, home, settings, studio, think, login, etc.)
  components/   Reusable UI (messages, context menu, emoji picker, approval cards)
  pipelines/    Build pipelines (standard, website, stitch, quick-edit)
  config/       Constants, AI prompts, templates
  styles/       Modular CSS (base, components, chat, pipeline, desktop)
  mie/          Market Intelligence Engine sub-app
public/         Static assets, PWA manifest, service worker, templates
apps/           Generated app HTML outputs + manifest.json index
```

## Key Patterns

- **State:** Global `ST` object in `src/lib/state.js`, persisted to localStorage
- **DOM:** `$(id)` helper for `getElementById`. `esc()` / `escAttr()` for HTML escaping
- **AI calls:** All go through `src/lib/ai.js` with retry logic and prompt caching
- **Key guard:** `src/lib/key-guard.js` overrides `window.fetch` to block API keys being sent to non-approved domains
- **IDs:** Generated via `uid()` in `utils.js` using `crypto.randomUUID()`
- **Pipelines:** Each pipeline file exports a `runXxxPipeline()` function
- **Quality checks:** `src/lib/checks.js` runs 30+ automated checks (syntax, a11y, security, performance, responsive)

## Coding Conventions

- No semicolons
- `var` over `let`/`const` (legacy style, maintained for consistency)
- `function` declarations, not arrow functions
- Global functions exposed on `window` for `onclick` handlers in `index.html`
- All API keys stored in localStorage only — never in code or committed to git

## Scripts
```
npm run dev       # Vite dev server (port 3000)
npm run build     # Production build to dist/
npm run preview   # Preview production build
npm run lint      # ESLint check
npm run lint:fix  # ESLint auto-fix
npm run format    # Prettier format
npm run check     # Lint + format check
```

## Security Notes

- `key-guard.js` overrides `window.fetch` to block API keys being sent to non-approved domains
- `esc()` and `escAttr()` in `utils.js` for HTML escaping
- CSP headers defined in `index.html` `<meta>` tag
- `scrubKeys()` removes API keys from error messages before logging

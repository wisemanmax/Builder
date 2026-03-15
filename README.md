# ⚡ The Builder

An AI-powered PWA that builds, audits, fixes, and deploys web apps — all from a chat interface. Built with Claude + GPT-4o + GitHub Pages.

---

## How it works

```
Your prompt
  ↓
Claude builds the app on a new branch
  ↓
Automated checks (lint, a11y, links, security, perf)
  ↓
GPT-4o audits as secondary reviewer
  ↓
Claude applies all fixes in one pass
  ↓
Branch pushed to GitHub
  ↓
Live preview renders in chat
  ↓
You approve (or request changes)
  ↓
Branch merges to main
  ↓
GitHub Pages deploys automatically
```

---

## Repo Structure

```
/
├── index.html          ← The Builder PWA (the entire app)
├── apps/
│   ├── manifest.json   ← Auto-updated index of all your built apps
│   └── {app-id}.html   ← Each app Claude builds lands here
└── README.md
```

---

## Setup (5 steps)

### 1. Create this repo on GitHub

- Go to [github.com/new](https://github.com/new)
- Name it whatever you want (e.g. `my-builder-apps`)
- Set to **Public** (required for free GitHub Pages)
- Do **not** add a README — you'll push these files directly

### 2. Push these files

```bash
cd the-builder-repo
git init
git add .
git commit -m "Initial commit — The Builder PWA"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 3. Enable GitHub Pages

- Go to your repo → **Settings** → **Pages**
- Source: **Deploy from a branch**
- Branch: `main` / `/ (root)`
- Click **Save**

Your app will be live at:
`https://YOUR_USERNAME.github.io/YOUR_REPO/`

### 4. Create a Personal Access Token

- Go to [github.com/settings/tokens/new](https://github.com/settings/tokens/new)
- Token name: `The Builder`
- Expiration: your choice (90 days recommended)
- Scopes: check **`repo`** (full control of private repositories)
- Click **Generate token** — copy it immediately

### 5. Open The Builder and enter your keys

Navigate to your GitHub Pages URL, then on the onboarding screen enter:

| Field | Value |
|-------|-------|
| Anthropic API Key | `sk-ant-...` — get from [console.anthropic.com](https://console.anthropic.com) |
| OpenAI API Key | `sk-...` — optional, enables GPT-4o audit step |
| GitHub Token | The token you just created |
| GitHub Username | Your GitHub username |
| Repository Name | The repo name you created |

---

## Using The Builder

1. Tap **✦ Build** in the dock
2. Describe any app you want (or tap a quick-start chip)
3. Watch the 9-step pipeline run in real time:
   - 🌿 Branch created
   - 🔨 Claude writes the app
   - 📋 14 automated checks run
   - 🔍 GPT-4o audits the code
   - 🛠 Claude fixes all issues
   - ⬆️ Code pushed to branch
   - 👁 Live preview appears in chat
   - ✅ **You approve or request changes**
   - 🔀 Merges to main → GitHub Pages deploys
4. App icon appears on your home screen
5. To update any app: tap its icon → long press → Edit, or tap **✦ Build** and describe changes

---

## PWA Install

**iPhone / Safari:**
Safari → Share button → "Add to Home Screen"

**Android / Chrome:**
Banner appears automatically, or Chrome menu → "Add to Home Screen"

---

## Keys are stored locally

All API keys are stored in your browser's `localStorage` only — they are never sent anywhere except directly to the respective APIs (Anthropic, OpenAI, GitHub). No backend, no tracking.

---

## Troubleshooting

**GitHub branch creation fails**
→ Check your token has `repo` scope and the repo exists

**Claude returns unexpected response**
→ Check your Anthropic API key is valid and has credits

**Merge conflict error**
→ The branch has diverged from main. Delete the branch on GitHub and try again.

**Apps don't show after merge**
→ GitHub Pages takes 30–90 seconds to deploy. Refresh after a minute.

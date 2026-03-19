# Google Stitch API — Integration Review for Builder

**Date:** 2026-03-19
**Scope:** Evaluate how Google Stitch's API can improve Builder's build pipeline and UI generation quality.

---

## 1. What is Google Stitch?

Google Stitch (from Google Labs) is an AI-powered UI design tool that generates production-ready frontend code from natural language prompts. It uses Gemini models under the hood and exports clean HTML/CSS.

- **Web app:** https://stitch.withgoogle.com
- **SDK:** `@google/stitch-sdk` ([GitHub](https://github.com/google-labs-code/stitch-sdk))
- **API endpoint:** `https://stitch.googleapis.com/mcp`
- **Free tier:** 400 generations/month
- **Auth:** API key from Stitch Settings → stored as `STITCH_API_KEY`

### Core SDK API

```js
import { stitch } from "@google/stitch-sdk";

const project = stitch.project("project-id");
const screen  = await project.generate("A dashboard with charts", "DESKTOP");
const html    = await screen.getHtml();   // download URL
const image   = await screen.getImage();  // screenshot URL

// Edit existing screens
const edited  = await screen.edit("Add dark mode sidebar");

// Generate variants
const variants = await screen.variants("Try different layouts", {
  variantCount: 3,
  creativeRange: "EXPLORE",       // REFINE | EXPLORE | REIMAGINE
  aspects: ["COLOR_SCHEME", "LAYOUT"]
});
```

**Device types:** `MOBILE`, `DESKTOP`, `TABLET`, `AGNOSTIC`

### MCP / Tool Client (for agent workflows)

```js
import { StitchToolClient } from "@google/stitch-sdk";
const client = new StitchToolClient({ apiKey: "..." });
await client.callTool("create_project", { title: "My App" });
await client.callTool("generate_screen_from_text", { prompt: "..." });
await client.close();
```

---

## 2. Current Builder Architecture (Relevant Parts)

| Layer | Current State |
|-------|--------------|
| **AI providers** | Claude (primary), GPT-4o (audit/review) |
| **UI generation** | Claude generates full HTML/CSS/JS in a single pass |
| **Build pipeline** | Plan → Build → Checks → Audit → Fix → Enhance → Deploy |
| **Key management** | localStorage only, key-guard validates outbound domains |
| **Approved domains** | `api.anthropic.com`, `api.openai.com`, `api.github.com` |
| **Pipeline modes** | builder1 (full), builder2 (claude-only), builder3 (component), builder4 (recon) |

### Key Integration Points

- **`src/lib/ai.js`** — All API calls. New Stitch calls go here.
- **`src/lib/key-guard.js`** — Must whitelist `stitch.googleapis.com`.
- **`src/lib/state.js`** / **`src/config/constants.js`** — Add Stitch key to `KEY_STORE` and `ST`.
- **`src/screens/settings.js`** — Add Stitch API key input field.
- **`src/pipelines/`** — Insert Stitch steps into build orchestration.

---

## 3. Integration Opportunities

### 3A. UI Design Pre-Generation (Highest Impact)

**Problem:** Claude generates both logic and visual design in one pass. UI quality depends entirely on prompt engineering and the LLM's design sense.

**Solution:** Use Stitch to generate the visual scaffold first, then have Claude integrate logic and interactivity.

**Proposed pipeline change:**

```
Current:  Plan → Claude Build (code + design) → Checks → ...
Proposed: Plan → Stitch UI (visual scaffold) → Claude Build (logic + integration) → Checks → ...
```

**How it works:**
1. After the Plan step extracts app requirements, call `project.generate()` with the UI description
2. Fetch the HTML from `screen.getHtml()`
3. Feed that HTML into Claude's Build prompt as a starting scaffold
4. Claude adds JS logic, event handlers, data management, and refines the markup

**Benefits:**
- Stitch is purpose-built for visual design (Gemini multimodal + design training)
- Claude focuses on what it's best at: logic, architecture, interactivity
- Better visual quality without sacrificing functional quality
- Screenshots from `screen.getImage()` can be shown in the build UI for previewing

### 3B. Design Variants for User Choice

**Problem:** Users get one design and must iterate via text feedback to change look-and-feel.

**Solution:** Before building, generate 2-3 Stitch variants and let the user pick.

```js
const variants = await screen.variants(planDescription, {
  variantCount: 3,
  creativeRange: "EXPLORE",
  aspects: ["COLOR_SCHEME", "LAYOUT", "IMAGES"]
});
// Show variant screenshots in Builder UI for selection
```

This would add a new pipeline step: **"Stitch · Design Options"** between Plan and Build.

### 3C. Post-Build UI Polish

**Problem:** After Claude builds the app, the automated checks cover lint, a11y, links, security, and performance — but not visual design quality.

**Solution:** Use Stitch's `screen.edit()` to polish the final HTML:
1. After Claude generates the app HTML, send it to Stitch with a refinement prompt
2. Stitch improves spacing, typography, color harmony, and responsiveness
3. Claude then re-integrates any JS logic that was stripped

**Trade-off:** Adds latency. Best offered as an optional "Design Polish" toggle.

### 3D. Component-Level Generation (Pipeline 3 Enhancement)

Builder's Pipeline 3 (`builder3`) already decomposes apps into components:

```
Decompose → Scaffold → Design Tokens → Data Layer → Shared Components →
Feature Components → Layout Components → Pages → Routing → Docs
```

Stitch can generate individual component screens. For each component step, generate the component UI via Stitch, then have Claude wire up the logic. This pairs naturally with the existing component pipeline.

---

## 4. Implementation Plan

### Phase 1: Foundation (Key Management + API Client)

**`src/config/constants.js`** — Add to KEY_STORE:
```js
STITCH: 'bldr_stitchKey',
STITCH_ON: 'bldr_stitchOn',
```

**`src/lib/state.js`** — Add to ST:
```js
stitchKey: '',
stitchEnabled: false,
```

Update `hydrate()`, `saveKeys()`, `keyStatusHTML()`.

**`src/lib/key-guard.js`** — Add to approved domains:
```js
'stitch.googleapis.com'
```

**`src/lib/stitch.js`** (new) — Lightweight client:
```js
import { ST } from './state.js'
import { fetchWithRetry, classifyFetchError } from './ai.js'
import { _validateKeyedRequest } from './key-guard.js'

var STITCH_BASE = 'https://stitch.googleapis.com'

export function callStitchGenerate(prompt, deviceType) {
  deviceType = deviceType || 'DESKTOP'
  if (!ST.stitchKey) throw new Error('Stitch API key not configured')

  return fetchWithRetry(STITCH_BASE + '/v1/screens:generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + ST.stitchKey
    },
    body: JSON.stringify({ prompt: prompt, deviceType: deviceType })
  }, 120000).then(function (r) {
    if (!r.ok) return r.json().catch(function () { return {} })
      .then(function (e) { throw new Error('Stitch: ' + (e.error || 'HTTP ' + r.status)) })
    return r.json()
  }).then(function (d) {
    // Returns { htmlUrl, screenshotUrl, screenId }
    return d
  }).catch(function (e) {
    if (e.message && e.message.indexOf('Stitch:') === 0) throw e
    throw new Error(classifyFetchError(e, 'Stitch'))
  })
}

export function fetchStitchHtml(htmlUrl) {
  return fetch(htmlUrl).then(function (r) {
    if (!r.ok) throw new Error('Failed to fetch Stitch HTML')
    return r.text()
  })
}
```

> **Note:** The exact REST API shape above is illustrative. The actual integration should use the `@google/stitch-sdk` npm package or reverse the MCP tool calls from the SDK source. The SDK handles project creation, screen generation, and HTML/screenshot retrieval through the `stitch.googleapis.com/mcp` endpoint.

**`src/screens/settings.js`** — Add Stitch section with API key input and enable toggle.

### Phase 2: Pipeline Integration

Add an optional **"Stitch · Design"** step to pipelines 1, 2, and 4:
- After Plan completes, if `ST.stitchEnabled`, call Stitch to generate UI scaffold
- Pass scaffold HTML into Claude's Build prompt as context
- Show Stitch screenshot in the build message stream

**`src/config/constants.js`** — Update PIPE_NAMES/PIPE_ICONS:
```js
// Insert after 'Claude · Plan':
'Stitch · Design',   // with icon 🎨
```

### Phase 3: Design Variants UI

- After Stitch generates the initial design, offer "See Variants" button
- Generate 2-3 variants with different creative ranges
- Display variant screenshots in a horizontal carousel
- User picks one, which becomes the scaffold for Claude Build

### Phase 4: Post-Build Polish (Optional)

- Add "Stitch · Polish" toggle in settings
- After Claude Build + Checks, optionally send HTML through Stitch edit
- Re-integrate any JS logic Claude added

---

## 5. Key Considerations

### Cost & Quotas
- Free tier: 400 generations/month — sufficient for moderate usage
- Each "variant" call with `variantCount: 3` consumes 3 generations
- **Recommendation:** Track Stitch usage alongside existing token cost tracking in `src/lib/cost.js`

### Latency
- Stitch generation takes ~5-15 seconds per screen
- Adding Stitch to the pipeline adds one API round-trip
- Mitigated by running Stitch generation in parallel with other prep work

### Security
- Stitch API key follows the same localStorage-only pattern as other keys
- Key-guard must whitelist `stitch.googleapis.com` to prevent blocked requests
- API key is never sent to Claude, GPT, or GitHub — only to Google's endpoint

### Browser Compatibility
- The `@google/stitch-sdk` uses ES modules and requires Node.js for the MCP server
- **For Builder (browser PWA):** Use direct REST API calls to `stitch.googleapis.com` rather than the SDK, since the SDK bundles MCP transport code that requires Node.js
- Alternatively, vendor a minimal browser-compatible wrapper from the SDK source

### Limitations
- Stitch generates static HTML/CSS — no JavaScript logic, no state management
- Complex multi-page apps need multiple `generate()` calls (one per screen)
- Generated HTML may use different class naming conventions than Builder's existing output
- Edit/refine workflows require keeping track of `screenId` state

---

## 6. Summary

| Integration | Impact | Effort | Priority |
|------------|--------|--------|----------|
| UI pre-generation scaffold | High — better visual quality | Medium | P0 |
| Key management + client | Foundation | Low | P0 |
| Design variants for user choice | High — better UX | Medium | P1 |
| Component-level generation (Pipeline 3) | Medium — targeted improvement | Medium | P2 |
| Post-build polish | Low-Medium — incremental quality | High | P3 |

**Recommended starting point:** Phase 1 (foundation) + Phase 2 (pipeline integration) for pipelines 1 and 2. This delivers the highest-impact improvement — better visual design quality — with minimal architectural disruption.

---

## Sources

- [Google Stitch App](https://stitch.withgoogle.com/)
- [Stitch SDK on GitHub](https://github.com/google-labs-code/stitch-sdk)
- [Google Developers Blog — Stitch Introduction](https://developers.googleblog.com/stitch-a-new-way-to-design-uis/)
- [Official Google Blog — Stitch AI UI Design](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/)
- [Google Stitch Complete Guide 2026](https://almcorp.com/blog/google-stitch-complete-guide-ai-ui-design-tool-2026/)
- [NxCode — Google Stitch Guide](https://www.nxcode.io/resources/news/google-stitch-complete-guide-vibe-design-2026)

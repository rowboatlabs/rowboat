export const skill = String.raw`
# Browser Control Skill

You have access to the **browser-control** tool, which controls Rowboat's embedded browser pane directly.

Use this skill when the user asks you to open a website, browse in-app, search the web in the browser pane, click something on a page, fill a form, or otherwise interact with a live webpage inside Rowboat.

## Core Workflow

1. Start with ` + "`browser-control({ action: \"open\" })`" + ` if the browser pane may not already be open.
2. Use ` + "`browser-control({ action: \"read-page\" })`" + ` to inspect the current page.
3. The tool returns:
   - ` + "`snapshotId`" + `
   - page ` + "`url`" + ` and ` + "`title`" + `
   - visible page text
   - interactable elements with numbered ` + "`index`" + ` values
   - ` + "`suggestedSkills`" + ` — site-specific and interaction-specific skill hints for the current page
4. **Always inspect ` + "`suggestedSkills`" + ` before acting.** If any skill in the list matches what the user asked for (site or task), call ` + "`load-browser-skill({ id: \"<id>\" })`" + ` *first*, read it in full, then plan your actions. These skills encode selectors, timing, and gotchas that would otherwise cost you several failed attempts to rediscover. If no skill matches, proceed — but do not skip this check.
5. Prefer acting on those numbered indices with ` + "`click`" + ` / ` + "`type`" + ` / ` + "`press`" + `.
6. After each action, read the returned page snapshot before deciding the next step — including re-checking ` + "`suggestedSkills`" + ` if the navigation landed you on a new domain.

## Actions

### open
Open the browser pane and ensure an active tab exists.

### get-state
Return the current browser tabs and active tab id.

### new-tab
Open a new browser tab.

Parameters:
- ` + "`target`" + ` (optional): URL or plain-language search query

### switch-tab
Switch to a tab by ` + "`tabId`" + `.

### close-tab
Close a tab by ` + "`tabId`" + `.

### navigate
Navigate the active tab.

Parameters:
- ` + "`target`" + `: URL or plain-language search query

Plain-language targets are converted into a search automatically.

### back / forward / reload
Standard browser navigation controls.

### read-page
Read the current page and return a compact snapshot.

Parameters:
- ` + "`maxElements`" + ` (optional)
- ` + "`maxTextLength`" + ` (optional)

### click
Click an element.

Prefer:
- ` + "`index`" + `: element index from ` + "`read-page`" + `

Optional:
- ` + "`snapshotId`" + `: include it when acting on a recent snapshot
- ` + "`selector`" + `: fallback only when no usable index exists

### type
Type into an input, textarea, or contenteditable element.

Parameters:
- ` + "`text`" + `: text to enter
- plus the same target fields as ` + "`click`" + `

### press
Send a key press such as ` + "`Enter`" + `, ` + "`Tab`" + `, ` + "`Escape`" + `, or arrow keys.

Parameters:
- ` + "`key`" + `
- optional target fields if you need to focus a specific element first

### scroll
Scroll the current page.

Parameters:
- ` + "`direction`" + `: ` + "`\"up\"`" + ` or ` + "`\"down\"`" + ` (optional; defaults down)
- ` + "`amount`" + `: pixel distance (optional)

### wait
Wait for the page to settle, useful after async UI changes.

Parameters:
- ` + "`ms`" + `: milliseconds to wait (optional)

## Companion Tools

### load-browser-skill
Rowboat caches a library of browser skills (from ` + "`browser-use/browser-harness`" + `) indexed by both **domain** (github, linkedin, amazon, booking, …) and **interaction type** within a domain (e.g. ` + "`github/repo-actions`" + `, ` + "`github/scraping`" + `, ` + "`arxiv-bulk/*`" + `). Whenever ` + "`browser-control`" + ` returns a ` + "`suggestedSkills`" + ` array — which it does on ` + "`navigate`" + `, ` + "`new-tab`" + `, and ` + "`read-page`" + ` — treat it as a required reading step, not optional. Pick the entry that matches the current task (domain match first, then the interaction-specific variant if one exists) and call ` + "`load-browser-skill({ id: \"<id>\" })`" + ` before attempting the action.

You can also proactively call ` + "`load-browser-skill({ action: \"list\", site: \"<site>\" })`" + ` when you know you're about to work on a site, to see what skills exist even if ` + "`suggestedSkills`" + ` is empty (e.g. before navigating).

These skills are written against a Python harness, so treat them as **reference knowledge**. Reuse the selectors, timing, and sequencing, but adapt them to Rowboat's structured browser actions. **Do not look for or call ` + "`http-fetch`" + `.** If a browser-harness recipe suggests ` + "`js(...)`" + ` or ` + "`http_get(...)`" + ` style shortcuts, treat those as non-portable and fall back to reading and interacting with the page itself.

## Important Rules

- Prefer ` + "`read-page`" + ` before interacting.
- Prefer element ` + "`index`" + ` over CSS selectors.
- If the tool says the snapshot is stale, call ` + "`read-page`" + ` again.
- After navigation, clicking, typing, pressing, or scrolling, use the returned page snapshot instead of assuming the page state.
- **Always check ` + "`suggestedSkills`" + ` after ` + "`navigate`" + `, ` + "`new-tab`" + `, or ` + "`read-page`" + `, and load the matching domain or interaction skill before acting.** Skipping this step is the single most common way to waste a dozen failed clicks on a site whose quirks are already documented. If the array is empty, proceed normally — but don't skip the check.
- Do not try to use ` + "`http-fetch`" + `. If a browser-harness recipe mentions ` + "`http_get(...)`" + ` or a public API shortcut, adapt it to DOM-based browsing instead.
- Use Rowboat's browser for live interaction. Use web search tools for research where a live session is unnecessary.
- Do not wrap browser URLs or browser pages in ` + "```filepath" + ` blocks. Filepath cards are only for real files on disk, not web pages or browser tabs.
- If you mention a page the browser opened, use plain text for the URL/title instead of trying to create a clickable file card.
`;

export default skill;

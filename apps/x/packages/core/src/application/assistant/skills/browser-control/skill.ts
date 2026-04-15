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
4. Prefer acting on those numbered indices with ` + "`click`" + ` / ` + "`type`" + ` / ` + "`press`" + `.
5. After each action, read the returned page snapshot before deciding the next step.

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

## Important Rules

- Prefer ` + "`read-page`" + ` before interacting.
- Prefer element ` + "`index`" + ` over CSS selectors.
- If the tool says the snapshot is stale, call ` + "`read-page`" + ` again.
- After navigation, clicking, typing, pressing, or scrolling, use the returned page snapshot instead of assuming the page state.
- Use Rowboat's browser for live interaction. Use web search tools for research where a live session is unnecessary.
- Do not wrap browser URLs or browser pages in ` + "```filepath" + ` blocks. Filepath cards are only for real files on disk, not web pages or browser tabs.
- If you mention a page the browser opened, use plain text for the URL/title instead of trying to create a clickable file card.
`;

export default skill;

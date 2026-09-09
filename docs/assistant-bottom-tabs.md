# Assistant bottom tabs

The sidebar remains the default. Use **Undock chat** in the chat header to move a conversation into a floating panel; **Dock chat** puts it back in the sidebar. There is no longer a presentation toggle in Settings. Existing bottom-tab preferences migrate automatically.

- The sidebar's **Assistant** destination always opens the full-screen assistant, preserving the current conversation or draft regardless of floating-panel preferences.
- A full-screen or maximized conversation is omitted from the bottom dock while it owns the main view. Other conversations remain accessible; its tab returns when leaving full-screen mode. An otherwise empty dock is hidden.
- The chat selector and **New chat** inside a panel replace that panel's conversation without changing its position or size. The bottom dock's **+** still opens an additional panel. Selecting a conversation already open elsewhere focuses its existing panel rather than duplicating it. Switching does not stop running work.

- Multiple conversations can stay expanded side by side. Click a bottom tab to expand or minimize that conversation independently. Excess tabs appear under **More chats**.
- Floating panels do not resize ordinary workspace views. Drag the top edge for height, left edge for width, or top-left corner for both. Focus a resize handle and use arrow keys (Shift for larger steps); double-click a handle to reset its size. Text-editing shortcuts remain untouched.
- Panels fit the available viewport. Older panels fold when space runs out and return as space becomes available; the focused panel takes priority. A docked sidebar reserves its actual width, so floating chats can remain beside it. Expand temporarily for a full-width conversation.
- Escape or the minimize button tucks the panel away. Outside clicks leave it open. Completion never steals focus; tabs indicate working, unread replies, and requests for input.
- Close silently removes a tab, not the saved conversation, and does not stop work. Reopen saved conversations from history. Use Stop in the conversation to stop a task.
- Cmd/Ctrl+L toggles the panel while viewing another section. Cmd/Ctrl+N creates a new conversation.
- Open tabs, the active tab, draft text, expanded panels, docking and per-panel dimensions are restored locally. Attachments remain available across presentation changes within the same app session; staged attachments are not restored after an app restart.
- Sidebar, full-width and floating presentations reuse the same mounted composers and transcripts. Session subscriptions are shared; minimized transcripts stop rendering streaming deltas but their stores stay live. Reopening uses the current in-memory snapshot, not another history fetch.
- Expand/minimize uses short opacity/transform animations, with immediate inertness on minimize and respect for reduced-motion preferences.

## Native surfaces

Code keeps its primary chat layout. The dock is hidden there. The embedded browser is an Electron native view above renderer content: it uses a side-by-side chat and reserves room for the bottom tabs instead of hiding the page behind an overlay.

## Verification

Run the renderer tests for `assistant-panel-layout`, `assistant-panels`, `assistant-dock`, `assistant-chat-dock`, `chat-sidebar`, `useSessionChat`, and `session-chat/store`.

For desktop QA, check email, files, Apps, Code, and the embedded browser at narrow and wide window sizes. Start work in two chats; minimize and switch while streaming; stop or answer a permission request in one and verify that the other continues. Check drafts, attachments, model selection, queues, dictation ownership, focus, tab overflow, display zoom, reduced motion, rapid toggles, pointer cancellation, docking and full-width restoration.

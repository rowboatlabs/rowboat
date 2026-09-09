# Assistant bottom tabs

Enable **Settings → Appearance → Assistant presentation → Bottom tabs**. Sidebar remains the default; its placement and size preferences are preserved.

- Open several assistant conversations; click a bottom tab to expand it, or click the expanded tab again to minimize. Only one panel expands at a time. Excess tabs appear under **More chats**.
- The floating panel does not resize ordinary workspace views. Resize using its corner, or Alt + arrow keys while focused inside the panel. Expand for a full-width conversation.
- Escape or the minimize button tucks the panel away. Outside clicks leave it open. Completion never steals focus; tabs indicate working, unread replies, and requests for input.
- Close silently removes a tab, not the saved conversation, and does not stop work. Reopen saved conversations from history. Use Stop in the conversation to stop a task.
- Cmd/Ctrl+L toggles the panel while viewing another section. Cmd/Ctrl+N creates a new conversation.
- Open tabs, the active tab, draft text, and floating dimensions are restored locally. Attachments remain available across presentation changes within the same app session; staged attachments are not restored after an app restart.

## Native surfaces

Code keeps its primary chat layout. The dock is hidden there. The embedded browser is an Electron native view above renderer content: it uses a side-by-side chat and reserves room for the bottom tabs instead of hiding the page behind an overlay.

## Verification

Run the renderer tests for `assistant-dock`, `assistant-chat-dock`, `chat-sidebar`, `useSessionChat`, and `session-chat/store`.

For desktop QA, check email, files, Apps, Code, and the embedded browser at narrow and wide window sizes. Start work in two chats; minimize and switch while streaming; stop or answer a permission request in one and verify that the other continues. Check drafts, attachments, model selection, queues, focus, tab overflow, display zoom, and switching back to Sidebar.

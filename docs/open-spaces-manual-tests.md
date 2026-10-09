# Open spaces: desktop manual tests

These cases cover the desktop UI for Harbor open spaces. Product rules are owned by
[Harbor spec §5](../apps/harbor/SPEC.md#5-the-space); interaction conventions are in
[the Spaces design language](spaces-design-language.md). Record execution results,
build, platform, evidence, and blockers in the PR discussion rather than this document.

## Setup

- Use a disposable team on Harbor containing the open-space APIs from PR #1121.
- Use two accounts: A creates and belongs to the spaces; B belongs to the team but
  initially belongs to neither test space. Keep A and B open in separate sessions.
- As A, create an open space named `QA Open` and a private space named `QA Private`.
  Put distinct messages, a thread/discussion, reactions, a poll, a Markdown file with
  a checkbox, an attachment, a file with two versions, and a whiteboard in QA Open.
- Run P0 cases through both Electron's in-process transport and the server-backed
  transport. Use actual app configurations; the UI should behave the same in both.
- For side-effect checks, inspect client IPC and Harbor HTTP/WebSocket traffic in
  addition to the visible UI. Reads, live subscription, and reconnect are permitted;
  presence, whiteboard sends, read marks, follows, and content writes are not permitted
  while B previews. A's session provides an independent check of roster and content.
- Never use production spaces for leave, fault-injection, or mutation checks. Where
  a test needs a server condition or membership change absent from the UI, have an
  engineer perform it through the existing Harbor API in the disposable team.

## P0: main flows and access boundaries

| ID | Steps | Expected result |
| --- | --- | --- |
| OS-01 Discovery | As B, open the team's Browse spaces page. Search for `qa OPEN`, then an unmatched string, then clear search. | QA Open is listed, QA Private is absent. Search ignores case; no-results copy is distinct from an empty directory. Rows are alphabetically ordered. |
| OS-02 Preview does not join | Click QA Open. Open its stream, thread, discussion list, and roster; wait at least 60 seconds. | Preview banner and Join buttons are visible. Messages remain readable. B is absent from the space roster and joined-space sidebar; no new unread badge, follows, notifications, or Activity rows are created for B by preview traffic. |
| OS-03 Readable content | As B in preview, search within QA Open; open attachments and files, view history and a diff, and download a file. | Existing content, reactions, poll results, roster, search results, history, and diffs can be read. Downloads work. No join is performed. |
| OS-04 Chat is read-only | Try message hover actions and context menus, reactions, poll answers, Follow, discussion rename/archive, and keyboard shortcuts. | Posting/reply composers are replaced by Join prompts. Member-only actions are absent or disabled and do not invoke write APIs. Navigation, copy links, and reading remain usable. |
| OS-05 Files are read-only | Try Edit, checkbox toggling, rename/move, delete, version restore, upload, drag/drop, and Save to space files on an attachment. | No file/attachment mutation can be submitted. No upload or propose request is emitted. The stored file and its version remain unchanged in A's session. |
| OS-06 Whiteboard preview | Open the board as B. Try drawing and moving elements; keep it open for 60 seconds, switch away, and close it. While B is watching, draw and save as A. | B uses view mode and receives updates. B emits no cursor, scene, scene-request, idle, upload, or snapshot-save messages, including during initial hydration and cleanup. |
| OS-07 Explicit join | From an open thread or file in B's preview, click Join space repeatedly while the request is pending. | One in-flight join request. Successful join enables member controls and adds the space to B's sidebar and roster without changing the selected thread/file. Posting and reactions then work normally. |
| OS-08 Join failure and retry | In a disposable environment, make join fail with a server read-only response or disconnect B before clicking Join. Restore the condition and retry. | Failure is visible; B remains in preview with no optimistic membership or enabled composer. Retrying succeeds and does not duplicate the sidebar entry or membership. |
| OS-09 Create visibility | As A, open New space. Create one without changing visibility, then another with Open selected. Browse as B. | Default creation is private and absent from B's directory. The open space is discoverable. A becomes a member of each created space. Names and visibility indicators match the server response. |
| OS-10 Deep links and history | As B before joining, open links to QA Open, one message/reply, and one file. Navigate back/forward and restart the app on the preview. Also try a link to QA Private. | Readable links resolve to the requested content without joining or redirecting to an unrelated joined space. Navigation restores the destination. The private link reveals no private content and offers an understandable unavailable/access message. |
| OS-11 Live preview and reconnect | While B previews, post as A. Disconnect B; post again as A; reconnect B. Navigate away from the preview afterward. | Content catches up without duplicates. Preview never gains unread state or membership. Its live subscription is released when no visible preview needs it. Joined-space background subscriptions continue. |
| OS-12 Membership removal | Join QA Open as B. Open it in B's desktop session, then leave through another B session/API. Repeat while viewing a board and with a read mark pending. | Controls become read-only promptly, personal read state is cleared, and queued member-only writes are stopped. The open space remains readable after access revalidation and an explicit resubscription. It disappears from the joined-space sidebar. |
| OS-13 Private membership loss | Add B to QA Private using the existing invite flow. Open it as B, then end B's membership through a second session/API. | The space is removed from joined navigation and becomes unavailable. It is never inserted into the open-space directory or rendered as an open preview. |
| OS-14 Existing member regression | As a member, post/reply/react/vote, edit a file, draw on a board, and open a DM and notes to self. Check read marks and notifications with A/B. | Existing joined private/open spaces and direct conversations retain normal actions, read state, presence, and live delivery. Browse does not expose DMs. |

## P1: recovery and usability

| ID | Steps | Expected result |
| --- | --- | --- |
| OS-15 Empty and unreachable team | Use a team with no joined spaces, then one with no open spaces. Make the browse request fail and use Retry. | Browse remains reachable without a joined space. Empty and error states are distinct; retry recovers without changing teams or joining anything. |
| OS-16 Older Harbor | Connect to a server without `/v1/spaces/browse`; open Browse and New space. Separately test an authentication or network error. | Missing endpoint explains that a server update is needed and disables Open creation; private creation still works. Auth/network failures are not misclassified as unsupported. |
| OS-17 Concurrent membership | Preview as B on two clients. Join on one and observe the other. Exercise both orderings of the join response and `space_added` event with controlled request delay. | Both clients converge on one membership and sidebar entry. A stale directory response cannot revert confirmed membership or reset the selected content. |
| OS-18 Drafts and delayed work | Start a message/file draft while joined. For an Auto delayed send, begin its hold. End membership from another session before submitting or before the timer fires. Reopen the preview. | Retained drafts, callbacks, dialogs, and timer cleanup do not send member-only operations. Preview does not mount a composer or replay pending sends. |
| OS-19 Team switching and rename | Delay a browse response, switch teams, then release it. In a live preview, rename the open space as another member. | Results remain scoped to their team. The preview and directory eventually show the renamed space without losing its identity or content target. |
| OS-20 Keyboard and layout | Tab through Browse, search, rows, Join, and the creation dialog. Use Enter/Escape; repeat in light/dark themes and a narrow desktop window. | Controls have understandable accessible names and visible focus. Dialog dismissal works. Preview status and Join remain usable; content does not overlap or become unreachable. |

## Evidence to attach to the PR

For each executed case, record its ID, build/commit, OS, transport, account roles,
steps/variant, expected versus observed outcome, and Pass/Fail/Blocked. Attach
screenshots or short recordings for UI failures and sanitized request/frame traces
for preview-side-effect or reconnect failures. Do not include tokens or private team
content. A generated case is not evidence of an executed test.

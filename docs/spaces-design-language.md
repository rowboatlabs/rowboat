# Spaces design language

## Design analysis

Spaces should feel like a shared conversation with work attached. People, messages, and reply relationships establish the primary hierarchy. Files, agent execution, and named discussions extend that conversation. Repeated content uses alignment and spacing; borders distinguish regions, controls, and exceptional content.

This analysis uses Slack's public product documentation, design-team explanations, and published interface imagery. The public help pages describe current behavior; the design essays describe historical decisions and are not evidence of every detail in today's application. The inspected four-theme product image is useful for relative anatomy, but is scaled marketing imagery. No authenticated live reference session was available. All pixel values below are deliberate Spaces specifications, not claims of measured or officially published reference tokens.

### Message anatomy and density

The reference offers a default Clean layout with profile photos and a Compact layout that removes those photos and reduces whitespace. This makes density an explicit reading preference rather than an accidental consequence of shrinking every element. Spaces adopts the avatar-based layout: identity matters when people and agents participate together. [1]

The published interface image shows a stable avatar gutter, a name and quiet timestamp above the body, small reactions under the text, and an inline reply summary. Message text has no surrounding speech bubble. The text column also anchors continuation messages and reply links. The result supports scanning a changing roster of senders without forcing each message into an isolated card. [2]

Spaces already used 15 px text with 22 px leading in the main stream. The inconsistencies were around it: thread replies had smaller avatars, the thread root was a tinted card with smaller text, and stacked container padding obscured the true gutter. The implementation keeps the readable body size and normalizes the surrounding geometry. Thread roots use the same visual identity and text scale as replies.

### Actions and reactions

The reference's message-action affordance provides an explicit place to begin a thread. Its design history explains why clicking message content to open threads caused unintended navigation. Spaces retains explicit Reply/Open controls rather than making the entire message clickable. [3]

The reference places reaction entry on message hover, highlights the viewer's own reactions in blue, allows toggling by clicking again, and exposes who reacted. Spaces already supported the relevant data and handlers. The redesign makes the pills reliably sized and adds pressed state and a descriptive accessible name. Reaction entry remains visible beside existing reactions, while other actions reveal on hover or keyboard focus. [4]

Previously, the action bar used `display: none` until hover. A keyboard user could not tab to its contents. Messages with actions are now focusable; focusing the row reveals the bar, and focus within keeps it visible. An open picker or menu also keeps the toolbar present. Touch pointers get a persistent action row with reserved space below the message.

### Replies and threads

The reference's thread design converged on one level of replies separated from the channel. Earlier nested designs became difficult to follow, and copying all replies into the channel made the main timeline harder to read. The resulting structure treats a thread as a separate conversation rooted in an existing message. [3]

Current product documentation describes threads as discussions around specific messages, with a separate view for threads a person participates in. This supports the direct fit for Spaces' existing root-message thread model; it does not require changing its storage protocol. [5]

Spaces previously replaced Messages when a thread opened. The redesign keeps Messages visible on the left and opens the thread on the right when the conversation region has at least 840 px available. The thread defaults to 400 px and can be resized using its divider, with a 360 px minimum; the timeline retains at least 440 px plus a 6 px divider. Width preferences persist across sessions, and the effective width is clamped when the window narrows. The divider supports arrow keys (10 px, or 40 px with Shift), Home/End for the limits, and double-click to reset. The thread header also offers Expand thread to make it the primary conversation surface, and Show alongside Messages to restore the split and saved width. This view preference persists across sessions; changing it keeps the thread and composer mounted. Root messages and replies share the same Markdown typography, including heading-size limits. Below that threshold, the thread occupies the conversation region and offers Back to messages. Opening a file retains the existing chat/document split instead of creating three cramped content columns.

The main stream remains mounted across these transitions. Its existing scroll restoration and draft persistence are retained. A resize observer measures the actual content region, accounting for the resizable navigation rail. Both visible conversations retain their appropriate presence/read behavior, but global profile-mention inserts have a single destination: the open thread.

### Navigation, hierarchy, and color

The reference's visual-language essay explicitly treats information density as a constraint while changing surfaces, borders, depth, and theme customization. That supports a restrained adaptation: improve region hierarchy while keeping Rowboat's existing light/dark theme and agent affordances. [2]

Spaces uses a quiet navigation surface, compact discussion rows, and a blue-tinted selected destination. Section labels use sentence case instead of small tracked capitals. The space header establishes identity and search; aligned pane headers identify Messages and Thread/Discussion. Supporting detail can truncate while essential actions retain their target size.

A separate global app rail, huddles, workspace theming controls, a new cross-space thread inbox, and reply broadcasting are not introduced. Those require broader product decisions or behavior beyond a visual redesign. Files, boards, named discussions, agent execution, and permissions retain their existing roles.

## Component mapping

| Reference pattern | Existing Spaces fit | Implemented adaptation |
| --- | --- | --- |
| Avatar-based conversation | `MessageRow` and continuation grouping | One 36 px avatar/gutter size in both timelines; 15/22 px body text |
| Quiet message metadata | Sender, timestamp, agent attribution | Bold sender, secondary timestamp, wrapping attribution |
| Message action bar | Reaction, Reply/Open, Ask agent, More | 32 px controls, 18 px glyphs, keyboard reveal, persistent open state |
| Emoji reaction pill | Reaction groups and self membership | 28 px pill, 16 px emoji, 12 px count, pressed semantics |
| Inline thread summary | Root reply count and latest activity | Compact wrapping link, blue reply count, explicit last-reply label |
| Context-preserving thread pane | `ThreadPane` | Right pane on wide layouts, full conversation region on narrow layouts |
| Root followed by reply divider | Existing root card and reply list | Plain message-style root and quiet count divider |
| Bounded composition area | Shared rich-text composer | 8 px corners, thin border, subtle formatting strip, rectangular send control |
| Sectioned navigation | Chat/discussion and file rail | Consistent 32 px discussion rows and selected-state tint |
| Theme-aware surfaces | Existing application color variables | Scoped semantic styles reuse light and dark colors |

The root message exposes reply counts and last-reply time, but the stream's summary does not provide a reliable roster of replying members. Participant avatars are therefore not fabricated or inferred from working agents. They can be added when the summary carries real participant data.

## Geometry and typography

| Element | Spaces specification | Reason |
| --- | --- | --- |
| Base spacing | 4 px rhythm | Predictable spacing across repeated controls |
| Space header | 56 px minimum height; 20 px horizontal inset | Clear identity and comfortable search/control alignment |
| Pane header | 48 px minimum height; 16 px inset | Messages and thread headings align |
| Message avatar | 36 × 36 px, 6 px corners | Recognizable identity without dominating the message |
| Avatar-to-content gap | 12 px | Stable reading column |
| Message inset | 20 px desktop; 12 px narrow viewport | Full-width hover surface with a consistent text origin |
| New author row | 8 px above, 4 px below | Separates speaking turns |
| Continuation row | 2 px above and below | Groups consecutive messages without duplicate identity |
| Message body | 15 px / 22 px | Comfortable long-form chat reading |
| Sender | 15 px bold / 22 px | Primary scan anchor |
| Timestamp and metadata | 12 px, secondary color | Supporting information stays subordinate |
| Action target | 32 × 32 px; labeled reply at least 32 px high | Consistent pointer and keyboard target |
| Action icon | 18 × 18 px | Visually balanced within the target |
| Reaction | At least 28 px high, 40 px wide, 8 px horizontal padding | Comfortable hit area around emoji and count |
| Reaction emoji/count | 16 px / 12 px | Emoji first, count second |
| Reaction gaps | 4 px | Compact grouped responses |
| Reply link | At least 28 px high, 12 px text | Lightweight but explicit navigation |
| Date separator | 13 px semibold pill, 16 px upper spacing | Strong time landmarks without boxing messages |
| Composer | 8 px corner radius, 1 px border | A bounded writing area with restrained decoration |
| Composer text | 15 px / 22 px, minimum 56 px body | Drafts resemble posted messages |
| Composer dock | 12 px above, 16 px sides/below | Separation from the stream and window edge |
| Discussion navigation | 32 px high; 13 px title | Dense, readable destinations |
| Thread split | Resizable; 400 px default, 360 px minimum, 6 px divider at ≥840 px content width | Retains a usable 440 px timeline |

The implementation's semantic stylesheet is `apps/x/apps/renderer/src/styles/spaces.css`. Components retain utility classes for local flex layout and content-specific states. Theme colors come from existing application variables: foreground/background, secondary text, borders, raised surfaces, link blue, mention wash, and attention color. No reference-product identifiers are needed in feature code.

## Interaction rules

1. Reading does not navigate. Only the reply summary or an explicit thread action opens a thread.
2. The thread begins with its original message, followed by a reply-count separator and a flat chronological reply list.
3. Existing reaction chips toggle membership. Selected styling and `aria-pressed` agree; the accessible label includes the reaction, count, and reactors.
4. Message actions remain available while focus is inside the message or an associated menu is open. A focus ring identifies keyboard targets.
5. Composer formatting, attachment, scheduling, and agent controls retain their existing commands. The redesign changes presentation, not send semantics.
6. Main-stream and thread drafts remain separate. Profile-mention insertion targets one composer even when both are visible.
7. Agent status remains secondary to human content, while Stop, Chat, and permission-review affordances remain reachable.
8. Narrow layouts prioritize the active conversation. Document viewing retains the existing two-column model.
9. Motion communicates state briefly; reduced-motion preferences disable the new toolbar and frame transitions.

## Verification and limitations

The production Vite bundle builds successfully. Nine focused suites pass all 120 tests, covering presentation, formatting, mentions, conventions, the rich-text editor, message actions, thread resizing, inline editing, and message markdown. Renderer typechecking passes after rebuilding the protocol and shared declarations. `git diff --check` passes.

The resize tests cover dragging and bounds, keyboard interaction, and resetting within the available width. Message-row tests cover reaction membership/toggling, focusable actions, explicit thread navigation, and unconfirmed-message protection.

Review should cover populated light and dark themes, long names and thread titles, code blocks, images, many reactions, optimistic sends, deleted roots, active agents, and thread/document transitions. Keyboard review should include entering a message's action bar, opening a reaction picker, toggling a reaction, and closing a thread. Resize review should include a wide rail and a narrow window, since viewport width alone is insufficient.

The available automation environment has no connected browser for live application screenshots. Production compilation and automated behavior checks can establish build and interaction confidence, but do not substitute for visual sign-off in the running desktop application. Published reference images were inspected directly; they were not used to claim exact current CSS measurements.

## Sources

1. Slack Help Center. [Change how messages are displayed](https://slack.com/help/articles/213893898-Change-how-messages-are-displayed). Accessed September 9, 2026. Clean/Compact behavior. Locale versions returned differing font-customization copy, so no font-customization claim is used here.
2. Chris Delbuck, Gleb Denisov, and Matt Spiel, Slack Design. [A new visual language for Slack](https://slack.design/articles/a-new-visual-language-for-slack/). 2023. Includes the [four-theme interface image](https://slack.design/wp-content/uploads/sites/8/2023/10/image-11.png). Used for visual anatomy and the density-preservation principle, not current measured tokens.
3. Hubert Florin, Slack Design. [Threads in Slack, a long design journey, part 2](https://slack.design/articles/threads-in-slack-a-long-design-journey-part-2-of-2/). Historical design retrospective. Used for explicit message actions and the rationale for flat sidebar conversations.
4. Slack Help Center. [Use emoji and reactions](https://slack.com/help/articles/202931348-Use-emoji-and-reactions). Accessed September 9, 2026. Reaction entry, self-reaction highlight, toggle behavior, and reactor disclosure.
5. Slack Help Center. [Use threads to organize discussions](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions). Accessed September 9, 2026. Rooted discussions and thread navigation.

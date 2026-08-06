# Wispr Flow Notetaker to Rowboat knowledge

## Product boundary

Wispr Flow owns the live meeting: detection, audio capture, live transcript,
speaker UI, and its post-call processing. Rowboat does not mirror the live
transcript and does not start a second recording automatically.

Rowboat owns the durable knowledge experience after Wispr finalizes a meeting.
The integration uses Wispr's OAuth-protected MCP connector; it never reads or
replays Wispr desktop session tokens, Keychain entries, private APIs, or local
application databases.

## User journey

1. Connect **Wispr Flow** once in Rowboat Settings. Authorization opens in the
   browser using PKCE and dynamic client registration.
2. Join a meeting normally. Wispr shows the live Notetaker experience. The
   connector does not start or stop either recorder and does not change
   Rowboat's own meeting-detection prompts.
3. End the meeting. Wispr produces the title, My thoughts, summary, participant
   metadata, action items, and transcript.
4. Rowboat checks Wispr every 90 seconds. Once the artifact has a post-call
   finalization signal, it writes an idempotent note under:

   ```text
   ~/.rowboat/knowledge/Meetings/wispr-flow/YYYY/MM/DD/<title>--<id>.md
   ```

5. The note is a normal Rowboat knowledge source. The existing graph builder,
   note extraction, search, backlinks, meeting-note events, background tasks,
   and agents can use it exactly like Granola, Fireflies, and native Rowboat
   meeting notes.

## Markdown contract

The imported file has stable frontmatter (`type: meeting`, `source:
wispr-flow`, external meeting ID, title, date, participants) and these content
sections when Wispr exposes them:

- `## My thoughts`
- `## Summary`
- `## Action items`
- `## Transcript`

Transcript utterances are grouped into speaker turns instead of creating one
line for every partial phrase.

## Sync semantics

- Connecting the provider records existing finalized meetings as a baseline;
  it does not silently backfill the user's history.
- A meeting still in progress is not baselined. It imports after Wispr adds
  its post-call summary/thoughts and transcript.
- Writes are atomic and keyed by Wispr meeting ID. A later Wispr edit updates
  the same note, even if the title changes. Sections already imported are
  preserved when an eventually-consistent response temporarily omits them;
  the `meeting.notes_ready` event fires only on the first import.
- If Wispr changes its MCP tool names or response shape, sync fails visibly in
  logs and leaves local knowledge untouched instead of guessing.

## Contributor test path

Install dependencies and start the normal desktop development app:

```sh
cd apps/x
pnpm install --frozen-lockfile
pnpm dev
```

Connect Wispr Flow in Settings, finish a new meeting, and wait up to 90 seconds.
Verify that one note appears under `knowledge/Meetings/wispr-flow/`, that its
transcript block expands, and that identified speaker names appear in the
`participants` property. Existing meetings at connection time are deliberately
recorded as a baseline rather than backfilled.

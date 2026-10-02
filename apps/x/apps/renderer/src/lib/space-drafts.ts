import type { spaces } from '@x/shared'

/** An edit begun on a space file and not yet applied: the text, the version it was begun against, and the note that will go in history. */
export interface SpaceDraft {
  baseVersion: number
  text: string
  reason: string
  conflict: Extract<spaces.ProposeChangeResult, { outcome: 'conflict' }> | null
}

type FileRef = { orgId: string; spaceId: string; assetId: string }

/**
 * Open drafts for this app session, by file identity. The file column unmounts
 * on any navigation that drops the document (a topic on a narrow pane, the
 * crumb back, another file, another space), and the draft used to die with it:
 * come back and the typing was gone, with nothing having asked. Held here it
 * outlives the mount, so returning to the file reopens the editor on the text
 * as it stood (2026-09-23). Applying or discarding is what ends a draft.
 * Not persisted — like the column memory, a relaunch starts clean.
 */
const drafts = new Map<string, SpaceDraft>()

const key = (ref: FileRef) => `${ref.orgId}:${ref.spaceId}:${ref.assetId}`

export function readSpaceDraft(ref: FileRef): SpaceDraft | null {
  return drafts.get(key(ref)) ?? null
}

/** Null ends the draft — the edit was applied, discarded, or its file deleted. */
export function writeSpaceDraft(ref: FileRef, draft: SpaceDraft | null) {
  if (draft) drafts.set(key(ref), draft)
  else drafts.delete(key(ref))
}

/** Tests only: drafts are module state, so a test that edits must not leak into the next. */
export function clearSpaceDrafts() {
  drafts.clear()
}

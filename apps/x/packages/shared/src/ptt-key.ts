/**
 * The hold-to-talk (push-to-talk) key, in the three vocabularies that need
 * it: libuiohook keycodes (main's global hook), KeyboardEvent.code (the
 * in-window DOM listeners), and a human label (every surface that tells the
 * user which key to hold).
 *
 * macOS uses the right ⌘. Windows and Linux use the right Ctrl — the same
 * physical position there is the right Super/Win key, which the OS owns (a
 * bare tap opens the Start menu), so it can never be a talk key.
 *
 * This module exists because those three vocabularies used to be decided
 * independently in three files, and two of them drifted: main's hook and the
 * app window still watched the right ⌘ on Windows (where nothing pressed it)
 * while the companion window watched the right Ctrl and *labelled* it ⌘.
 * Everything reads from here now.
 *
 * Platform is always a parameter, never detected: main knows it as
 * `process.platform`, the renderer as `navigator.platform`, and neither
 * vocabulary is available in the other's process.
 */

// libuiohook virtual keycodes (uiohook-napi's UiohookKey table).
export const UIOHOOK_META_RIGHT = 3676;
export const UIOHOOK_CTRL_RIGHT = 3613;

/** The keycode main's global hook watches, from `process.platform`. */
export function pttUiohookKeycode(platform: string): number {
  return platform === 'darwin' ? UIOHOOK_META_RIGHT : UIOHOOK_CTRL_RIGHT;
}

/** The `KeyboardEvent.code` the in-window listeners watch. */
export function pttEventCode(isMac: boolean): string {
  return isMac ? 'MetaRight' : 'ControlRight';
}

/**
 * Whether the PTT modifier is being held as part of some OTHER shortcut —
 * the chord guard, so ⌘C (Ctrl+C on Windows) during a hands-free lock
 * cancels the capture instead of committing it.
 */
export function pttModifierHeld(
  e: { metaKey: boolean; ctrlKey: boolean },
  isMac: boolean,
): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/** Bare keycap, for tight status chips: "⌘" / "Ctrl". */
export function pttKeycap(isMac: boolean): string {
  return isMac ? '⌘' : 'Ctrl';
}

/** Mid-sentence name: "right ⌘" / "right Ctrl". */
export function pttKeyLabel(isMac: boolean): string {
  return isMac ? 'right ⌘' : 'right Ctrl';
}

/** Sentence-initial name: "Right ⌘" / "Right Ctrl". */
export function pttKeyLabelCap(isMac: boolean): string {
  return isMac ? 'Right ⌘' : 'Right Ctrl';
}

/**
 * The ghostwriter chord — hold ⇧ with the talk key and the answer is pasted
 * at the user's cursor: "⇧⌘" / "Shift+Ctrl".
 */
export function pttPasteChordLabel(isMac: boolean): string {
  return isMac ? '⇧⌘' : 'Shift+Ctrl';
}

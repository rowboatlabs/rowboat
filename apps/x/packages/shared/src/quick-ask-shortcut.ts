/**
 * The customizable global quick-ask chord, shared between main (register /
 * validate) and renderer (recorder UI, display strings, hold-to-talk release
 * detection). One accelerator string (Electron format, e.g. "Alt+Shift+Space")
 * is the single source of truth; everything else — keycap displays, tray
 * accelerators, KeyboardEvent codes — derives from it here.
 *
 * Chord shape rule: 2–3 keys total — one or two modifiers plus exactly one
 * regular key. At least one modifier must be a "strong" one (Ctrl / Alt /
 * Cmd / Win): Shift alone plus a character key is just typing, and a global
 * grab on it would swallow capital letters system-wide.
 */

/** Modifier tokens we emit, in canonical order (parse accepts aliases). */
export const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Command', 'Super'] as const;
export type ShortcutModifier = (typeof MODIFIER_ORDER)[number];

export const DEFAULT_QUICK_ASK_SHORTCUT = 'Alt+Shift+Space';

const MODIFIER_ALIASES: Record<string, ShortcutModifier> = {
  control: 'Control',
  ctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  command: 'Command',
  cmd: 'Command',
  super: 'Super',
  meta: 'Super',
};

/** Non-modifier keys the recorder accepts, as Electron accelerator tokens. */
const NAMED_KEYS = new Set([
  'Space', 'Tab', 'Enter', 'Backspace', 'Delete', 'Escape',
  'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown',
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
]);
const CHAR_KEY = /^[A-Z0-9`~!@#$%^&*()\-_=+[\]{};:'",<.>/?\\|]$/;

export type ParsedShortcut = {
  modifiers: ShortcutModifier[];
  key: string;
};

/**
 * Parse an accelerator into canonical parts. Returns null when the string
 * is not a chord this feature accepts (shape rule above) — used both to
 * validate recorder output and to reject a hand-edited settings file.
 */
export function parseShortcut(accelerator: string): ParsedShortcut | null {
  if (typeof accelerator !== 'string' || !accelerator.trim()) return null;
  const tokens = accelerator.split('+').map((t) => t.trim()).filter(Boolean);
  const modifiers: ShortcutModifier[] = [];
  const keys: string[] = [];
  for (const token of tokens) {
    const mod = MODIFIER_ALIASES[token.toLowerCase()];
    if (mod) {
      if (!modifiers.includes(mod)) modifiers.push(mod);
      continue;
    }
    const upper = token.length === 1 ? token.toUpperCase() : token;
    const named = NAMED_KEYS.has(token) ? token
      : NAMED_KEYS.has(capitalize(token)) ? capitalize(token)
      : null;
    if (named) keys.push(named);
    else if (CHAR_KEY.test(upper)) keys.push(upper);
    else return null;
  }
  if (keys.length !== 1) return null;
  if (modifiers.length < 1 || modifiers.length > 2) return null;
  // Shift-only chords are typing, not shortcuts.
  if (modifiers.every((m) => m === 'Shift')) return null;
  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return { modifiers, key: keys[0] };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Canonical accelerator string (stable order — safe to compare). */
export function normalizeShortcut(accelerator: string): string | null {
  const parsed = parseShortcut(accelerator);
  return parsed ? [...parsed.modifiers, parsed.key].join('+') : null;
}

/**
 * Chords macOS owns at a level where Electron's register() "succeeds" but
 * never fires — the undetectable conflicts, rejected up front. (Ordinary
 * app-level conflicts DO surface as register() returning false.)
 */
const MACOS_SYSTEM_CHORDS = new Set([
  'Command+Space',       // Spotlight
  'Alt+Command+Space',   // Finder search
  'Command+Tab',         // App switcher
  'Shift+Command+Tab',
  'Command+Q',           // Quit — grabbing it globally breaks every app
]);

export function isSystemReservedShortcut(accelerator: string, platform: string): boolean {
  const normalized = normalizeShortcut(accelerator);
  if (!normalized) return false;
  return platform === 'darwin' && MACOS_SYSTEM_CHORDS.has(normalized);
}

// --- Display ---

const MAC_MODIFIER_GLYPHS: Record<ShortcutModifier, string> = {
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Command: '⌘',
  Super: '⌘',
};
const GENERIC_MODIFIER_LABELS: Record<ShortcutModifier, string> = {
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Command: 'Win',
  Super: 'Win',
};
const KEY_DISPLAY: Record<string, string> = {
  Up: '↑', Down: '↓', Left: '←', Right: '→',
  Enter: '↵', Backspace: '⌫', Delete: '⌦', Escape: 'Esc',
};

/** Per-keycap labels for the recorder UI (["⌥", "⇧", "Space"]). */
export function shortcutDisplayParts(accelerator: string, isMac: boolean): string[] {
  const parsed = parseShortcut(accelerator);
  if (!parsed) return [];
  const mods = parsed.modifiers.map((m) =>
    isMac ? MAC_MODIFIER_GLYPHS[m] : GENERIC_MODIFIER_LABELS[m],
  );
  return [...mods, KEY_DISPLAY[parsed.key] ?? parsed.key];
}

/** One-string display form: "⌥⇧Space" on mac, "Alt+Shift+Space" elsewhere. */
export function formatShortcut(accelerator: string, isMac: boolean): string {
  const parts = shortcutDisplayParts(accelerator, isMac);
  if (!parts.length) return accelerator;
  return isMac ? parts.join('') : parts.join('+');
}

// --- KeyboardEvent bridging (recorder capture + hold-to-talk release) ---

/** KeyboardEvent.code → accelerator key token (null = not a chordable key). */
export function eventCodeToShortcutKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const named: Record<string, string> = {
    Space: 'Space', Tab: 'Tab', Enter: 'Enter',
    Backspace: 'Backspace', Delete: 'Delete',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Minus: '-', Equal: '=', Backquote: '`',
  };
  return named[code] ?? null;
}

const KEY_TO_CODES: Record<string, string[]> = {
  Space: ['Space'], Tab: ['Tab'], Enter: ['Enter', 'NumpadEnter'],
  Backspace: ['Backspace'], Delete: ['Delete'],
  Up: ['ArrowUp'], Down: ['ArrowDown'], Left: ['ArrowLeft'], Right: ['ArrowRight'],
  Home: ['Home'], End: ['End'], PageUp: ['PageUp'], PageDown: ['PageDown'],
  ',': ['Comma'], '.': ['Period'], '/': ['Slash'], ';': ['Semicolon'], "'": ['Quote'],
  '[': ['BracketLeft'], ']': ['BracketRight'], '\\': ['Backslash'],
  '-': ['Minus'], '=': ['Equal'], '`': ['Backquote'],
};
const MODIFIER_CODES: Record<ShortcutModifier, string[]> = {
  Control: ['ControlLeft', 'ControlRight'],
  Alt: ['AltLeft', 'AltRight'],
  Shift: ['ShiftLeft', 'ShiftRight'],
  Command: ['MetaLeft', 'MetaRight'],
  Super: ['MetaLeft', 'MetaRight'],
};

/**
 * Every KeyboardEvent.code that is part of the chord — the hold-to-talk
 * release detector treats any of these keys' keyup as "chord released".
 */
export function shortcutChordCodes(accelerator: string): string[] {
  const parsed = parseShortcut(accelerator);
  if (!parsed) return [];
  const codes = parsed.modifiers.flatMap((m) => MODIFIER_CODES[m]);
  if (KEY_TO_CODES[parsed.key]) codes.push(...KEY_TO_CODES[parsed.key]);
  else if (/^[A-Z]$/.test(parsed.key)) codes.push(`Key${parsed.key}`);
  else if (/^[0-9]$/.test(parsed.key)) codes.push(`Digit${parsed.key}`);
  else codes.push(parsed.key); // F-keys: code === token
  return codes;
}

/**
 * getModifierState() names for the chord's modifiers — the backup release
 * signal ("none of the chord's modifiers are held anymore").
 */
export function shortcutModifierStates(accelerator: string): string[] {
  const parsed = parseShortcut(accelerator);
  if (!parsed) return [];
  const map: Record<ShortcutModifier, string> = {
    Control: 'Control', Alt: 'Alt', Shift: 'Shift', Command: 'Meta', Super: 'Meta',
  };
  return [...new Set(parsed.modifiers.map((m) => map[m]))];
}

// The push-to-talk key's user-facing name. macOS: right ⌘. Windows/Linux:
// right Ctrl (the right Win key's physical position is OS-owned — a tap
// opens the Start menu). Keep in step with PTT_KEYCODE in main/ptt.ts and
// the DOM fallbacks' event codes.
export function pttKeyLabel(isMac: boolean): string {
  return isMac ? 'right \u2318' : 'right Ctrl';
}

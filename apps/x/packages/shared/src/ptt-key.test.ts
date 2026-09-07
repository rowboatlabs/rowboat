import { describe, expect, it } from 'vitest';

import {
  UIOHOOK_CTRL_RIGHT,
  UIOHOOK_META_RIGHT,
  pttEventCode,
  pttKeyLabel,
  pttKeyLabelCap,
  pttKeycap,
  pttModifierHeld,
  pttPasteChordLabel,
  pttUiohookKeycode,
} from './ptt-key.js';

// The bug this module exists to prevent: main's global hook, the app window
// and the companion window each deciding the talk key on their own, and two
// of the three landing on a key Windows never delivers.
describe('ptt-key', () => {
  it('watches the right ⌘ on macOS and the right Ctrl elsewhere', () => {
    expect(pttUiohookKeycode('darwin')).toBe(UIOHOOK_META_RIGHT);
    expect(pttUiohookKeycode('win32')).toBe(UIOHOOK_CTRL_RIGHT);
    expect(pttUiohookKeycode('linux')).toBe(UIOHOOK_CTRL_RIGHT);
  });

  it('names the same key as a KeyboardEvent.code', () => {
    expect(pttEventCode(true)).toBe('MetaRight');
    expect(pttEventCode(false)).toBe('ControlRight');
  });

  it('agrees between the hook keycode and the DOM code', () => {
    // Both windows and the hook must open the gate on ONE physical key —
    // a mismatch is exactly how PTT worked in one surface and not the next.
    const pairs: Array<[string, boolean, number, string]> = [
      ['darwin', true, UIOHOOK_META_RIGHT, 'MetaRight'],
      ['win32', false, UIOHOOK_CTRL_RIGHT, 'ControlRight'],
    ];
    for (const [platform, isMac, keycode, code] of pairs) {
      expect(pttUiohookKeycode(platform)).toBe(keycode);
      expect(pttEventCode(isMac)).toBe(code);
    }
  });

  it('reads the chord guard off the matching modifier', () => {
    const meta = { metaKey: true, ctrlKey: false };
    const ctrl = { metaKey: false, ctrlKey: true };
    expect(pttModifierHeld(meta, true)).toBe(true);
    expect(pttModifierHeld(ctrl, true)).toBe(false);
    expect(pttModifierHeld(ctrl, false)).toBe(true);
    expect(pttModifierHeld(meta, false)).toBe(false);
  });

  it('never shows a ⌘ glyph off macOS', () => {
    for (const label of [
      pttKeycap(false),
      pttKeyLabel(false),
      pttKeyLabelCap(false),
      pttPasteChordLabel(false),
    ]) {
      expect(label).not.toContain('⌘');
    }
    expect(pttKeyLabel(true)).toBe('right ⌘');
    expect(pttKeyLabelCap(true)).toBe('Right ⌘');
    expect(pttKeyLabel(false)).toBe('right Ctrl');
    expect(pttKeyLabelCap(false)).toBe('Right Ctrl');
  });
});

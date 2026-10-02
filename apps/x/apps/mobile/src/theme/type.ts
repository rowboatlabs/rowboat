// One type scale for the whole app (iOS-style, four steps). Screens pick from
// here instead of inventing sizes, so lists, settings and chat read as one app.
export const type = {
  /** Hero name on a screen (org, account). */
  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  /** List rows, body copy, buttons. */
  body: { fontSize: 16 },
  bodyStrong: { fontSize: 16, fontWeight: '600' },
  /** Secondary line under a row, footers, metadata. */
  caption: { fontSize: 13 },
  /** Section header above a card (matches Settings). */
  section: { fontSize: 13, textTransform: 'uppercase' },
} as const;

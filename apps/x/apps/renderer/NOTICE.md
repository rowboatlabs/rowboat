# Third-party attributions

This application contains code adapted from the following open-source
projects. Each source file containing adapted code carries a header noting
its origin.

## pptx-viewer (Apache License 2.0)

<https://github.com/ChristopherVR/pptx-viewer>

Portions adapted in:

- `src/lib/pptx/theme.ts` — OOXML drawing color transform application order
  and math (structural → shade/tint → batched HSL → RGB channels), RGB/HSL
  conversion behavior, scRGB gamma companding, and the lazy `p:clrMap` alias
  routing model (the theme scheme as source of truth, `tx1`/`bg1`/`tx2`/`bg2`
  resolved through the active master's color map at lookup time). Reference
  files: `packages/core/src/core/color/color-transforms.ts`,
  `packages/core/src/core/color/color-primitives.ts`,
  `packages/core/src/core/core/runtime/PptxHandlerRuntimeThemeLoading.ts`.
- `src/lib/pptx/geometry.ts` — the `phClr` substitution model for resolving
  `p:style` fill/line references through the theme format scheme.

The XML traversal in both files is our own (this codebase uses
fast-xml-parser's preserveOrder document shape); the adapted portions are the
resolution semantics and math noted above.

## PPTXjs (MIT License)

<https://github.com/meshesha/PPTXjs>

License reviewed; no code from this project is currently included.

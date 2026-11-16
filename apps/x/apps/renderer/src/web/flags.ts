// What the desktop's preload publishes, set for the browser. This module is
// main.tsx's first import, because ES modules evaluate in import order and
// lib/feature-flags reads window.featureFlags as it loads. Anything that
// imports it (the blob URL helpers, the handlers) must find these set
// (2026-10-12).
window.featureFlags = { spaces: true, localRuntime: false }
// The page has the bytes of a dropped file, never its path.
window.electronUtils = { getPathForFile: () => '', getZoomFactor: () => 1 }

export {}

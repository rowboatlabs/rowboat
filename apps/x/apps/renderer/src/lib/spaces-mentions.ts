// Mention detection lives in @x/shared (one scanner for the renderer and for
// main's mention notifications); this module keeps the renderer's import path.
export { containsMemberAddress, containsRowboatAddress, stripNonAddressRegions } from '@x/shared/dist/spaces.js'

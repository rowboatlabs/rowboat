import { describe, expect, it } from 'vitest'
import { canOpenInApp, getViewerType } from './file-types'

// canOpenInApp is the predicate file cards use to choose the in-app route over
// the OS opener. It must stay in step with the file-view router in App.tsx:
// markdown -> MarkdownEditor, html/pdf -> PersistentViewerCache, and the
// dedicated media viewers for the rest.
describe('canOpenInApp', () => {
  it('covers every type the file view mounts a viewer for', () => {
    for (const path of [
      'presentations/Q3 review.pptx',
      'docs/contract.docx',
      'images/shot.png',
      'clips/demo.mp4',
      'recordings/standup.m4a',
      'reports/summary.pdf',
      'exports/report.html',
      'knowledge/People/Sarah Chen.md',
    ]) {
      expect(canOpenInApp(path), path).toBe(true)
    }
  })

  it('leaves types with no in-app viewer to the OS', () => {
    for (const path of ['archives/data.zip', 'notes.txt', 'rows.csv', 'app.dmg', 'README']) {
      expect(canOpenInApp(path), path).toBe(false)
    }
  })

  it('agrees with getViewerType on everything except markdown', () => {
    // Markdown is the one in-app type without a media viewer — it goes to the
    // editor instead, which is why canOpenInApp is not just isMediaPath.
    expect(getViewerType('a.md')).toBeNull()
    expect(canOpenInApp('a.md')).toBe(true)
    expect(canOpenInApp('a.pptx')).toBe(getViewerType('a.pptx') !== null)
    expect(canOpenInApp('a.zip')).toBe(getViewerType('a.zip') !== null)
  })
})

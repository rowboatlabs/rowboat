import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EMU_PER_INCH, type Slide, type TextShape } from '@/lib/pptx/types'
import { SlideThumbnail } from './canvas'

afterEach(cleanup)

/** 16:9 at 13.333in × 7.5in — the size PowerPoint gives a widescreen deck. */
const SIZE_EMU = { w: 12192000, h: 6858000 }
const REFERENCE_W = SIZE_EMU.w * (96 / EMU_PER_INCH)

const BODY_PT = 12

const textShape: TextShape = {
  type: 'text',
  id: '1',
  slideXmlPath: 'ppt/slides/slide1.xml',
  nodePath: [0],
  xfrmEmu: { x: 0, y: 0, w: 6000000, h: 400000 },
  paragraphs: [{ runs: [{ text: 'Settings dialog · sign-in status', sizePt: BODY_PT }] }],
}

const slide: Slide = { id: 's1', xmlPath: 'ppt/slides/slide1.xml', shapes: [textShape] }

describe('SlideThumbnail', () => {
  it('keeps the caller-requested box, whatever the reference layout is', () => {
    const { container } = render(
      <SlideThumbnail slide={slide} sizeEmu={SIZE_EMU} widthPx={160} />,
    )
    const outer = container.firstElementChild as HTMLElement
    expect(outer.style.width).toBe('160px')
    expect(outer.style.height).toBe('90px')
  })

  it('lays the slide out at 100% and scales the finished render down', () => {
    const { container } = render(
      <SlideThumbnail slide={slide} sizeEmu={SIZE_EMU} widthPx={160} />,
    )
    const layer = container.querySelector<HTMLElement>('[style*="scale"]')
    expect(layer).not.toBeNull()
    expect(layer?.style.width).toBe(`${REFERENCE_W}px`)
    expect(layer?.style.transform).toBe(`scale(${160 / REFERENCE_W})`)
    expect(layer?.style.transformOrigin).toBe('top left')
  })

  it('never lays text out at a sub-pixel font size', () => {
    // Scaling each length straight into the target box put 12pt body text at
    // ~2px, which Chromium renders as an invisible smear: the rail showed
    // empty boxes where the slide was full of words. The run must be laid out
    // at its real size and only then scaled.
    for (const widthPx of [80, 160, 320]) {
      const { container } = render(
        <SlideThumbnail slide={slide} sizeEmu={SIZE_EMU} widthPx={widthPx} />,
      )
      const run = container.querySelector<HTMLElement>('p > span')
      expect(run?.style.fontSize).toBe(`${(BODY_PT * 96) / 72}px`)
      cleanup()
    }
  })
})

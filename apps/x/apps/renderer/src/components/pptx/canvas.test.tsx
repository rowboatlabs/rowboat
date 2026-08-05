import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EMU_PER_INCH,
  type ParagraphDisplay,
  type ResolvedRunStyle,
  type Slide,
  type TextShape,
} from '@/lib/pptx/types'
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

const slide: Slide = { spTreePath: [0, 0, 0], id: 's1', xmlPath: 'ppt/slides/slide1.xml', shapes: [textShape] }

const bodyRun: ResolvedRunStyle = {
  sizePt: BODY_PT,
  bold: false,
  italic: false,
  underline: false,
  colorHex: '000000',
  fontFamily: "'BodyFace', sans-serif",
}

function displayParagraph(overrides: Partial<ParagraphDisplay>): ParagraphDisplay {
  return {
    level: 0,
    marLEmu: 0,
    indentEmu: 0,
    bullet: { kind: 'none' },
    lineHeight: { kind: 'mult', value: 1.2 },
    spaceBeforePt: 0,
    spaceAfterPt: 0,
    runs: [bodyRun],
    defaultRun: bodyRun,
    ...overrides,
  }
}

function slideWith(shape: TextShape): Slide {
  return { spTreePath: [0, 0, 0], id: 's1', xmlPath: 'ppt/slides/slide1.xml', shapes: [shape] }
}

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

  it('applies the authored typeface, line height and normAutofit scaling', () => {
    const shape: TextShape = {
      ...textShape,
      display: {
        anchor: 't',
        defaultRun: bodyRun,
        autofit: { fontScale: 0.625, lnSpcReduction: 0.2 },
        paragraphs: [displayParagraph({})],
      },
    }
    const { container } = render(
      <SlideThumbnail slide={slideWith(shape)} sizeEmu={SIZE_EMU} widthPx={160} />,
    )
    const p = container.querySelector<HTMLElement>('p')
    const run = container.querySelector<HTMLElement>('p > span')
    // 12pt × 0.625 font scale = 7.5pt = 10px at the 96dpi reference layout.
    expect(run?.style.fontSize).toBe('10px')
    expect(run?.style.fontFamily).toContain('BodyFace')
    // 1.2 default × (1 − 0.2) line-spacing reduction, unitless on the block.
    expect(p?.style.lineHeight).toBe(String(1.2 * (1 - 0.2)))
  })

  it('renders authored character tracking, unscaled by normAutofit', () => {
    const tracked: ResolvedRunStyle = { ...bodyRun, letterSpacingPt: -3.15 }
    const shape: TextShape = {
      ...textShape,
      display: {
        anchor: 't',
        defaultRun: tracked,
        autofit: { fontScale: 0.5, lnSpcReduction: 0 },
        paragraphs: [displayParagraph({ runs: [tracked], defaultRun: tracked })],
      },
    }
    const { container } = render(
      <SlideThumbnail slide={slideWith(shape)} sizeEmu={SIZE_EMU} widthPx={160} />,
    )
    const run = container.querySelector<HTMLElement>('p > span')
    // -3.15pt = -4.2px at the 96dpi reference layout. Tracking is an absolute
    // typographic measure, so normAutofit's fontScale must NOT scale it.
    expect(parseFloat(run?.style.letterSpacing ?? '')).toBeCloseTo((-3.15 * 96) / 72, 6)
    expect(run?.style.fontSize).toBe(`${(BODY_PT * 0.5 * 96) / 72}px`)
  })

  it('renders fixed line spacing and paragraph spacing as px on the block', () => {
    const shape: TextShape = {
      ...textShape,
      display: {
        anchor: 't',
        defaultRun: bodyRun,
        paragraphs: [
          displayParagraph({
            lineHeight: { kind: 'pt', pt: 18 },
            spaceBeforePt: 6,
            spaceAfterPt: 3,
          }),
        ],
      },
    }
    const { container } = render(
      <SlideThumbnail slide={slideWith(shape)} sizeEmu={SIZE_EMU} widthPx={160} />,
    )
    const p = container.querySelector<HTMLElement>('p')
    // 18pt fixed = 24px; spcBef 6pt = 8px; spcAft 3pt = 4px (96dpi reference).
    expect(p?.style.lineHeight).toBe('24px')
    expect(p?.style.paddingTop).toBe('8px')
    expect(p?.style.paddingBottom).toBe('4px')
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

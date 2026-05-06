/**
 * Terminal output processor that handles ANSI escape sequences, carriage returns,
 * and other terminal control characters to produce styled, terminal-like output.
 */

export interface StyledSpan {
  text: string
  style: SpanStyle
}

export interface SpanStyle {
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  fg?: string
  bg?: string
}

export interface TerminalLine {
  spans: StyledSpan[]
}

const ANSI_COLORS_16: Record<number, string> = {
  30: '#4e4e4e', 31: '#e06c75', 32: '#98c379', 33: '#e5c07b',
  34: '#61afef', 35: '#c678dd', 36: '#56b6c2', 37: '#dcdfe4',
  90: '#5c6370', 91: '#e06c75', 92: '#98c379', 93: '#e5c07b',
  94: '#61afef', 95: '#c678dd', 96: '#56b6c2', 97: '#ffffff',
}

const ANSI_BG_COLORS_16: Record<number, string> = {
  40: '#4e4e4e', 41: '#e06c75', 42: '#98c379', 43: '#e5c07b',
  44: '#61afef', 45: '#c678dd', 46: '#56b6c2', 47: '#dcdfe4',
  100: '#5c6370', 101: '#e06c75', 102: '#98c379', 103: '#e5c07b',
  104: '#61afef', 105: '#c678dd', 106: '#56b6c2', 107: '#ffffff',
}

function color256(n: number): string {
  if (n < 8) return ANSI_COLORS_16[30 + n] ?? '#dcdfe4'
  if (n < 16) return ANSI_COLORS_16[90 + (n - 8)] ?? '#dcdfe4'
  if (n < 232) {
    const idx = n - 16
    const r = Math.floor(idx / 36)
    const g = Math.floor((idx % 36) / 6)
    const b = idx % 6
    const toHex = (v: number) => (v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  }
  const level = 8 + (n - 232) * 10
  const hex = level.toString(16).padStart(2, '0')
  return `#${hex}${hex}${hex}`
}

function parseSGR(params: number[], style: SpanStyle): SpanStyle {
  const s = { ...style }
  let i = 0
  while (i < params.length) {
    const p = params[i]
    if (p === 0) {
      delete s.bold
      delete s.dim
      delete s.italic
      delete s.underline
      delete s.strikethrough
      delete s.fg
      delete s.bg
    } else if (p === 1) s.bold = true
    else if (p === 2) s.dim = true
    else if (p === 3) s.italic = true
    else if (p === 4) s.underline = true
    else if (p === 9) s.strikethrough = true
    else if (p === 22) {
      delete s.bold
      delete s.dim
    } else if (p === 23) delete s.italic
    else if (p === 24) delete s.underline
    else if (p === 29) delete s.strikethrough
    else if (p >= 30 && p <= 37) s.fg = ANSI_COLORS_16[p]
    else if (p === 38) {
      if (params[i + 1] === 5 && params[i + 2] !== undefined) {
        s.fg = color256(params[i + 2])
        i += 2
      } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
        const r = params[i + 2]
        const g = params[i + 3]
        const b = params[i + 4]
        s.fg = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
        i += 4
      }
    } else if (p === 39) delete s.fg
    else if (p >= 40 && p <= 47) s.bg = ANSI_BG_COLORS_16[p]
    else if (p === 48) {
      if (params[i + 1] === 5 && params[i + 2] !== undefined) {
        s.bg = color256(params[i + 2])
        i += 2
      } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
        const r = params[i + 2]
        const g = params[i + 3]
        const b = params[i + 4]
        s.bg = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
        i += 4
      }
    } else if (p === 49) delete s.bg
    else if (p >= 90 && p <= 97) s.fg = ANSI_COLORS_16[p]
    else if (p >= 100 && p <= 107) s.bg = ANSI_BG_COLORS_16[p]
    i++
  }
  return s
}

export function processTerminalOutput(raw: string): TerminalLine[] {
  type Cell = { char: string; style: SpanStyle }
  const lines: Cell[][] = [[]]
  let cursorRow = 0
  let cursorCol = 0
  let currentStyle: SpanStyle = {}

  function ensureRow(row: number) {
    while (lines.length <= row) lines.push([])
  }

  function ensureCol(row: number, col: number) {
    ensureRow(row)
    const line = lines[row]
    while (line.length <= col) line.push({ char: ' ', style: {} })
  }

  let i = 0
  while (i < raw.length) {
    const ch = raw[i]

    if (ch === '\x1b' && i + 1 < raw.length) {
      const next = raw[i + 1]

      if (next === '[') {
        i += 2
        let paramStr = ''
        while (i < raw.length && raw[i] >= '\x20' && raw[i] <= '\x3f') {
          paramStr += raw[i]
          i++
        }
        const finalByte = i < raw.length ? raw[i] : ''
        i++

        const params = paramStr.length > 0
          ? paramStr.split(';').map(s => parseInt(s, 10) || 0)
          : [0]

        switch (finalByte) {
          case 'm':
            currentStyle = parseSGR(params, currentStyle)
            break
          case 'A':
            cursorRow = Math.max(0, cursorRow - (params[0] || 1))
            break
          case 'B':
            cursorRow += (params[0] || 1)
            ensureRow(cursorRow)
            break
          case 'C':
            cursorCol += (params[0] || 1)
            break
          case 'D':
            cursorCol = Math.max(0, cursorCol - (params[0] || 1))
            break
          case 'G':
            cursorCol = Math.max(0, (params[0] || 1) - 1)
            break
          case 'H':
          case 'f':
            cursorRow = Math.max(0, (params[0] || 1) - 1)
            cursorCol = Math.max(0, (params[1] || 1) - 1)
            ensureRow(cursorRow)
            break
          case 'J': {
            const mode = params[0] || 0
            if (mode === 2 || mode === 3) {
              lines.length = 0
              lines.push([])
              cursorRow = 0
              cursorCol = 0
            } else if (mode === 0) {
              ensureRow(cursorRow)
              lines[cursorRow].length = cursorCol
              for (let r = cursorRow + 1; r < lines.length; r++) lines[r] = []
            } else if (mode === 1) {
              for (let r = 0; r < cursorRow; r++) lines[r] = []
              ensureCol(cursorRow, cursorCol)
              for (let c = 0; c <= cursorCol; c++) lines[cursorRow][c] = { char: ' ', style: {} }
            }
            break
          }
          case 'K': {
            const mode = params[0] || 0
            ensureRow(cursorRow)
            const line = lines[cursorRow]
            if (mode === 0) {
              line.length = cursorCol
            } else if (mode === 1) {
              ensureCol(cursorRow, cursorCol)
              for (let c = 0; c <= cursorCol; c++) line[c] = { char: ' ', style: {} }
            } else if (mode === 2) {
              lines[cursorRow] = []
            }
            break
          }
          default:
            break
        }
        continue
      }

      if (next === ']') {
        i += 2
        while (i < raw.length && raw[i] !== '\x07' && !(raw[i] === '\x1b' && raw[i + 1] === '\\')) {
          i++
        }
        if (i < raw.length && raw[i] === '\x07') i++
        else if (i < raw.length) i += 2
        continue
      }

      i += 2
      continue
    }

    if (ch === '\r') {
      cursorCol = 0
      i++
      continue
    }

    if (ch === '\n') {
      cursorRow++
      cursorCol = 0
      ensureRow(cursorRow)
      i++
      continue
    }

    if (ch === '\b') {
      cursorCol = Math.max(0, cursorCol - 1)
      i++
      continue
    }

    if (ch === '\t') {
      const nextTabStop = (Math.floor(cursorCol / 8) + 1) * 8
      while (cursorCol < nextTabStop) {
        ensureCol(cursorRow, cursorCol)
        lines[cursorRow][cursorCol] = { char: ' ', style: { ...currentStyle } }
        cursorCol++
      }
      i++
      continue
    }

    if (ch.charCodeAt(0) < 32) {
      i++
      continue
    }

    ensureCol(cursorRow, cursorCol)
    lines[cursorRow][cursorCol] = { char: ch, style: { ...currentStyle } }
    cursorCol++
    i++
  }

  return lines.map(cells => {
    const spans: StyledSpan[] = []
    if (cells.length === 0) return { spans: [{ text: '', style: {} }] }

    let end = cells.length
    while (end > 0 && cells[end - 1].char === ' ' && Object.keys(cells[end - 1].style).length === 0) {
      end--
    }

    let currentSpan: StyledSpan | null = null
    for (let c = 0; c < end; c++) {
      const cell = cells[c]
      const sameStyle = currentSpan && styleEquals(currentSpan.style, cell.style)
      if (sameStyle && currentSpan) {
        currentSpan.text += cell.char
      } else {
        if (currentSpan) spans.push(currentSpan)
        currentSpan = { text: cell.char, style: { ...cell.style } }
      }
    }
    if (currentSpan) spans.push(currentSpan)
    if (spans.length === 0) spans.push({ text: '', style: {} })
    return { spans }
  })
}

function styleEquals(a: SpanStyle, b: SpanStyle): boolean {
  return a.bold === b.bold
    && a.dim === b.dim
    && a.italic === b.italic
    && a.underline === b.underline
    && a.strikethrough === b.strikethrough
    && a.fg === b.fg
    && a.bg === b.bg
}

export function spanStyleToCSS(style: SpanStyle): React.CSSProperties | undefined {
  if (Object.keys(style).length === 0) return undefined
  const css: React.CSSProperties = {}
  if (style.fg) css.color = style.fg
  if (style.bg) css.backgroundColor = style.bg
  if (style.bold) css.fontWeight = 'bold'
  if (style.dim) css.opacity = 0.6
  if (style.italic) css.fontStyle = 'italic'
  if (style.underline) css.textDecoration = 'underline'
  if (style.strikethrough) {
    css.textDecoration = css.textDecoration ? `${css.textDecoration} line-through` : 'line-through'
  }
  return Object.keys(css).length > 0 ? css : undefined
}

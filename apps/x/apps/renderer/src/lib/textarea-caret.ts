/**
 * Get the pixel coordinates of a position within a textarea.
 * Uses the mirror div technique to calculate cursor position.
 */

// Properties that affect text layout and must be copied to the mirror div
const PROPERTIES_TO_COPY = [
  'direction',
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'MozTabSize',
] as const

export interface CaretCoordinates {
  top: number
  left: number
  height: number
}

export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number
): CaretCoordinates {
  // Create a mirror div to measure text position
  const div = document.createElement('div')
  div.id = 'textarea-caret-position-mirror-div'
  document.body.appendChild(div)

  const style = div.style
  const computed = window.getComputedStyle(textarea)

  // Position offscreen
  style.whiteSpace = 'pre-wrap'
  style.wordWrap = 'break-word'
  style.position = 'absolute'
  style.visibility = 'hidden'
  style.overflow = 'hidden'

  // Copy styles from textarea to mirror div
  for (const prop of PROPERTIES_TO_COPY) {
    const value = computed.getPropertyValue(prop.replace(/([A-Z])/g, '-$1').toLowerCase())
    style.setProperty(prop.replace(/([A-Z])/g, '-$1').toLowerCase(), value)
  }

  // Firefox-specific handling
  const isFirefox = navigator.userAgent.toLowerCase().includes('firefox')
  if (isFirefox) {
    if (textarea.scrollHeight > parseInt(computed.height)) {
      style.overflowY = 'scroll'
    }
  } else {
    style.overflow = 'hidden'
  }

  // Set the text content up to the position
  div.textContent = textarea.value.substring(0, position)

  // Create a span at the cursor position
  const span = document.createElement('span')
  // Add a zero-width space to ensure the span has height
  span.textContent = textarea.value.substring(position) || '\u200B'
  div.appendChild(span)

  try {
    const coordinates: CaretCoordinates = {
      top: span.offsetTop + parseInt(computed.borderTopWidth) - textarea.scrollTop,
      left: span.offsetLeft + parseInt(computed.borderLeftWidth) - textarea.scrollLeft,
      height: parseInt(computed.lineHeight) || parseInt(computed.fontSize) * 1.2,
    }

    return coordinates
  } finally {
    document.body.removeChild(div)
  }
}

/**
 * Get absolute coordinates relative to the viewport
 */
export function getCaretAbsoluteCoordinates(
  textarea: HTMLTextAreaElement,
  position: number
): CaretCoordinates {
  const relative = getCaretCoordinates(textarea, position)
  const rect = textarea.getBoundingClientRect()

  return {
    top: rect.top + relative.top,
    left: rect.left + relative.left,
    height: relative.height,
  }
}

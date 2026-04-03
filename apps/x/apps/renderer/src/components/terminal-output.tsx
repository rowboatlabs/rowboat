import React, { useMemo } from 'react'
import { processTerminalOutput, spanStyleToCSS } from '../lib/terminal-output'

/**
 * Renders raw terminal output with ANSI color support, carriage return handling,
 * and other terminal control sequence processing — similar to how iTerm renders output.
 */
export function TerminalOutput({ raw }: { raw: string }) {
  const lines = useMemo(() => processTerminalOutput(raw), [raw])

  return (
    <>
      {lines.map((line, lineIdx) => (
        <React.Fragment key={lineIdx}>
          {lineIdx > 0 && '\n'}
          {line.spans.map((span, spanIdx) => {
            const css = spanStyleToCSS(span.style)
            return css ? (
              <span key={spanIdx} style={css}>{span.text}</span>
            ) : (
              <React.Fragment key={spanIdx}>{span.text}</React.Fragment>
            )
          })}
        </React.Fragment>
      ))}
    </>
  )
}

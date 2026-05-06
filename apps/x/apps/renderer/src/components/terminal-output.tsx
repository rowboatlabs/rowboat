import React, { useMemo } from 'react'
import { processTerminalOutput, spanStyleToCSS } from '../lib/terminal-output'

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

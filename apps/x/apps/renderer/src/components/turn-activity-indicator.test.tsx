import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TurnActivityIndicator } from './turn-activity-indicator'

afterEach(cleanup)

describe('TurnActivityIndicator', () => {
  it('shows generic activity while a turn is running outside model reasoning', () => {
    render(<TurnActivityIndicator isReasoning={false} />)
    expect(screen.getByRole('status')).toHaveTextContent('Working...')
    expect(screen.queryByText('Thinking...')).toBeNull()
  })

  it('shows thinking only while model reasoning is active', () => {
    render(<TurnActivityIndicator isReasoning />)
    expect(screen.getByRole('status')).toHaveTextContent('Thinking...')
    expect(screen.queryByText('Working...')).toBeNull()
  })
})

import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantComposer } from './assistant-composer'
import { PromptInputProvider, usePromptInputController } from './ai-elements/prompt-input'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function Harness({ submit }: { submit: (text: string) => void }) {
  const controller = usePromptInputController()
  const [focus, setFocus] = useState(0)
  return <>
    <AssistantComposer active={false} focusTrigger={String(focus)} onSubmit={() => submit(controller.textInput.value)} />
    <output data-testid="wire">{controller.textInput.value}</output>
    <button onClick={() => { controller.textInput.setInput('**Restored** draft'); setFocus(f => f + 1) }}>Restore</button>
  </>
}
function mount() {
  const submit = vi.fn()
  render(<PromptInputProvider><Harness submit={submit} /></PromptInputProvider>)
  return { submit, box: screen.getByRole('textbox', { name: 'Message' }) }
}
function paste(box: HTMLElement, plain: string, html = '') {
  fireEvent.paste(box, { clipboardData: { files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? plain : '' } })
}

describe('assistant composer integration', () => {
  it('pastes an HTML table as an editable table and submits its Markdown', async () => {
    const { box, submit } = mount()
    paste(box, 'Item\tCount\nApple\t3', '<table><tr><th>Item</th><th>Count</th></tr><tr><td>Apple</td><td>3</td></tr></table>')
    await waitFor(() => expect(box.querySelectorAll('tr')).toHaveLength(2))
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(submit).toHaveBeenCalledWith(expect.stringContaining('| Apple | 3 |'))
  })
  it('pastes a plain spreadsheet range as a table', async () => {
    const { box } = mount()
    paste(box, 'Apple\t3\nPear\t')
    await waitFor(() => expect(box.querySelectorAll('td')).toHaveLength(4))
    expect(screen.getByTestId('wire').textContent).toContain('| Pear |  |')
  })
  it('preserves rich paste and updates the editor when a saved draft is restored', async () => {
    const { box } = mount()
    paste(box, 'Bold link', '<p><strong>Bold</strong> <a href="https://example.com">link</a></p>')
    await waitFor(() => expect(box.querySelector('strong')).toHaveTextContent('Bold'))
    expect(screen.getByTestId('wire').textContent).toContain('[link](https://example.com)')
    fireEvent.click(screen.getByText('Restore'))
    await waitFor(() => expect(box.querySelector('strong')).toHaveTextContent('Restored'))
  })
  it('does not submit Shift+Enter or IME confirmation', () => {
    const { box, submit } = mount()
    paste(box, 'hello')
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    expect(submit).not.toHaveBeenCalled()
  })
})

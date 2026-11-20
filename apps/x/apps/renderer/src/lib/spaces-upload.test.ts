import { afterEach, describe, expect, it, vi } from 'vitest'
import { arrayBufferToBase64, uploadInputFor } from './spaces-upload'

describe('uploadInputFor', () => {
  afterEach(() => {
    delete (window as unknown as { ipc?: unknown }).ipc
    delete (window as unknown as { electronUtils?: unknown }).electronUtils
    vi.restoreAllMocks()
  })

  it('returns filePath in local/child mode when a local file path is available', async () => {
    const file = new File(['hello local'], 'hello.txt', { type: 'text/plain' })
    const invoke = vi.fn().mockResolvedValue({ mode: 'child', url: null, fromEnv: false })
    const getPathForFile = vi.fn().mockReturnValue('/Users/alice/hello.txt')
    Object.assign(window, {
      ipc: { invoke },
      electronUtils: { getPathForFile },
    })

    const result = await uploadInputFor(file)
    expect(invoke).toHaveBeenCalledWith('server:getConnection', null)
    expect(getPathForFile).toHaveBeenCalledWith(file)
    expect(result).toEqual({ filePath: '/Users/alice/hello.txt' })
  })

  it('returns filePath in in-process mode when local path is available', async () => {
    const file = new File(['hello in-process'], 'hello.txt', { type: 'text/plain' })
    const invoke = vi.fn().mockResolvedValue({ mode: 'in-process', url: null, fromEnv: false })
    const getPathForFile = vi.fn().mockReturnValue('/Users/alice/hello.txt')
    Object.assign(window, {
      ipc: { invoke },
      electronUtils: { getPathForFile },
    })

    const result = await uploadInputFor(file)
    expect(result).toEqual({ filePath: '/Users/alice/hello.txt' })
  })

  it('returns bytes in remote mode even when getPathForFile exists', async () => {
    const content = 'hello remote'
    const file = new File([content], 'hello.txt', { type: 'text/plain' })
    const invoke = vi.fn().mockResolvedValue({ mode: 'remote', url: 'http://remote:3000', fromEnv: false })
    const getPathForFile = vi.fn().mockReturnValue('/client/local/path/hello.txt')
    Object.assign(window, {
      ipc: { invoke },
      electronUtils: { getPathForFile },
    })

    const result = await uploadInputFor(file)
    expect(invoke).toHaveBeenCalledWith('server:getConnection', null)
    expect(getPathForFile).not.toHaveBeenCalled()
    expect(result.filePath).toBeUndefined()
    expect(result.bytes).toBeDefined()
    expect(result.bytes).toBe(btoa(content))
  })

  it('returns bytes in child mode if getPathForFile is not available (e.g. paste)', async () => {
    const content = 'pasted text'
    const file = new File([content], 'paste.txt', { type: 'text/plain' })
    const invoke = vi.fn().mockResolvedValue({ mode: 'child', url: null, fromEnv: false })
    Object.assign(window, {
      ipc: { invoke },
    })

    const result = await uploadInputFor(file)
    expect(result.filePath).toBeUndefined()
    expect(result.bytes).toBe(btoa(content))
  })

  it('generates base64 payload corresponding to file bytes', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 250, 255])
    const base64 = arrayBufferToBase64(data.buffer)
    const decoded = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    expect(decoded).toEqual(data)
  })
})

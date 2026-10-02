import type { FileViewerSource } from '@/components/file-viewer-source'

export interface LocalFilePreview { url: string; path: string; name: string; size: number; mtimeMs: number }
/** The same read-only viewer contract used by Spaces message attachments. */
export function createLocalFileSource(file: LocalFilePreview): FileViewerSource {
  let bytes: Promise<ArrayBuffer> | undefined
  const readBytes = () => bytes ??= fetch(file.url).then((response) => {
    if (!response.ok) throw new Error('Could not load file')
    return response.arrayBuffer()
  }).catch((error) => { bytes = undefined; throw error })
  const stat = async () => ({ kind: 'file' as const, size: file.size, mtimeMs: file.mtimeMs, ctimeMs: file.mtimeMs })
  return {
    workspace: false, readOnly: true, url: () => file.url, stat,
    read: async ({ path, encoding = 'utf8' }) => {
      const buffer = new Uint8Array(await readBytes())
      let data: string
      if (encoding === 'base64') {
        let binary = ''
        for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000))
        data = btoa(binary)
      } else data = new TextDecoder().decode(buffer)
      return { path, data, encoding, stat: await stat(), etag: String(file.mtimeMs) }
    },
    write: async () => { throw new Error('This preview is read-only.') },
    open: () => window.ipc.invoke('shell:openPath', { path: file.path }),
    exportCopy: async () => {
      const link = document.createElement('a')
      link.href = file.url; link.download = file.name; link.click()
      return { saved: true }
    },
    loadSheet: (args) => window.ipc.invoke('spreadsheet:load', { ...args, path: file.path }),
    findCells: (args) => window.ipc.invoke('spreadsheet:find', { ...args, path: file.path }),
  }
}

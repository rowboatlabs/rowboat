import type { FileViewerSource } from '@/components/file-viewer-source'
import { parseBlobAppUrl } from './spaces-presentation'

/** The original message attachment is immutable, even after it is saved to Files. */
export function createSpaceAttachmentSource(src: string, name: string): FileViewerSource {
  const attachment = parseBlobAppUrl(src)
  if (!attachment) throw new Error('Invalid attachment URL')
  let loaded: Promise<ArrayBuffer> | undefined
  const readBytes = () => loaded ??= fetch(src).then(async (response) => {
    if (!response.ok) throw new Error('Could not load attachment')
    return response.arrayBuffer()
  }).catch((error) => { loaded = undefined; throw error })
  const stat = async () => ({ kind: 'file' as const, size: (await readBytes()).byteLength, mtimeMs: 0, ctimeMs: 0 })
  const download = () => window.ipc.invoke('spaces:saveBlob', { ...attachment, suggestedName: name })
  return {
    workspace: false,
    readOnly: true,
    url: () => src,
    stat,
    read: async ({ path, encoding = 'utf8' }) => {
      const bytes = new Uint8Array(await readBytes())
      let data: string
      if (encoding === 'base64') {
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        data = btoa(binary)
      } else data = new TextDecoder().decode(bytes)
      return { path, encoding, data, stat: await stat(), etag: attachment.hash }
    },
    write: async () => { throw new Error('Save this attachment to Space files to edit it.') },
    open: async () => {
      const result = await download()
      return result.saved && result.path ? window.ipc.invoke('shell:openPath', { path: result.path }) : {}
    },
    exportCopy: async () => { const result = await download(); return { saved: result.saved, dest: result.path } },
    loadSheet: (args) => window.ipc.invoke('spreadsheet:load', { ...args, attachment }),
    findCells: (args) => window.ipc.invoke('spreadsheet:find', { ...args, attachment }),
  }
}

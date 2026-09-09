import type { spaces } from '@x/shared'
import type { FileViewerSource } from '@/components/file-viewer-source'
import { blobAppUrl } from './spaces-presentation'
import { getViewerType } from './file-types'

function base64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

/** One instance per open document; only successful reads/writes advance its edit base. */
export function createSpaceFileSource(
  orgId: string,
  spaceId: string,
  initial: spaces.ReadAssetResult,
  onChanged: () => void,
): FileViewerSource {
  const path = initial.path
  const name = path.split('/').pop() ?? path
  const listeners = new Set<() => void>()
  let snapshot = initial
  const readAsset = () => window.ipc.invoke('spaces:readAsset', { orgId, spaceId, path })
  const statOf = (asset: spaces.ReadAssetResult, size?: number) => ({
    kind: 'file' as const,
    size: size ?? asset.blob?.size ?? new TextEncoder().encode(asset.content).length,
    // Versions are monotonic and identify changes even if timestamps coincide.
    mtimeMs: asset.version,
    ctimeMs: 0,
  })
  const download = async () => {
    const asset = await readAsset()
    if (!asset.blob) throw new Error('This document has no downloadable blob')
    return window.ipc.invoke('spaces:saveBlob', { orgId, spaceId, hash: asset.blob.hash, suggestedName: name })
  }
  return {
    workspace: false,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    notifyChanged: (version) => { if (version !== snapshot.version) for (const listener of listeners) listener() },
    url: () => getViewerType(path) === 'html'
      ? `app://space-document/${[orgId, spaceId, ...path.split('/')].map(encodeURIComponent).join('/')}`
      : initial.blob
      ? blobAppUrl({ orgId, spaceId }, initial.blob.hash)
      : `data:text/html;charset=utf-8,${encodeURIComponent(initial.content)}`,
    read: async ({ encoding = 'utf8' }) => {
      const asset = await readAsset()
      let bytes: Uint8Array
      if (asset.blob) {
        const response = await fetch(blobAppUrl({ orgId, spaceId }, asset.blob.hash))
        if (!response.ok) throw new Error('Could not load document')
        bytes = new Uint8Array(await response.arrayBuffer())
      } else bytes = new TextEncoder().encode(asset.content)
      snapshot = asset
      return { path, encoding, data: encoding === 'base64' ? base64(bytes) : new TextDecoder().decode(bytes), stat: statOf(asset, bytes.length), etag: String(asset.version) }
    },
    write: async ({ data, opts }) => {
      const baseVersion = opts?.expectedEtag !== undefined
        ? Number(opts.expectedEtag)
        : getViewerType(path) === 'pptx' ? (await readAsset()).version : snapshot.version
      const uploaded = await window.ipc.invoke('spaces:uploadBlob', {
        orgId, spaceId, name, bytes: opts?.encoding === 'base64' ? data : base64(new TextEncoder().encode(data)),
        ...(snapshot.blob ? { mime: snapshot.blob.mime } : {}),
      })
      const result = await window.ipc.invoke('spaces:proposeChange', {
        orgId, spaceId,
        input: { assetPath: path, baseVersion, blob: uploaded.blob.hash, reason: `Edit ${name}` },
      })
      if (result.outcome === 'conflict') throw new Error('ETag mismatch: Someone changed this document. Reload to see their changes before saving.')
      snapshot = { ...snapshot, version: result.version, blob: uploaded.blob }
      onChanged()
      return { path, etag: String(result.version), stat: statOf(snapshot) }
    },
    stat: async () => statOf(await readAsset()),
    open: async () => {
      const result = await download()
      return result.saved && result.path ? window.ipc.invoke('shell:openPath', { path: result.path }) : {}
    },
    exportCopy: async () => {
      const result = await download()
      return { saved: result.saved, dest: result.path }
    },
    loadSheet: (args) => window.ipc.invoke('spreadsheet:load', { ...args, space: { orgId, spaceId, version: initial.version } }),
    findCells: (args) => window.ipc.invoke('spreadsheet:find', { ...args, space: { orgId, spaceId, version: initial.version } }),
  }
}

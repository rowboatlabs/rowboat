import { useEffect, useState } from 'react'
import type { spaces } from '@x/shared'
import { DocumentFileViewer } from '@/components/document-file-viewer'
import { FileViewerSourceContext } from '@/components/file-viewer-source'
import { createSpaceFileSource } from '@/lib/space-file-source'

export function SpaceDocumentViewer({ orgId, spaceId, asset, onChanged }: {
  orgId: string
  spaceId: string
  asset: spaces.ReadAssetResult
  onChanged: () => void
}) {
  // Host keys by file identity, preserving editor drafts across version updates.
  const [source] = useState(() => createSpaceFileSource(orgId, spaceId, asset, onChanged))
  useEffect(() => {
    source.notifyChanged?.(asset.version)
  }, [asset.version, source])
  return (
    <FileViewerSourceContext.Provider value={source}>
      <DocumentFileViewer path={asset.path} />
    </FileViewerSourceContext.Provider>
  )
}

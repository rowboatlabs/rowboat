import { getViewerType } from '@/lib/file-types'
import { HtmlFileViewer } from './html-file-viewer'
import { PdfFileViewer } from './pdf-file-viewer'
import { ImageFileViewer } from './image-file-viewer'
import { VideoFileViewer } from './video-file-viewer'
import { AudioFileViewer } from './audio-file-viewer'
import { DocxFileViewer } from './docx-file-viewer'
import { SpreadsheetFileViewer } from './spreadsheet-file-viewer'
import { PptxEditor } from './pptx-editor'
import { UnsupportedFileViewer } from './unsupported-file-viewer'

/** Shared format routing; storage is supplied by FileViewerSourceContext. */
export function DocumentFileViewer({ path, onSlideChange }: {
  path: string
  onSlideChange?: (slideNumber: number, slideCount: number) => void
}) {
  switch (getViewerType(path)) {
    case 'html': return <HtmlFileViewer path={path} />
    case 'pdf': return <PdfFileViewer path={path} />
    case 'image': return <ImageFileViewer path={path} />
    case 'video': return <VideoFileViewer path={path} />
    case 'audio': return <AudioFileViewer path={path} />
    case 'docx': return <DocxFileViewer path={path} />
    case 'spreadsheet': return <SpreadsheetFileViewer path={path} />
    case 'pptx': return <PptxEditor key={path} path={path} onSlideChange={onSlideChange} />
    default: return <UnsupportedFileViewer path={path} />
  }
}

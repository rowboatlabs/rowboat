export interface ActiveMarkdownExternalChangeOptions {
  path: string
  getSelectedPath: () => string | null
  getEditorPath: () => string | null
  getEditorContent: () => string
  getBaseline: () => string | undefined
  getDocumentRevision: () => number
  invalidateCache: () => void
  beginRequest: () => number
  isCurrentRequest: (requestId: number) => boolean
  readFile: () => Promise<{ data: string }>
  getDiskEditorContent: (data: string) => string
  applyReload: (data: string) => void
  applyUnchangedReload: (data: string) => void
  onReadError: (error: unknown) => void
}

export interface StableExternalReadOptions<T> {
  getExternalRevision: () => number
  isCurrent: () => boolean
  readFile: () => Promise<T>
}

/**
 * Read a file for initial hydration, repeating the read when a workspace event
 * arrives before the previous snapshot can be applied. This keeps the normal
 * loader authoritative without losing changes reported while it is in flight.
 */
export async function readFileAfterExternalChangesSettle<T>(
  options: StableExternalReadOptions<T>,
): Promise<T | undefined> {
  let observedRevision = options.getExternalRevision()

  while (true) {
    const result = await options.readFile()
    if (!options.isCurrent()) return undefined

    const latestRevision = options.getExternalRevision()
    if (latestRevision === observedRevision) return result
    observedRevision = latestRevision
  }
}

/**
 * Reload a clean active Markdown file after the workspace watcher reports an
 * external change. Selection is checked again after the asynchronous read so
 * a late response cannot overwrite whichever file the user switched to.
 */
export async function reloadCleanActiveMarkdownAfterExternalChange(
  options: ActiveMarkdownExternalChangeOptions,
): Promise<void> {
  const {
    path,
    getSelectedPath,
    getEditorPath,
    getEditorContent,
    getBaseline,
    getDocumentRevision,
    invalidateCache,
    beginRequest,
    isCurrentRequest,
    readFile,
    getDiskEditorContent,
    applyReload,
    applyUnchangedReload,
    onReadError,
  } = options

  // Do not let a watcher take over hydration for a newly selected file. Until
  // both the editor and its path-specific baseline belong to this path, the
  // normal loader remains the sole owner of the read.
  if (getSelectedPath() !== path || getEditorPath() !== path) return
  const contentAtStart = getEditorContent()
  const baselineAtStart = getBaseline()
  if (baselineAtStart === undefined) return
  const documentRevisionAtStart = getDocumentRevision()

  // Every watcher event for a hydrated file advances the shared request
  // generation, including events received while the editor is dirty. That
  // makes a dirty event a cancellation barrier for any older read in flight.
  const requestId = beginRequest()
  if (contentAtStart !== baselineAtStart) return

  invalidateCache()

  let result: { data: string }
  try {
    result = await readFile()
  } catch (error) {
    onReadError(error)
    return
  }

  if (!isCurrentRequest(requestId)) return
  if (getSelectedPath() !== path) return
  if (getEditorPath() !== path) return
  if (getDocumentRevision() !== documentRevisionAtStart) return
  if (getBaseline() !== baselineAtStart) return
  if (getEditorContent() !== baselineAtStart) return

  if (getDiskEditorContent(result.data) === contentAtStart) {
    applyUnchangedReload(result.data)
  } else {
    applyReload(result.data)
  }
}

import { createContext, useContext } from 'react'
import type { ipc } from '@x/shared'

type Channel<K extends keyof ipc.IPCChannels> = (args: ipc.IPCChannels[K]['req']) => Promise<ipc.IPCChannels[K]['res']>

/** Storage operations shared by workspace and space document viewers. */
export interface FileViewerSource {
  url: (path: string) => string
  read: Channel<'workspace:readFile'>
  write: Channel<'workspace:writeFile'>
  stat: Channel<'workspace:stat'>
  open: Channel<'shell:openPath'>
  exportCopy: Channel<'workspace:exportCopy'>
  loadSheet: Channel<'spreadsheet:load'>
  findCells: Channel<'spreadsheet:find'>
  subscribe?: (listener: () => void) => () => void
  notifyChanged?: (version: number) => void
  workspace: boolean
}

const workspaceSource: FileViewerSource = {
  url: (path) => `app://workspace/${path.split('/').map(encodeURIComponent).join('/')}`,
  read: (args) => window.ipc.invoke('workspace:readFile', args),
  write: (args) => window.ipc.invoke('workspace:writeFile', args),
  stat: (args) => window.ipc.invoke('workspace:stat', args),
  open: (args) => window.ipc.invoke('shell:openPath', args),
  exportCopy: (args) => window.ipc.invoke('workspace:exportCopy', args),
  loadSheet: (args) => window.ipc.invoke('spreadsheet:load', args),
  findCells: (args) => window.ipc.invoke('spreadsheet:find', args),
  workspace: true,
}

export const FileViewerSourceContext = createContext<FileViewerSource>(workspaceSource)
export const useFileViewerSource = () => useContext(FileViewerSourceContext)

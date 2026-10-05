import { toast } from 'sonner'

// BAARALI(05/10/2026): a folder or file picked on the computer, made readable
// where the core runs. Joined to its Baarali space, the app's core is there,
// not on the computer: the folder is copied to the space first (main
// files:toInstance), which takes a moment for a big one. Elsewhere the same
// paths come back at once.

/** The paths to hand over; throws with a message for the person when refused. */
export async function toInstance(paths: string[], into: 'projects' | 'attachments'): Promise<string[]> {
  if (paths.length === 0) return paths
  const sending = into === 'projects' ? 'Sending the folder to your Baarali space…' : 'Sending the file to your Baarali space…'
  // Shown only if it takes a while: on the computer's own core it is instant.
  const slow = window.setTimeout(() => toast.loading(sending, { id: 'baarali-to-instance' }), 400)
  try {
    const result = await window.ipc.invoke('files:toInstance', { paths, into })
    const left = result.skipped.length
    if (left === 1) toast.info('A large file was left on your computer (25 MB at most per file).')
    else if (left > 1) toast.info(`${left} large files were left on your computer (25 MB at most per file).`)
    return result.paths
  } catch (err) {
    // Electron wraps the main process's message: keep only what it says.
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, ''))
  } finally {
    window.clearTimeout(slow)
    toast.dismiss('baarali-to-instance')
  }
}

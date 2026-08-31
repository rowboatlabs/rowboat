/**
 * Upload input for spaces:uploadBlob. Paste gives bytes; drag-drop and the
 * picker give a real path (read from disk where core runs). Bytes go as
 * base64: the channel crosses a JSON RPC boundary to the server, where an
 * ArrayBuffer would silently stringify to '{}' and upload an empty blob.
 */
export async function uploadInputFor(file: File): Promise<{ bytes?: string; filePath?: string }> {
  const filePath = window.electronUtils?.getPathForFile?.(file)
  if (filePath) return { filePath }
  return { bytes: arrayBufferToBase64(await file.arrayBuffer()) }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

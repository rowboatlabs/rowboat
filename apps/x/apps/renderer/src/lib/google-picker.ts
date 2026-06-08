// Loader + thin wrapper around the Google Picker JS API. File selection happens
// inside Google's hosted Picker (so the app needs only drive.file, not a broad
// listing scope); the Picker hands back the chosen file id.

export type PickedFile = { id: string; name: string; mimeType: string }

type GapiGlobal = {
  load: (lib: string, config: { callback: () => void; onerror?: () => void }) => void
}

type PickerView = {
  setIncludeFolders: (b: boolean) => PickerView
  setOwnedByMe: (b: boolean) => PickerView
  setMimeTypes: (m: string) => PickerView
}

type PickerCallbackData = {
  action: string
  docs?: Array<{ id: string; name: string; mimeType: string }>
}

type PickerBuilder = {
  addView: (v: PickerView) => PickerBuilder
  setOrigin: (o: string) => PickerBuilder
  setOAuthToken: (t: string) => PickerBuilder
  setDeveloperKey: (k: string) => PickerBuilder
  setAppId: (id: string) => PickerBuilder
  setTitle: (t: string) => PickerBuilder
  setCallback: (cb: (data: PickerCallbackData) => void) => PickerBuilder
  build: () => { setVisible: (v: boolean) => void }
}

type GooglePickerNS = {
  DocsView: new () => PickerView
  PickerBuilder: new () => PickerBuilder
  Action: { PICKED: string; CANCEL: string }
}

declare global {
  interface Window {
    gapi?: GapiGlobal
    google?: { picker?: GooglePickerNS }
  }
}

const API_JS = 'https://apis.google.com/js/api.js'
const DOC_MIME = 'application/vnd.google-apps.document'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const API_KEY_STORAGE = 'rowboat:google-picker-api-key'

let pickerLoaded: Promise<void> | null = null

function loadPickerApi(): Promise<void> {
  if (pickerLoaded) return pickerLoaded
  pickerLoaded = new Promise<void>((resolve, reject) => {
    const start = () => {
      if (!window.gapi) { reject(new Error('Google API failed to initialize')); return }
      window.gapi.load('picker', {
        callback: () => resolve(),
        onerror: () => reject(new Error('Google Picker failed to load')),
      })
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${API_JS}"]`)
    if (existing) {
      if (window.gapi) start()
      else existing.addEventListener('load', start)
      return
    }
    const script = document.createElement('script')
    script.src = API_JS
    script.async = true
    script.onload = start
    script.onerror = () => reject(new Error('Failed to load the Google API script'))
    document.head.appendChild(script)
  })
  return pickerLoaded
}

export function getStoredPickerApiKey(): string {
  try { return localStorage.getItem(API_KEY_STORAGE) ?? '' } catch { return '' }
}

export function setStoredPickerApiKey(key: string): void {
  try { localStorage.setItem(API_KEY_STORAGE, key.trim()) } catch { /* ignore */ }
}

export async function openGooglePicker(opts: {
  accessToken: string
  apiKey?: string
  appId?: string
  onPicked: (file: PickedFile) => void
  onCancel?: () => void
}): Promise<void> {
  await loadPickerApi()
  const picker = window.google?.picker
  if (!picker) throw new Error('Google Picker is unavailable')

  const view = new picker.DocsView()
    .setIncludeFolders(false)
    .setMimeTypes(`${DOC_MIME},${DOCX_MIME}`)

  const builder = new picker.PickerBuilder()
    .addView(view)
    .setOrigin(window.location.protocol + '//' + window.location.host)
    .setOAuthToken(opts.accessToken)
    .setTitle('Choose a document to sync')
    .setCallback((data) => {
      if (data.action === picker.Action.PICKED && data.docs?.[0]) {
        const d = data.docs[0]
        opts.onPicked({ id: d.id, name: d.name, mimeType: d.mimeType })
      } else if (data.action === picker.Action.CANCEL) {
        opts.onCancel?.()
      }
    })
  if (opts.apiKey) builder.setDeveloperKey(opts.apiKey)
  if (opts.appId) builder.setAppId(opts.appId)
  builder.build().setVisible(true)
}

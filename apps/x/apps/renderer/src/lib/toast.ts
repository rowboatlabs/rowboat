import { toast as sonner } from 'sonner'

// The app's short notices, drawn by sonner, whose <Toaster /> both apps
// mount (App.tsx on the desktop, web/app.tsx in the browser). Until
// 2026-10-15 this kept its own list that nothing rendered, so about 250
// calls, every "Could not join" and "Copied" among them, were silent.
// An identical message replaces the one already showing instead of
// stacking, so a dialog that checks as you type says a thing once.

type ToastType = 'success' | 'error' | 'info'

/** `duration` in ms: how long it shows; sonner's default when absent. */
export function toast(message: string, type: ToastType = 'info', duration?: number): void {
    const options = { id: `${type}:${message}`, ...(duration ? { duration } : {}) }
    if (type === 'success') sonner.success(message, options)
    else if (type === 'error') sonner.error(message, options)
    else sonner(message, options)
}

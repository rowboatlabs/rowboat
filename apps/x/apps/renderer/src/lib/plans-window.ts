// The plans window (components/plans-dialog.tsx) is mounted once, in App.
// Every "Upgrade" in the app asks for it here (Baarali, 02/10/2026): the
// account lives in the app, so choosing a plan no longer opens the site in a
// browser, where the person was not signed in.

let open = false
const listeners = new Set<() => void>()

export function openPlans(): void {
    open = true
    for (const l of listeners) l()
}

export function closePlans(): void {
    open = false
    for (const l of listeners) l()
}

export function isPlansOpen(): boolean {
    return open
}

export function subscribePlans(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

import { useSyncExternalStore } from 'react'
let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
function subscribe(listener: () => void) {
    now = Date.now()
    listeners.add(listener)
    if (!timer) timer = setInterval(() => { now = Date.now(); for (const notify of listeners) notify() }, 1000)
    return () => { listeners.delete(listener); if (!listeners.size) { clearInterval(timer); timer = undefined } }
}
export function useAvailabilityClock() { return useSyncExternalStore(subscribe, () => now) }

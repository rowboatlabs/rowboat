import { createContext, useContext } from 'react'

export const OpenBrowserContext = createContext<(() => void) | null>(null)

export function useOpenBrowser() {
  return useContext(OpenBrowserContext)
}

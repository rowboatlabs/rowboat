// Mini Apps registry.
//
// Phase 1: apps are hardcoded here. Later phases replace this with apps loaded
// from ~/.rowboat/apps/<id>/ over IPC.

import type { MiniApp } from './types'
import { twitterClientApp } from './apps/twitter-client'
import { newsletterDigestApp, competitorWatchApp } from './apps/digests'

export const MINI_APPS: MiniApp[] = [twitterClientApp, newsletterDigestApp, competitorWatchApp]

export function getMiniApp(id: string): MiniApp | undefined {
  return MINI_APPS.find((app) => app.id === id)
}

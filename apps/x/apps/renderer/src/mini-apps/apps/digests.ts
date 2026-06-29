// Two simple digest-style sample Mini Apps (Newsletter Digest, Competitor Watch).
// They share the list template in ./simple-list and exist mainly so the gallery
// shows the card design across several apps with different accent themes.

import type { MiniApp } from '../types'
import { buildSimpleListHtml } from './simple-list'

export const newsletterDigestApp: MiniApp = {
  id: 'newsletter-digest',
  name: 'Newsletter Digest',
  description: 'Summarises your subscriptions into a single skimmable morning read.',
  source: 'Email',
  active: true,
  lastRun: '1h ago',
  scope: ['gmail'],
  data: {
    title: 'Newsletter Digest',
    subtitle: 'Your subscriptions, summarised — 6 this morning',
    items: [
      { id: 'n1', title: 'Stratechery', meta: '7 min', body: 'The platform shift to agents mirrors the mobile transition — distribution, not models, decides the winners.' },
      { id: 'n2', title: 'Lenny’s Newsletter', meta: '5 min', body: 'How three PMs run discovery without a researcher: weekly user calls, a shared notes doc, and ruthless prioritisation.' },
      { id: 'n3', title: 'The Pragmatic Engineer', meta: '9 min', body: 'Inside a staff-level promo packet: scope, impact, and the "without you it wouldn’t have happened" test.' },
    ],
  },
  html: buildSimpleListHtml('Newsletter Digest'),
}

export const competitorWatchApp: MiniApp = {
  id: 'competitor-watch',
  name: 'Competitor Watch',
  description: 'Tracks launches, pricing changes, and notable posts from your rivals.',
  source: 'Web',
  active: false,
  lastRun: '4h ago',
  scope: ['web'],
  data: {
    title: 'Competitor Watch',
    subtitle: '3 updates since yesterday',
    items: [
      { id: 'c1', title: 'Acme launched AI Mode', meta: 'pricing', body: 'New $40/mo tier bundles their assistant; older Pro plan unchanged. Positioning leans on “team workspaces”.' },
      { id: 'c2', title: 'Globex changelog', meta: 'product', body: 'Shipped offline sync and a public API. Docs hint at a desktop app in private beta.' },
      { id: 'c3', title: 'Initech blog', meta: 'content', body: 'A “build vs buy” post aimed squarely at your ICP — worth a counter-piece on local-first privacy.' },
    ],
  },
  html: buildSimpleListHtml('Competitor Watch'),
}

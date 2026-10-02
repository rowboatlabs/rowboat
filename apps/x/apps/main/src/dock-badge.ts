import { app } from 'electron';

// The renderer owns unread state. Keep its last badge when the window closes;
// the next renderer replaces it as its unread snapshot loads.
let spacesBadge = '';
let updateReady = false;

function refreshDockBadge(): void {
  if (process.platform === 'darwin') {
    // Unread activity takes priority; an update remains visible once caught up.
    app.dock?.setBadge(spacesBadge || (updateReady ? '1' : ''));
  }
}

export function setSpacesDockBadge({ unread, forYou }: { unread: number; forYou: number }): void {
  spacesBadge = forYou > 0 ? String(forYou) : unread > 0 ? '•' : '';
  refreshDockBadge();
}

export function setDockUpdateReady(): void {
  updateReady = true;
  refreshDockBadge();
}

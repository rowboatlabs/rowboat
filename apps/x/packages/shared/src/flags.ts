// Feature flags, sourced from environment variables.
//
// Spaces ships dark: the whole UI (sidebar section, view, notification
// category, mention watcher) is gated on ROWBOAT_SPACES so the branch can
// merge and release while the feature stays internal. The backend surface
// (spaces IPC, core client, org credentials) stays live and tested — only
// the doors are locked. Because the packaged app merges the login shell's
// environment at boot, `export ROWBOAT_SPACES=1` in ~/.zshrc enables it
// without a terminal launch.

export function spacesEnabled(env: Record<string, string | undefined>): boolean {
  const v = env.ROWBOAT_SPACES;
  return v === '1' || v === 'true';
}

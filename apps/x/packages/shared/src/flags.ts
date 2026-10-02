// Spaces is part of the default product experience. Keep this helper so the
// preload-to-renderer feature-flags bridge remains consistent as other flags
// are added.
export function spacesEnabled(): boolean {
  return true;
}

// Spaces-only (2026-10-02, spaces-only flag PR): the app ships as Spaces and
// nothing else — the Spaces rail is the whole sidebar, every other section,
// its settings and its background services stay off. Read from the main
// process environment (the packaged app merges the login shell's, so
// `export ROWBOAT_SPACES_ONLY=1` in ~/.zshrc works without a terminal launch).
export function spacesOnly(env: Record<string, string | undefined>): boolean {
  const v = env.ROWBOAT_SPACES_ONLY;
  return v === '1' || v === 'true';
}

// Shared by both desktop processes: installed apps do not inherit CI's env.
export function desktopBundleDefines(appVersion) {
  return {
    'process.env.POSTHOG_KEY': JSON.stringify(process.env.VITE_PUBLIC_POSTHOG_KEY ?? ''),
    'process.env.POSTHOG_HOST': JSON.stringify(process.env.VITE_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'),
    'process.env.ROWBOAT_APP_VERSION': JSON.stringify(appVersion ?? ''),
  };
}

export function childServerBundleOptions(appVersion) {
  return {
    entryPoints: ['../server/dist/standalone.js'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: './.package/dist/rowboat-server.cjs',
    // Core modules resolve asset paths through import.meta.url at module init.
    banner: { js: `var __import_meta_url = require('url').pathToFileURL(__filename).href;` },
    define: {
      'import.meta.url': '__import_meta_url',
      ...desktopBundleDefines(appVersion),
    },
    external: ['electron', 'node-pty', 'uiohook-napi', 'bun:sqlite'],
  };
}

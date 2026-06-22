// Electron Forge config file
// NOTE: Must be .cjs (CommonJS) because package.json has "type": "module"
// Forge loads configs with require(), which fails on ESM files

const path = require('path');
const pkg = require('./package.json');

// Stage the ACP coding-adapters (@agentclientprotocol/*-acp) and their full
// production dependency closure into the packaged app.
//
// Why this is needed: code mode spawns each adapter as a SEPARATE `node <entry>`
// process and locates it at runtime via require.resolve — so it must ship as a real
// on-disk file. esbuild can't inline it (dynamic resolve + spawn target), and Forge
// strips the workspace node_modules (see `ignore` below). Without this, packaged
// builds throw `Cannot find module '@agentclientprotocol/...'`.
//
// Why we reconstruct a nested tree instead of copying node_modules: pnpm's store is a
// symlink farm that legitimately holds multiple versions of the same package (e.g.
// @agentclientprotocol/sdk 0.21 for claude vs 0.22 for codex). We rebuild an npm-style
// nested node_modules — dereferencing symlinks and nesting on version conflict — which
// resolves correctly regardless of pnpm layout.
//
// What we DON'T bundle: the agents' native engines (claude / codex, ~200 MB each, shipped
// as platform-specific packages). Those are PROVISIONED on demand into
// ~/.rowboat/engines/<agent>/<version>/ and the adapters are pointed at them via
// CLAUDE_CODE_EXECUTABLE / CODEX_PATH (see packages/core/src/code-mode/acp/). Skipping
// them keeps each OS installer ~400 MB smaller while code mode stays fully functional.
function stageAcpAdapters(mainDir, destNodeModules) {
    const fs = require('fs');
    const ADAPTERS = [
        '@agentclientprotocol/claude-agent-acp',
        '@agentclientprotocol/codex-acp',
    ];

    // The native engines, shipped as platform packages. Provisioned on demand instead
    // (see comment above), so they're excluded from staging.
    const isNativeEngine = (key) =>
        /^@anthropic-ai\/claude-agent-sdk-(win32|darwin|linux)/.test(key) || // native claude
        /^@openai\/codex-(win32|darwin|linux)/.test(key);                    // native codex

    // Resolve a dependency's real directory by walking node_modules the way Node does,
    // looking for the package DIRECTORY. We deliberately do NOT use
    // require.resolve(`${key}/package.json`): that throws for packages whose `exports`
    // map doesn't expose package.json (e.g. @anthropic-ai/claude-agent-sdk), which would
    // silently drop them and their subtrees. realpathSync dereferences pnpm's symlinks.
    // Returns null for deps not installed for this OS (platform-optional binaries).
    const realDirOf = (key, fromDir) => {
        let dir = fromDir;
        for (;;) {
            const cand = path.join(dir, 'node_modules', ...key.split('/'));
            if (fs.existsSync(path.join(cand, 'package.json'))) return fs.realpathSync(cand);
            const parent = path.dirname(dir);
            if (parent === dir) return null;
            dir = parent;
        }
    };

    let copied = 0;
    const skippedEngines = new Set();
    const install = (srcDir, key, destNM, chain) => {
        const destDir = path.join(destNM, ...key.split('/'));
        if (fs.existsSync(destDir)) return; // already placed at this exact location
        if (chain.has(srcDir)) return;      // dependency cycle — resolves to ancestor copy
        fs.mkdirSync(path.dirname(destDir), { recursive: true });
        fs.cpSync(srcDir, destDir, {
            recursive: true,
            dereference: true,
            filter: (s) => path.basename(s) !== 'node_modules', // deps handled by recursion
        });
        copied++;
        const pj = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8'));
        const deps = { ...pj.dependencies, ...pj.optionalDependencies };
        const nextChain = new Set(chain).add(srcDir);
        for (const depKey of Object.keys(deps)) {
            if (isNativeEngine(depKey)) { skippedEngines.add(depKey); continue; }
            const depDir = realDirOf(depKey, srcDir);
            if (depDir) install(depDir, depKey, path.join(destDir, 'node_modules'), nextChain);
        }
    };

    for (const key of ADAPTERS) {
        const srcDir = realDirOf(key, mainDir);
        if (!srcDir) {
            throw new Error(`ACP adapter '${key}' is not installed in ${mainDir} — run pnpm install`);
        }
        install(srcDir, key, destNodeModules, new Set());
    }
    if (skippedEngines.size) {
        console.log(`  (skipped native engines — provisioned on demand: ${[...skippedEngines].join(', ')})`);
    }
    return copied;
}

module.exports = {
    packagerConfig: {
        executableName: 'rowboat',
        icon: './icons/icon',  // .icns extension added automatically
        appBundleId: 'com.rowboat.app',
        appCategoryType: 'public.app-category.productivity',
        protocols: [
            { name: 'Rowboat', schemes: ['rowboat'] },
        ],
        extendInfo: {
            NSAudioCaptureUsageDescription: 'Rowboat needs access to system audio to transcribe meetings from other apps (Zoom, Meet, etc.)',
        },
        osxSign: {
            batchCodesignCalls: true,
            optionsForFile: () => ({
                entitlements: path.join(__dirname, 'entitlements.plist'),
                'entitlements-inherit': path.join(__dirname, 'entitlements.plist'),
            }),
        },
        osxNotarize: {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID
        },
        // Since we bundle the main process with esbuild, we don't need the workspace
        // node_modules. These settings prevent Forge's dependency walker (flora-colossus)
        // from trying to analyze/copy node_modules, which fails with pnpm's symlinked
        // workspaces.
        prune: false,
        // Strip the workspace src/node_modules (paths are ANCHORED to the app root), BUT
        // always keep everything under `.package/` — that's our staged output: the
        // bundled main process, the ACP adapters + their dependency closure (staged by
        // the generateAssets hook), and the native node-pty module (staged into
        // .package/node_modules by bundle.mjs). Without the `.package` exemption the
        // node_modules rule would strip those and code mode / the embedded terminal
        // would break in packaged builds.
        ignore: (p) => {
            if (p === '/.package' || p.startsWith('/.package/')) return false;
            return [/^\/src\//, /^\/node_modules\//, /\.gitignore/, /bundle\.mjs/, /tsconfig\.json/]
                .some((re) => re.test(p));
        },
    },
    makers: [
        {
            name: '@electron-forge/maker-dmg',
            config: (arch) => ({
                format: 'ULFO',
                name: `Rowboat-darwin-${arch}-${pkg.version}`,  // Architecture-specific name to avoid conflicts
            })
        },
        {
            name: '@electron-forge/maker-squirrel',
            config: (arch) => ({
                authors: 'rowboatlabs',
                description: 'AI coworker with memory',
                name: `Rowboat-win32-${arch}`,
                setupExe: `Rowboat-win32-${arch}-${pkg.version}-setup.exe`,
                setupIcon: path.join(__dirname, 'icons/icon.ico'),
            })
        },
        {
            name: '@electron-forge/maker-deb',
            config: (arch) => ({
                options: {
                    name: `Rowboat-linux`,
                    bin: "rowboat",
                    description: 'AI coworker with memory',
                    maintainer: 'rowboatlabs',
                    homepage: 'https://rowboatlabs.com',
                    icon: path.join(__dirname, 'icons/icon.png'),
                    mimeType: ['x-scheme-handler/rowboat'],
                }
            })
        },
        {
            name: '@electron-forge/maker-rpm',
            config: {
                options: {
                    name: `Rowboat-linux`,
                    bin: "rowboat",
                    description: 'AI coworker with memory',
                    homepage: 'https://rowboatlabs.com',
                    icon: path.join(__dirname, 'icons/icon.png'),
                    mimeType: ['x-scheme-handler/rowboat'],
                }
            }
        },
        {
            name: require.resolve('./makers/maker-pacman.cjs'),
            platforms: ['linux'],
            config: {
                name: 'rowboat',
                bin: 'rowboat',
                executableName: 'rowboat',
                description: 'AI coworker with memory',
                maintainer: 'rowboatlabs',
                homepage: 'https://rowboatlabs.com',
                license: 'Apache',
                icon: path.join(__dirname, 'icons/icon.png'),
                mimeType: ['x-scheme-handler/rowboat'],
            }
        },
        {
            name: '@electron-forge/maker-zip',
            platform: ["darwin", "win32", "linux"],
        }
    ],
    publishers: [
        {
            name: '@electron-forge/publisher-github',
            config: {
                repository: {
                    owner: 'rowboatlabs',
                    name: 'rowboat'
                },
                prerelease: true
            }
        }
    ],
    hooks: {
        // Hook signature: (forgeConfig, platform, arch)
        // Note: Console output only shows if DEBUG or CI env vars are set
        generateAssets: async (forgeConfig, platform, arch) => {
            const { execSync } = require('child_process');
            const fs = require('fs');

            const packageDir = path.join(__dirname, '.package');

            // Clean staging directory (ensures fresh build every time)
            console.log('Cleaning staging directory...');
            if (fs.existsSync(packageDir)) {
                fs.rmSync(packageDir, { recursive: true });
            }
            fs.mkdirSync(packageDir, { recursive: true });

            // Build order matters! Dependencies must be built before dependents:
            // shared → core → (renderer, preload, main)

            // Build shared (TypeScript compilation) - no dependencies
            console.log('Building shared...');
            execSync('pnpm run build', {
                cwd: path.join(__dirname, '../../packages/shared'),
                stdio: 'inherit'
            });

            // Build core (TypeScript compilation) - depends on shared
            console.log('Building core...');
            execSync('pnpm run build', {
                cwd: path.join(__dirname, '../../packages/core'),
                stdio: 'inherit'
            });

            // Build renderer (Vite build) - depends on shared
            console.log('Building renderer...');
            execSync('pnpm run build', {
                cwd: path.join(__dirname, '../renderer'),
                stdio: 'inherit'
            });

            // Build preload (TypeScript compilation) - depends on shared
            console.log('Building preload...');
            execSync('pnpm run build', {
                cwd: path.join(__dirname, '../preload'),
                stdio: 'inherit'
            });

            // Build main (TypeScript compilation) - depends on core, shared
            console.log('Building main (tsc)...');
            execSync('pnpm run build', {
                cwd: __dirname,
                stdio: 'inherit'
            });

            // Bundle main process with esbuild (inlines all dependencies)
            console.log('Bundling main process...');
            execSync('node bundle.mjs', {
                cwd: __dirname,
                stdio: 'inherit'
            });

            // Copy preload dist into staging directory
            console.log('Copying preload...');
            const preloadSrc = path.join(__dirname, '../preload/dist');
            const preloadDest = path.join(packageDir, 'preload/dist');
            fs.mkdirSync(preloadDest, { recursive: true });
            fs.cpSync(preloadSrc, preloadDest, { recursive: true });

            // Copy renderer dist into staging directory
            console.log('Copying renderer...');
            const rendererSrc = path.join(__dirname, '../renderer/dist');
            const rendererDest = path.join(packageDir, 'renderer/dist');
            fs.mkdirSync(rendererDest, { recursive: true });
            fs.cpSync(rendererSrc, rendererDest, { recursive: true });

            // Stage the ACP coding-adapters (+ their JS dependency closure, minus native
            // engines) into .package/acp/node_modules. They are spawned as separate node
            // processes at runtime and Forge strips the workspace node_modules, so they
            // must be copied in explicitly. See stageAcpAdapters() above for the why.
            console.log('Staging ACP adapters...');
            const acpDest = path.join(packageDir, 'acp', 'node_modules');
            const staged = stageAcpAdapters(__dirname, acpDest);
            console.log(`✅ Staged ${staged} ACP adapter packages into .package/acp/node_modules`);

            console.log('✅ All assets staged in .package/');
        },
    }
};
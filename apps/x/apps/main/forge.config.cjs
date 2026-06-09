// Electron Forge config file
// NOTE: Must be .cjs (CommonJS) because package.json has "type": "module"
// Forge loads configs with require(), which fails on ESM files

const path = require('path');
const pkg = require('./package.json');

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
        // Since we bundle everything with esbuild, we don't need node_modules at all.
        // These settings prevent Forge's dependency walker (flora-colossus) from trying
        // to analyze/copy node_modules, which fails with pnpm's symlinked workspaces.
        // Regexes are ANCHORED to the app root: .package/node_modules (where
        // bundle.mjs stages the native node-pty module) must survive packaging.
        prune: false,
        // Keep .package/node_modules (staged native modules: node-pty and
        // better-sqlite3) — everything else under those rules is pruned.
        ignore: (file) => {
            const normalized = file.split(path.sep).join('/');
            if (normalized.includes('/.package/node_modules/')) return false;
            return [
                /\/src\//,
                /\/node_modules\//,
                /\.gitignore$/,
                /\/bundle\.mjs$/,
                /\/tsconfig\.json$/,
            ].some((pattern) => pattern.test(normalized));
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

            // Copy native runtime dependencies that cannot be bundled by esbuild.
            console.log('Copying native runtime dependencies...');
            const stagedNodeModules = path.join(packageDir, 'node_modules');
            fs.mkdirSync(stagedNodeModules, { recursive: true });
            fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
                name: `${pkg.name}-native-runtime`,
                version: pkg.version,
                private: true,
                dependencies: {
                    'better-sqlite3': require(require.resolve('better-sqlite3/package.json', {
                        paths: [path.join(__dirname, '../../packages/core')],
                    })).version,
                },
            }, null, 2));
            const copyRuntimePackage = (packageName) => {
                const packageJsonPath = require.resolve(`${packageName}/package.json`, {
                    paths: [path.join(__dirname, '../../packages/core')],
                });
                const packageSrc = path.dirname(packageJsonPath);
                const packageDest = path.join(stagedNodeModules, packageName);
                fs.rmSync(packageDest, { recursive: true, force: true });
                fs.cpSync(packageSrc, packageDest, { recursive: true });
            };
            for (const packageName of ['better-sqlite3', 'bindings', 'file-uri-to-path']) {
                copyRuntimePackage(packageName);
            }
            const { rebuild } = require(path.join(__dirname, '../../node_modules/.pnpm/node_modules/@electron/rebuild'));
            const electronVersion = require(require.resolve('electron/package.json', { paths: [__dirname] })).version;
            await rebuild({
                buildPath: packageDir,
                electronVersion,
                platform,
                arch,
                onlyModules: ['better-sqlite3'],
                force: true,
                buildFromSource: true,
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

            console.log('✅ All assets staged in .package/');
        },
    }
};

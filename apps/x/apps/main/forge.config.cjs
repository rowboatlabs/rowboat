// Electron Forge config file
// NOTE: Must be .cjs (CommonJS) because package.json has "type": "module"
// Forge loads configs with require(), which fails on ESM files

const path = require('path');

module.exports = {
    packagerConfig: {
        name: 'Rowboat',
        executableName: 'rowboat',
        icon: './icons/icon',  // .icns extension added automatically
        appBundleId: 'com.rowboat.app',
        appCategoryType: 'public.app-category.productivity',
        osxSign: {
            batchCodesignCalls: true,
        },
        osxNotarize: {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID
        },
        // NOTE: Electron Forge ignores packagerConfig.dir and always packages from the
        // config file's directory. We use packageAfterCopy hook instead to customize output.
        // dir: path.join(__dirname, '.package'),  // Not supported by Forge
        // Since we bundle everything with esbuild, we don't need node_modules at all.
        // These settings prevent Forge's dependency walker (flora-colossus) from trying
        // to analyze/copy node_modules, which fails with pnpm's symlinked workspaces.
        prune: false,
        ignore: [
            /src\//,
            /node_modules\//,
            /.gitignore/,
            /bundle\.mjs/,
            /tsconfig.json/,
        ],
    },
    makers: [
        {
            name: '@electron-forge/maker-dmg',
            config: (arch) => ({
                format: 'ULFO',
                name: `Rowboat-${arch}`,  // Architecture-specific name to avoid conflicts
            })
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: ['darwin'],
            // ZIP is used by Squirrel.Mac for auto-updates
            config: (arch) => ({
                // Path must match S3 publisher's folder structure: releases/darwin/{arch}
                macUpdateManifestBaseUrl: `https://rowboat-desktop-app-releases.s3.amazonaws.com/releases/darwin/${arch}`
            })
        }
    ],
    publishers: [
        {
            name: '@electron-forge/publisher-s3',
            config: {
                bucket: 'rowboat-desktop-app-releases',
                region: 'us-east-1',
                public: true,
                folder: 'releases'  // Creates structure: releases/darwin/{arch}/files (separate builds for arm64 and x64)
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

            console.log('✅ All assets staged in .package/');
        },
    }
};
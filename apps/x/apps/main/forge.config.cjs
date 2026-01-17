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
        // Since we bundle everything with esbuild, we don't need node_modules at all.
        // These settings prevent Forge's dependency walker (flora-colossus) from trying
        // to analyze/copy node_modules, which fails with pnpm's symlinked workspaces.
        prune: false,
        ignore: [
            // Skip any node_modules that might exist
            /node_modules/,
            // Skip source files
            /\.ts$/,
            /\.tsx$/,
            // Skip the staging directory
            /\.package/,
            // Skip the bundle script
            /bundle\.mjs$/,
        ],
    },
    makers: [
        {
            name: '@electron-forge/maker-dmg',
            config: {
                format: 'ULFO',
                name: 'Rowboat',
            }
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: ['darwin'],
            // ZIP is used by Squirrel.Mac for auto-updates
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

            // Build shared (TypeScript compilation)
            console.log('Building shared...');
            execSync('pnpm run build', {
                cwd: path.join(__dirname, '../../packages/shared'),
                stdio: 'inherit'
            });

            // Build renderer (Vite build)
            console.log('Building renderer...');
            execSync('pnpm run build', {
                cwd: path.join(__dirname, '../renderer'),
                stdio: 'inherit'
            });

            // Build preload (TypeScript compilation)
            console.log('Building preload...');
            execSync('pnpm run build', {
                cwd: path.join(__dirname, '../preload'),
                stdio: 'inherit'
            });

            // Build main (TypeScript compilation)
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

            // Copy icons into staging directory
            console.log('Copying icons...');
            const iconsSrc = path.join(__dirname, 'icons');
            const iconsDest = path.join(packageDir, 'icons');
            if (fs.existsSync(iconsSrc)) {
                fs.mkdirSync(iconsDest, { recursive: true });
                fs.cpSync(iconsSrc, iconsDest, { recursive: true });
            }

            // Generate package.json in staging directory
            // This tells Electron where to find the entry point
            // Note: No "type": "module" since we bundle as CommonJS for compatibility
            // with dependencies that use dynamic require()
            const packageJson = {
                name: '@x/main',
                version: '0.1.0',
                main: 'dist-bundle/main.js',
            };
            fs.writeFileSync(
                path.join(packageDir, 'package.json'),
                JSON.stringify(packageJson, null, 2)
            );

            console.log('✅ All assets staged in .package/');
        },

        // Hook runs after Forge copies source to output directory
        // We use this to replace the unbundled code with our bundled version
        // Hook signature: (forgeConfig, buildPath, electronVersion, platform, arch)
        packageAfterCopy: async (forgeConfig, buildPath, electronVersion, platform, arch) => {
            const fs = require('fs');
            const packageDir = path.join(__dirname, '.package');
            
            // buildPath is the app directory inside the packaged output
            // e.g., out/Rowboat-darwin-arm64/Rowboat.app/Contents/Resources/app
            console.log('Fixing packaged app at:', buildPath);

            // 1. Remove the unbundled dist/ directory (it has imports to @x/core, @x/shared)
            const distDir = path.join(buildPath, 'dist');
            if (fs.existsSync(distDir)) {
                console.log('Removing unbundled dist/...');
                fs.rmSync(distDir, { recursive: true });
            }

            // 2. Copy the bundled dist-bundle/ from staging
            console.log('Copying bundled dist-bundle/...');
            const bundleSrc = path.join(packageDir, 'dist-bundle');
            const bundleDest = path.join(buildPath, 'dist-bundle');
            fs.cpSync(bundleSrc, bundleDest, { recursive: true });

            // 3. Copy preload from staging
            console.log('Copying preload/...');
            const preloadSrc = path.join(packageDir, 'preload');
            const preloadDest = path.join(buildPath, 'preload');
            fs.cpSync(preloadSrc, preloadDest, { recursive: true });

            // 4. Copy renderer from staging
            console.log('Copying renderer/...');
            const rendererSrc = path.join(packageDir, 'renderer');
            const rendererDest = path.join(buildPath, 'renderer');
            fs.cpSync(rendererSrc, rendererDest, { recursive: true });

            // 5. Update package.json to point to bundled entry
            console.log('Updating package.json...');
            const packageJsonPath = path.join(buildPath, 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            packageJson.main = 'dist-bundle/main.js';
            // Remove workspace dependencies (they're bundled now)
            delete packageJson.dependencies;
            delete packageJson.devDependencies;
            delete packageJson.scripts;
            // Remove "type": "module" - we bundle as CommonJS for compatibility
            // with dependencies that use dynamic require()
            delete packageJson.type;
            fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

            // 6. Clean up source files that shouldn't be in production
            const filesToRemove = ['tsconfig.json', 'forge.config.cjs', 'agents.md'];
            for (const file of filesToRemove) {
                const filePath = path.join(buildPath, file);
                if (fs.existsSync(filePath)) {
                    fs.rmSync(filePath);
                }
            }
            const srcDir = path.join(buildPath, 'src');
            if (fs.existsSync(srcDir)) {
                fs.rmSync(srcDir, { recursive: true });
            }

            console.log('✅ Packaged app fixed with bundled code');
        }
    }
};
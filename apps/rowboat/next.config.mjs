/** @type {import('next').NextConfig} */
const nextConfig = {
    // Disable some optimizations to reduce memory usage during build
    swcMinify: true, // Enable minification
    optimizeFonts: true,
    productionBrowserSourceMaps: false,
    
    // Disable unnecessary features
    images: {
        unoptimized: true, // Disable image optimization
    },
    
    // Reduce output size
    compress: true,
    poweredByHeader: false,

    // App Router specific configurations
    experimental: {
        // Remove serverActions as it's now enabled by default
    },

    // Custom webpack configuration
    webpack: (config, { isServer }) => {
        // Add any custom webpack configurations here
        return config;
    },

    // Ensure catch-all routes are handled correctly
    pageExtensions: ['js', 'jsx', 'ts', 'tsx'],

    // Disable the default catch-all route handling
    async rewrites() {
        return [
            {
                source: '/projects/:projectId/test/:appType*',
                destination: '/projects/:projectId/test/:appType',
            },
            {
                source: '/projects/:projectId/workflow',
                destination: '/projects/:projectId/workflow',
            },
        ]
    },

    output: 'standalone',
};

export default nextConfig;

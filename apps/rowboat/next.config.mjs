/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    serverExternalPackages: [
        'awilix',
    ],
};

export default nextConfig;

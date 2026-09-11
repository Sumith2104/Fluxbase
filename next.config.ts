import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

// Next.js configuration
const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    '@genkit-ai/ai', '@genkit-ai/core', '@genkit-ai/googleai',
    // OpenTelemetry — prevent Turbopack from bundling for Edge analysis
    '@opentelemetry/sdk-node',
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/instrumentation-pg',
    '@opentelemetry/instrumentation-http',
    '@opentelemetry/api',
  ],
  // Large CSV uploads: allow up to 200 MB request bodies for the import-csv route.
  experimental: {
    serverActions: {
      bodySizeLimit: '200mb',
    },
  },
  async headers() {
    return [
      {
        // matching all API routes
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-project-id, x-api-key, apiKey, projectId" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com', // Added for Google Profile Pics
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com', // Added for GitHub Profile Avatars
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default withNextIntl(nextConfig);

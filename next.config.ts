import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

// Next.js configuration
const nextConfig: NextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
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
  async redirects() {
    return [
      {
        source: '/doc',
        destination: '/docs',
        permanent: true,
      },
      {
        source: '/doc/pdf',
        destination: '/api/docs/download-pdf',
        permanent: false,
      },
      {
        source: '/docs/pdf',
        destination: '/api/docs/download-pdf',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    // When deployed on Vercel, forward ALL API routes to the dedicated AWS EC2 production backend (fluxbasedb.me).
    // Using beforeFiles ensures Vercel Edge proxies the requests BEFORE local serverless route handlers are evaluated,
    // guaranteeing sub-second execution without cold starts or connection pool starvation.
    if (process.env.VERCEL === '1') {
      return {
        beforeFiles: [
          {
            source: '/api/:path*',
            destination: 'https://fluxbasedb.me/api/:path*',
          },
        ],
        afterFiles: [],
        fallback: [],
      };
    }
    return [];
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

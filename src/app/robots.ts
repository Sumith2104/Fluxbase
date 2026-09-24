import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fluxbasedb.me';

  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/pricing',
          '/docs',
          '/docs/*',
          '/models',
          '/contact',
          '/terms',
          '/privacy',
        ],
        disallow: [
          '/api/',
          '/dashboard/',
          '/query',
          '/tables',
          '/schema',
          '/settings',
          '/admin',
          '/reset-password',
          '/checkout',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { ScrollIndicator } from "@/components/ui/scroll-indicator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GlobalAlertProvider } from "@/components/global-alert-provider";
import { QueryProvider } from "@/components/query-provider";
import ErrorBoundary from "@/components/error-boundary";
import { ThemeProvider } from "@/components/theme-provider";
import { MaintenanceBanner } from "@/components/maintenance-banner";

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://fluxbasedb.me'),
  title: {
    default: 'Fluxbase — AI-Powered SQL Database Platform',
    template: '%s | Fluxbase',
  },
  description: 'The modern, AI-powered SQL database platform. Create, query, and manage databases with natural language and real-time collaboration.',
  keywords: ['sql database', 'postgresql', 'mysql', 'serverless database', 'ai sql', 'database platform', 'fluxbase', 'fluxbase db'],
  authors: [{ name: 'Fluxbase' }],
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: process.env.NEXT_PUBLIC_APP_URL || 'https://fluxbasedb.me',
    siteName: 'Fluxbase',
    title: 'Fluxbase — AI-Powered SQL Database Platform',
    description: 'Create, query, and manage databases with natural language and real-time collaboration.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Fluxbase — AI-Powered SQL Database Platform',
    description: 'Create, query, and manage databases with natural language and real-time collaboration.',
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  verification: {
    google: 'JhrAGACmQgsrw96rM9LhMCQBNnDm2AhDLtE6NtVHEfw',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://fluxbasedb.me/#organization',
      name: 'Fluxbase',
      url: 'https://fluxbasedb.me',
      logo: 'https://fluxbasedb.me/fluxbase-email-logo.png',
      description: 'The modern AI-powered SQL database platform with natural language querying and high write throughput.',
    },
    {
      '@type': 'WebSite',
      '@id': 'https://fluxbasedb.me/#website',
      url: 'https://fluxbasedb.me',
      name: 'Fluxbase',
      publisher: {
        '@id': 'https://fluxbasedb.me/#organization',
      },
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Fluxbase',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Cloud / Web',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      description: 'Create, query, and manage relational databases with natural language AI, real-time collaboration, and extreme write performance.',
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof navigator !== 'undefined' && navigator.userAgent.includes('FluxbaseDesktop')) {
                const style = document.createElement('style');
                style.innerHTML = \`
                  html {
                    transform: scale(0.8) !important;
                    transform-origin: top left !important;
                    width: 125% !important;
                    height: 125% !important;
                    max-width: none !important;
                    max-height: none !important;
                  }
                  body {
                    width: 100% !important;
                    max-width: none !important;
                    min-height: 100% !important;
                  }
                  .min-h-screen {
                    min-height: 100% !important;
                  }
                  .h-screen {
                    height: 100% !important;
                  }
                \`;
                document.head.appendChild(style);
              }
            `
          }}
        />
      </head>
      <body className="font-body antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <QueryProvider>
            <ErrorBoundary>
              <GlobalAlertProvider>
                <TooltipProvider delayDuration={200}>
                  <MaintenanceBanner />
                  {children}
                  <ScrollIndicator />
                  <Toaster />
                </TooltipProvider>
              </GlobalAlertProvider>
            </ErrorBoundary>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

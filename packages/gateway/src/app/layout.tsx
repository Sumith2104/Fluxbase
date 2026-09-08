import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FluxPay // High-Performance Automated UPI Gateway',
  description: 'Instant slot-recycling UPI payment engine for personal banking accounts',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#0b0b0b] text-[#f4f4f5] min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}

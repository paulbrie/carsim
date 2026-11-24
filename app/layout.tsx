import type { Metadata, Viewport } from 'next';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const SITE = process.env.SITE_URL || 'https://carsim.paulbrie.com';
const DESCRIPTION = 'Human drivers against tiny neural networks, on the same simulated cars and tracks. Drive, train a network in your browser, or do both.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'Carsim: humans vs tiny neural networks', template: '%s · Carsim' },
  description: DESCRIPTION,
  applicationName: 'Carsim',
  authors: [{ name: 'Paul Brie' }],
  openGraph: { type: 'website', siteName: 'Carsim', title: 'Carsim: humans vs tiny neural networks', description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: 'Carsim: humans vs tiny neural networks', description: DESCRIPTION },
};

export const viewport: Viewport = { themeColor: '#0d0f14', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster theme="dark" position="top-center" richColors />
      </body>
    </html>
  );
}

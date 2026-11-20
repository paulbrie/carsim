import type { Metadata, Viewport } from 'next';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sand Buggy Rally',
  description: 'Real-time multiplayer racing on the Sand Buggy sim: dunes, deep ruts, eight cars.',
};

export const viewport: Viewport = { themeColor: '#1c1712', colorScheme: 'dark' };

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

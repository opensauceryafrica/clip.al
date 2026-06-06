import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { env } from '@clipal/config';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(env.APP_URL),
  title: {
    default: 'clip.al — short links, real analytics',
    template: '%s · clip.al',
  },
  description:
    'A fast, safe URL shortener and link manager. Anonymous by default, scanned for safety, built for billions of redirects.',
  applicationName: 'clip.al',
  openGraph: {
    title: 'clip.al',
    description: 'Short links. Real analytics. Built to last.',
    url: env.APP_URL,
    siteName: 'clip.al',
    type: 'website',
  },
  twitter: { card: 'summary' },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}

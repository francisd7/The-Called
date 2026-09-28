import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'THE CALLED — Setter Dashboard',
  description: 'Lead tracking, call confirmations and triage for the setting team.',
  // The tab and home-screen icons come from icon.png and apple-icon.png beside
  // this file. Without them an iPhone draws a grey "T" from the title.
  appleWebApp: { title: 'The Called' },
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

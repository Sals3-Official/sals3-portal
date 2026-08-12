import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Seller Center',
  description:
    'Sals3 Seller Center — orders, inventory, listings, finances, payouts, market rules, and the CJdropshipping catalogue.',
  // The portal is a private operations tool. Keep it out of search
  // engines and AI answer surfaces on purpose.
  robots: { index: false, follow: false },
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}

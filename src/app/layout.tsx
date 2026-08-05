import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans as PlusJakartaSans, Outfit } from 'next/font/google';
import './globals.css';

const jakarta = PlusJakartaSans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '700'],
});

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  weight: ['600'],
});

export const metadata: Metadata = {
  title: 'Sals3 Portal',
  description: 'Sals3 portal application.',
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${outfit.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}

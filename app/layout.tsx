import type { Metadata, Viewport } from 'next'
import './globals.css'
import I18nDomTranslator from '@/components/I18nDomTranslator'
import NavBar from '@/components/NavBar'

export const metadata: Metadata = {
  title: 'FinTrack',
  description: 'Personal finance tracker',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'FinTrack',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192x192.png" />
      </head>
      <body className="min-h-screen bg-slate-900 text-slate-100 pb-24 md:pb-0">
        <NavBar />
        <main className="max-w-7xl mx-auto px-4 py-6 md:pt-6">
          {children}
        </main>
        <I18nDomTranslator />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js');
                });
              }
            `,
          }}
        />
      </body>
    </html>
  )
}

import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/500.css';
import '@fontsource/public-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/400-italic.css';
import '@fontsource/newsreader/500-italic.css';
import './globals.css';

export const metadata = {
  title: 'Research Atlas',
  description: 'An atlas of research: zoom from the world to a country, an institution, a research area and one researcher, in any field.',
  icons: {
    icon: [
      { url: (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/favicon.ico', sizes: 'any' },
      { url: (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/apple-touch-icon.png',
  },
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#111923', colorScheme: 'dark' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-skin="b" data-color-mode="dark">
      <body>{children}</body>
    </html>
  );
}

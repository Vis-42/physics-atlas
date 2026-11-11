import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/500.css';
import '@fontsource/public-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/400-italic.css';
import '@fontsource/newsreader/500-italic.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/eb-garamond/400-italic.css';
import './globals.css';

export const metadata = {
  title: 'netwrk Atlas',
  description: 'An atlas of research: zoom from the world to a country, an institution, a research area and one researcher, in any field.',
  icons: { icon: (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/favicon.ico' },
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-skin="a" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{__html: "try{var s=localStorage.getItem('atlas-style'),m=localStorage.getItem('atlas-color-mode');if(!['a','b','c'].includes(s))s=(m==='dark'||((!m||m==='system')&&matchMedia('(prefers-color-scheme: dark)').matches))?'b':'a';document.documentElement.dataset.skin=s;document.documentElement.dataset.colorMode=s==='b'?'dark':'light'}catch(e){}"}} /></head>
      <body>{children}</body>
    </html>
  );
}

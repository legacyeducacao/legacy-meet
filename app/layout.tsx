import '../styles/globals.css';
import '@livekit/components-styles';
import '@livekit/components-styles/prefabs';
import type { Metadata, Viewport } from 'next';
import { Urbanist } from 'next/font/google';
import { AppProviders } from '@/components/AppProviders';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';

const urbanist = Urbanist({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-urbanist',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Legacy Meet | Videoconferência da Legacy',
    template: '%s',
  },
  description: 'Aplicativo de videoconferência da Legacy.',
  openGraph: {
    siteName: 'Legacy Meet',
  },
  // O favicon vem de app/icon.svg (convenção do Next, com cache-busting automático).
};

export const viewport: Viewport = {
  themeColor: '#1D3A5D',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={urbanist.variable} suppressHydrationWarning>
      <body data-lk-theme="default" className={urbanist.className}>
        {/* Aplica o tema escuro antes da hidratação (evita flash) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <AppProviders />
        {children}
      </body>
    </html>
  );
}

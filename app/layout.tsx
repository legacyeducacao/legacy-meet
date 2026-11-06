import '../styles/globals.css';
import '@livekit/components-styles';
import '@livekit/components-styles/prefabs';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { AppProviders } from '@/components/AppProviders';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';

// Urbanist (OFL) guardada no projeto: o build não depende mais do Google Fonts,
// que em 06/11/2026 respondeu diferente ao servidor e derrubou o deploy.
// Arquivo variável (pesos 100 a 900), subconjunto latin (cobre o português).
const urbanist = localFont({
  src: './fonts/Urbanist-latin.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-urbanist',
  display: 'swap',
  fallback: ['sans-serif'],
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
      {/* suppressHydrationWarning: extensões do navegador (Demoway, Grammarly…)
          injetam atributos no <body> antes do React hidratar. Vale só para os
          atributos deste elemento, não para os filhos. */}
      <body data-lk-theme="default" className={urbanist.className} suppressHydrationWarning>
        {/* Aplica o tema escuro antes da hidratação (evita flash) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <AppProviders />
        {children}
      </body>
    </html>
  );
}

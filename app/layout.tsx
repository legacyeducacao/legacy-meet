import '../styles/globals.css';
import '@livekit/components-styles';
import '@livekit/components-styles/prefabs';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'react-hot-toast';

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
    <html lang="pt-BR">
      <body data-lk-theme="default">
        <Toaster />
        {children}
      </body>
    </html>
  );
}

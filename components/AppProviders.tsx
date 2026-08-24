'use client';

import * as React from 'react';
import { Toaster } from '@/components/ui/sonner';
import PostLoginPreloader from '@/components/patterns/PostLoginPreloader';
import { TopProgressBar } from '@/components/TopProgressBar';
import { useTheme } from '@/lib/theme';

/**
 * Peças globais do design system montadas uma vez no root layout: toasts
 * (sonner + custom-toast), preloader pós-login (só renderiza quando a flag de
 * sessão existe) e barra de progresso de navegação.
 */
export function AppProviders() {
  const theme = useTheme();
  return (
    <>
      <Toaster theme={theme} />
      <PostLoginPreloader />
      <TopProgressBar />
    </>
  );
}

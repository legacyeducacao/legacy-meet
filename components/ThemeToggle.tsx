'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { setTheme, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/** Alterna claro/escuro (classe `dark` no <html>, preferência persistida). */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      title={dark ? 'Tema claro' : 'Tema escuro'}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-primary md:h-8 md:w-8',
        className,
      )}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

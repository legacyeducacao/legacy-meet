'use client';

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'meet.theme';
const EVENT = 'meet-theme-change';

/** Lê a preferência salva (padrão: claro). Seguro fora do navegador. */
export function getTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Aplica a classe `dark` no <html> (contrato do design system) e persiste. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* sem localStorage */
  }
  document.documentElement.classList.toggle('dark', theme === 'dark');
  window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
}

/** Tema atual, reativo a mudanças feitas por qualquer ThemeToggle. */
export function useTheme(): Theme {
  const [theme, setThemeState] = useState<Theme>('light');
  useEffect(() => {
    setThemeState(getTheme());
    const onChange = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return theme;
}

/**
 * Script inline para o <body>: aplica `dark` ANTES da hidratação, evitando o
 * flash de tema claro em quem usa o escuro.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{if(localStorage.getItem('${STORAGE_KEY}')==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

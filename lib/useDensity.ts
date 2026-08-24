// Densidade de linha (confortável/compacta) pra grids pesados (tabelas,
// listas longas). Preferência do USUÁRIO, não de um registro específico:
// mora no localStorage sob uma chave única (`ui_density`) e vale pra
// qualquer tela que leia o hook.
import { useCallback, useState } from 'react';

export type Density = 'confortavel' | 'compacto';

const STORAGE_KEY = 'ui_density';

function loadDensity(): Density {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'compacto' ? 'compacto' : 'confortavel';
  } catch {
    return 'confortavel';
  }
}

export function useDensity(): [Density, () => void] {
  const [density, setDensity] = useState<Density>(loadDensity);

  const toggle = useCallback(() => {
    setDensity((prev) => {
      const next: Density = prev === 'compacto' ? 'confortavel' : 'compacto';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return [density, toggle];
}

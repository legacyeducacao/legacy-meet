import { useEffect, useState } from 'react';
import { useReducedMotion as useFramerReducedMotion } from 'framer-motion';

/** Lê, de forma síncrona, se o `<html>` já está marcado com a classe
 *  `reduce-motion` (setada pelo toggle in-app de acessibilidade do SEU app —
 *  no Legacy Plan: hooks/useAccessibility.ts). Null-safe fora do browser
 *  (SSR/testes). */
function readAppToggle(): boolean {
  return (
    typeof document !== 'undefined' &&
    !!document.documentElement?.classList.contains('reduce-motion')
  );
}

/**
 * Sinal único de "reduzir movimento": OR entre o `prefers-reduced-motion`
 * do sistema operacional (via `useReducedMotion()` do framer-motion, que já
 * reage a mudanças na media query) e um eventual toggle manual de
 * acessibilidade do app (classe `reduce-motion` no `<html>`).
 *
 * Se o seu app não tem um toggle in-app equivalente, este hook ainda
 * funciona — `readAppToggle()` simplesmente nunca encontra a classe e o
 * retorno colapsa para o `prefers-reduced-motion` puro do SO.
 *
 * O toggle in-app não passa por media query — por isso observamos o
 * atributo `class` do `<html>` via MutationObserver pra reagir em tempo
 * real quando o usuário liga/desliga a preferência, sem precisar remontar
 * a página.
 */
export function useAppReducedMotion(): boolean {
  const systemReducedMotion = useFramerReducedMotion();
  const [appToggle, setAppToggle] = useState<boolean>(readAppToggle);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const root = document.documentElement;
    // Reconfere ao montar — o valor inicial do useState pode ter sido lido
    // antes de outro efeito (ex: quem aplica a classe) rodar.
    setAppToggle(readAppToggle());
    const observer = new MutationObserver(() => setAppToggle(readAppToggle()));
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return !!systemReducedMotion || appToggle;
}

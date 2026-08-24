import { useCallback, useEffect, useRef } from 'react';

/**
 * Delta puro do number scrubbing: quantos "ticks" de `step` o arrasto
 * horizontal representa. Extraído do hook pra ser testável sem DOM/eventos
 * de pointer — a lógica de negócio (quanto o valor muda) não deveria
 * depender de simular um PointerEvent real.
 *
 * 4px de arrasto = 1 tick. Shift multiplica o tick por 10 (ajuste grosso,
 * ex.: R$100 vira R$1000 por tick).
 */
export function scrubDelta(dxPx: number, step: number, shift: boolean): number {
  return Math.round(dxPx / 4) * step * (shift ? 10 : 1);
}

interface UseNumberScrubArgs {
  value: number;
  onPreview: (next: number) => void;
  onCommit: (next: number) => void;
  step?: number;
}

interface UseNumberScrubResult {
  onPointerDown: (e: React.PointerEvent) => void;
}

const isFinePointer = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: fine)').matches
    : false;

/**
 * Alt+arrastar horizontal ajusta um valor numérico (number scrubbing estilo
 * Figma/After Effects) — segura Alt sobre a célula, arrasta, solta.
 *
 * SEM Alt não faz absolutamente nada (nunca chama preventDefault nesse
 * caso) — quem usar este hook num elemento clicável/editável precisa que o
 * click e a digitação normais continuem intactos.
 *
 * Desktop only: guard por `pointer: fine` evita ativar em touch, onde não
 * existe "Alt segurado" nem faz sentido arrastar pra ajustar um número.
 *
 * O cursor `ew-resize` fica no `<body>` durante o arrasto inteiro (não só
 * no elemento) pra dar feedback mesmo quando o ponteiro sai da célula — e é
 * SEMPRE restaurado, inclusive se o componente desmontar no meio do scrub
 * (troca de view, colapso de grupo, etc.), via cleanup do useEffect abaixo.
 *
 * Padrão latest-ref (obrigatório aqui): `onPreview`/`onCommit`/`value`/
 * `step` costumam ser closures/valores NOVOS a cada render do caller (ex.:
 * `onPreview={(n) => setState(n)}` inline em CurrencyCell). `onPreview`
 * dispara um `setState` a cada `pointermove` → o caller re-renderiza NO
 * MEIO do arrasto → se `onPointerMove`/`endScrub` dependessem desses
 * valores via dependency array, ganhariam identidade nova a cada preview →
 * o `useEffect` de cleanup (que dependia delas) rodaria a cada re-render,
 * REMOVENDO os listeners de `window` antes do `pointerup` chegar. Resultado
 * observado: o preview fica preso mostrando um valor NUNCA commitado —
 * divergência silenciosa numa grade financeira. Por isso os callbacks
 * variáveis moram em refs atualizadas a cada render (sem dependency array
 * no efeito que as atualiza), e `onPointerMove`/`endScrub`/`onPointerDown`
 * têm identidade ESTÁVEL (`useCallback` com deps `[]`), sempre lendo a
 * versão mais recente pela ref — o cleanup effect fica com deps `[]` e só
 * roda no unmount de verdade.
 */
export function useNumberScrub({
  value,
  onPreview,
  onCommit,
  step = 100,
}: UseNumberScrubArgs): UseNumberScrubResult {
  const stateRef = useRef<{ x0: number; v0: number } | null>(null);

  const valueRef = useRef(value);
  const onPreviewRef = useRef(onPreview);
  const onCommitRef = useRef(onCommit);
  const stepRef = useRef(step);
  useEffect(() => {
    valueRef.current = value;
    onPreviewRef.current = onPreview;
    onCommitRef.current = onCommit;
    stepRef.current = step;
  });

  const restoreCursor = () => {
    document.body.style.cursor = '';
  };

  // Identidade ESTÁVEL (deps []): só assim os listeners de `window`
  // registrados no pointerdown continuam sendo o MESMO objeto de função que
  // o cleanup (do endScrub e do unmount) tenta remover depois.
  const onPointerMove = useCallback((e: PointerEvent) => {
    const s = stateRef.current;
    if (!s) return;
    onPreviewRef.current(s.v0 + scrubDelta(e.clientX - s.x0, stepRef.current, e.shiftKey));
  }, []);

  const endScrub = useCallback(
    (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s) return;
      stateRef.current = null;
      restoreCursor();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endScrub);
      window.removeEventListener('pointercancel', endScrub);
      onCommitRef.current(s.v0 + scrubDelta(e.clientX - s.x0, stepRef.current, e.shiftKey));
    },
    [onPointerMove],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!e.altKey) return; // sem Alt: nada de preventDefault, click/digitação seguem normais
      if (e.button !== 0) return; // só botão primário — não sequestra o context menu do direito
      if (!isFinePointer()) return; // desktop only

      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      stateRef.current = { x0: e.clientX, v0: valueRef.current };
      document.body.style.cursor = 'ew-resize';
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', endScrub);
      window.addEventListener('pointercancel', endScrub);
    },
    [onPointerMove, endScrub],
  );

  // Se o componente desmontar com um scrub em voo (troca de tela, colapso de
  // grupo etc.), o pointerup nunca chega — sem este cleanup o cursor
  // ew-resize ficaria preso no body pra sempre. Deps [] de propósito: isto
  // roda SÓ no unmount real (onPointerMove/endScrub já são estáveis, então
  // incluí-las mudaria nada em termos de comportamento, mas deixaria a
  // intenção — "só desmontagem" — menos explícita).
  useEffect(() => {
    return () => {
      if (!stateRef.current) return;
      stateRef.current = null;
      restoreCursor();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endScrub);
      window.removeEventListener('pointercancel', endScrub);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { onPointerDown };
}

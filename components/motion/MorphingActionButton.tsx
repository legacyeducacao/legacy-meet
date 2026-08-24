'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

export type MorphState = 'idle' | 'loading' | 'success';

/**
 * Deriva um MorphState a partir de um sinal de ÊXITO real (não da simples
 * queda de `loading`, que também acontece no caminho de erro/finally).
 *
 * `successSignal` deve ser um valor que SÓ muda quando a operação realmente
 * teve sucesso (ex.: um id/timestamp setado após o save OK, ou uma flag
 * `dirty` que só zera em caso de êxito) — nunca algo tocado no catch/erro.
 * O hook dispara 'success' quando, na MESMA transição em que `loading` cai
 * de true→false, `successSignal` também muda de valor; reverte pra 'idle'
 * sozinho após 900ms. Erro (loading cai mas o sinal não muda) → sem morph.
 */
export function useSuccessMorph(successSignal: unknown, loading: boolean): MorphState {
  const prevSignalRef = useRef(successSignal);
  const wasLoadingRef = useRef(loading);
  const [justSucceeded, setJustSucceeded] = useState(false);

  // Detector: só observa a transição loading→!loading + mudança de sinal.
  // Não agenda timer aqui — se essa mesma janela de deps mudar de novo
  // (successSignal ou loading tocados por outro motivo) o timer seria
  // cancelado pelo cleanup e `justSucceeded` ficaria travado em true.
  useEffect(() => {
    const succeeded = wasLoadingRef.current && !loading && successSignal !== prevSignalRef.current;
    prevSignalRef.current = successSignal;
    wasLoadingRef.current = loading;
    if (succeeded) {
      setJustSucceeded(true);
    }
  }, [successSignal, loading]);

  // Reset: keyed só em justSucceeded, então nada externo derruba esse timer.
  useEffect(() => {
    if (!justSucceeded) return;
    const t = setTimeout(() => setJustSucceeded(false), 900);
    return () => clearTimeout(t);
  }, [justSucceeded]);

  return justSucceeded ? 'success' : loading ? 'loading' : 'idle';
}

// components/ui/button não exporta um tipo ButtonProps nomeado — deriva do
// próprio componente pra herdar variant/size/asChild + atributos nativos.
type ButtonProps = React.ComponentProps<typeof Button>;

interface MorphingActionButtonProps extends Omit<ButtonProps, 'children'> {
  state: MorphState;
  idleContent: React.ReactNode;
  loadingContent?: React.ReactNode;
}

/** Botão de ação que confirma visualmente: loading → check verde que se desenha. */
export const MorphingActionButton: React.FC<MorphingActionButtonProps> = ({ state, idleContent, loadingContent, className, disabled, ...rest }) => {
  const reduced = useReducedMotion();
  return (
    <Button {...rest} disabled={disabled || state !== 'idle'} className={cn('relative overflow-hidden', className)}>
      <AnimatePresence mode="wait" initial={false}>
        {state === 'success' ? (
          <motion.span key="ok" className="flex items-center gap-1.5"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <motion.path d="M4 12.5L9.5 18L20 6.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
                initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, ease: 'easeOut' }} />
            </svg>
            Feito
          </motion.span>
        ) : (
          <motion.span key={state} className="flex items-center gap-1.5"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            {state === 'loading' ? (loadingContent ?? idleContent) : idleContent}
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  );
};

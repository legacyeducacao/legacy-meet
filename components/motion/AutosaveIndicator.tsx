'use client';

// Indicador discreto de autosave — versão animada.
//
// No app original o tipo de status vem do hook de autosave robusto
// (hooks/useRobustAutosave.ts / services/autosave/types.ts): 'idle' |
// 'saving' | 'saved' | 'error' | 'conflict' | 'recovered'. Aqui o tipo é
// declarado localmente (kit não depende de services/hooks do app) — plugue
// o status do SEU mecanismo de autosave, mapeando para estes valores.
// 'recovered' e qualquer outro valor fora dos 4 tratados não renderizam
// nada (pill "silencioso" fora de operação).
//
// 'conflict' é tratado com o mesmo visual destrutivo de 'error' (mensagem
// própria + retry) — casos de conflito de edição concorrente geralmente
// precisam do mesmo retry genérico.
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/utils';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'recovered';

export interface AutosaveIndicatorProps {
  status: AutosaveStatus;
  savedAt: Date | null;
  /** Mensagem de erro/conflito (vira title do texto, não exibida inline). */
  error?: string;
  /** Retry manual — some o botão quando ausente. */
  onRetry?: () => void;
  className?: string;
}

function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DOT_DELAYS = [0, 0.15, 0.3];

/** Pill discreto: "Salvando…" (3 pontos com stagger) → "Salvo ✓" (check que se
 *  desenha, some após 2s deixando só o horário em title) → erro (texto
 *  destructive + "Tentar de novo"). */
export const AutosaveIndicator: React.FC<AutosaveIndicatorProps> = ({ status, savedAt, error, onRetry, className }) => {
  const reduced = useReducedMotion();

  // "Salvo ✓" fica visível por 2s e então some, mas o wrapper continua
  // hoverable (title com o horário) enquanto o hook não reportar novo status.
  const [showSavedLabel, setShowSavedLabel] = useState(false);
  const savedAtKeyRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== 'saved') return;
    const key = savedAt ? savedAt.getTime() : null;
    if (key !== savedAtKeyRef.current) {
      savedAtKeyRef.current = key;
      setShowSavedLabel(true);
      const t = setTimeout(() => setShowSavedLabel(false), 2000);
      return () => clearTimeout(t);
    }
  }, [status, savedAt]);

  useEffect(() => {
    if (status !== 'saved') setShowSavedLabel(false);
  }, [status]);

  if (status !== 'saving' && status !== 'saved' && status !== 'error' && status !== 'conflict') {
    return null;
  }

  const title = status === 'saved' && savedAt ? `Salvo às ${formatTime(savedAt)}` : undefined;

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}
      title={title}
      aria-live="polite"
    >
      <AnimatePresence mode="wait" initial={false}>
        {status === 'saving' && (
          <motion.span
            key="saving"
            className="inline-flex items-center gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {reduced ? (
              <span>Salvando…</span>
            ) : (
              <>
                <span className="sr-only">Salvando…</span>
                <span className="inline-flex items-center gap-0.5" aria-hidden>
                  {DOT_DELAYS.map((delay, i) => (
                    <motion.span
                      key={i}
                      className="h-1 w-1 rounded-full bg-current"
                      animate={{ opacity: [0.25, 1, 0.25] }}
                      transition={{ duration: 1, repeat: Infinity, delay, ease: 'easeInOut' }}
                    />
                  ))}
                </span>
              </>
            )}
          </motion.span>
        )}

        {status === 'saved' && showSavedLabel && (
          <motion.span
            key="saved"
            className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {reduced ? (
              <span>Salvo ✓</span>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <motion.path
                    d="M4 12.5L9.5 18L20 6.5"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                </svg>
                Salvo
              </>
            )}
          </motion.span>
        )}

        {(status === 'error' || status === 'conflict') && (
          <motion.span
            key="error"
            className="inline-flex items-center gap-1.5 text-destructive"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <span title={error}>{status === 'conflict' ? 'Outra sessão salvou' : 'Erro ao salvar'}</span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="underline underline-offset-2 hover:text-destructive/80"
              >
                Tentar de novo
              </button>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
};

export default AutosaveIndicator;

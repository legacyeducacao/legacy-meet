'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppReducedMotion } from '../../lib/useAppReducedMotion';

const AUTO_DISMISS_MS = 8000;
const STORAGE_PREFIX = 'coach_';

function readSeen(id: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + id) === '1';
  } catch {
    return false;
  }
}

function markSeen(id: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, '1');
  } catch {
    /* localStorage indisponível (modo privado, quota) não é motivo pra quebrar a tela */
  }
}

export interface CoachmarkProps {
  /** Chave única — vira `coach_<id>` no localStorage. Visto uma vez, nunca mais aparece. */
  id: string;
  text: string;
  anchorClassName?: string;
  onDismiss?: () => void;
}

/**
 * Balão de dica de uma-vez-só — mesma linguagem visual do TooltipBalao
 * (bg-sidebar-primary, texto branco text-xs, seta, botão de fechar), mas
 * sem trigger: aparece sozinho na primeira montagem em vez de esperar um
 * hover, e se controla inteiramente pelo localStorage (`coach_<id>`).
 *
 * Fecha em qualquer um dos três gatilhos: botão X, 8s sem interação, ou o
 * primeiro Alt+ARRASTO real em QUALQUER lugar da tela (pointerdown com Alt
 * seguido de pointermove com deslocamento >4px antes do pointerup — o
 * mesmo limiar de 1 tick do scrub em si, ver `useNumberScrub` neste kit).
 * Alt+clique parado (down/up sem mover) NÃO gasta a dica: só o gesto de
 * arrastar de verdade prova que a pessoa descobriu o scrubbing — um clique
 * parado é ruído (ex.: Alt+clique do menu de contexto do SO, ou só testar
 * a tecla). O listener é global (não escopado a um elemento) de propósito:
 * é o jeito mais barato de cobrir "a pessoa já descobriu sozinha", sem o
 * consumidor precisar repassar uma ref do grid.
 *
 * Se sua feature não tem scrubbing por Alt+arrasto, o gatilho de dispensa
 * por gesto simplesmente nunca dispara — sobram os outros dois (X e timeout).
 */
export function Coachmark({ id, text, anchorClassName, onDismiss }: CoachmarkProps) {
  const [visible, setVisible] = useState(() => !readSeen(id));
  const reducedMotion = useAppReducedMotion();
  const dismissedRef = useRef(false);

  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    markSeen(id);
    setVisible(false);
    onDismiss?.();
  };

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Alt+arrasto real: down (com Alt) → move >4px → up. Rastreado por
  // variáveis locais ao efeito (não state) — nada aqui precisa re-render, e
  // um pointermove por pixel arrastado não pode disparar setState.
  useEffect(() => {
    if (!visible) return;
    let dragStart: { x: number; y: number } | null = null;
    let dragged = false;

    const handlePointerDown = (e: PointerEvent) => {
      if (!e.altKey) return;
      dragStart = { x: e.clientX, y: e.clientY };
      dragged = false;
    };
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragStart || dragged) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (Math.hypot(dx, dy) > 4) dragged = true;
    };
    const handlePointerUp = () => {
      if (dragged) dismiss();
      dragStart = null;
      dragged = false;
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // O gate de visibilidade fica DENTRO do AnimatePresence: fora dele, o
  // subtree inteiro desmonta junto e o `exit` abaixo nunca roda.
  return (
    <AnimatePresence>
      {visible && (
      <motion.div
        role="status"
        className={cn(
          'relative inline-flex items-center gap-2 rounded-lg bg-sidebar-primary px-3 py-2 text-xs font-semibold text-white shadow-lg',
          anchorClassName,
        )}
        initial={reducedMotion ? false : { opacity: 0, y: 6, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.96 }}
        transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Seta apontando para baixo, para o conteúdo logo abaixo do balão. */}
        <span className="absolute -bottom-1.5 left-6 h-3 w-3 rotate-45 bg-sidebar-primary" aria-hidden="true" />
        <span>{text}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fechar dica"
          className="shrink-0 rounded p-0.5 text-white/70 transition-colors hover:text-white"
        >
          <X size={12} />
        </button>
      </motion.div>
      )}
    </AnimatePresence>
  );
}

export default Coachmark;

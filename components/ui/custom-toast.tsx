'use client';

import React from 'react';
import { toast as sonnerToast } from 'sonner';
import { motion, useReducedMotion } from 'framer-motion';
import {
  CheckCircle2,
  AlertCircle,
  Info,
  X,
  Loader2,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { cn } from '../../lib/utils';

export interface CustomToastOptions {
  description?: React.ReactNode;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  cancel?: {
    label: string;
    onClick: () => void;
  };
}

interface CustomToastBaseProps {
  id: string | number;
  title: string | React.ReactNode;
  description?: React.ReactNode;
  type: 'success' | 'error' | 'warning' | 'info' | 'loading' | 'default';
  action?: CustomToastOptions['action'];
  cancel?: CustomToastOptions['cancel'];
}

const CustomToastBase = ({ id, title, description, type, action, cancel }: CustomToastBaseProps) => {
  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle2 size={20} className="text-emerald-500" />;
      case 'error':
        return <AlertCircle size={20} className="text-destructive" />;
      case 'warning':
        return <TriangleAlert size={20} className="text-amber-500" />;
      case 'info':
        return <Info size={20} className="text-primary" />;
      case 'loading':
        return <Loader2 size={20} className="text-primary animate-spin" />;
      default:
        return <Info size={20} className="text-sidebar-foreground/50" />;
    }
  };

  const getThemeStyles = () => {
    switch (type) {
      case 'success':
        return 'border-emerald-500/30 bg-card/70 shadow-[0_8px_32px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/10';
      case 'error':
        return 'border-destructive/30 bg-card/70 shadow-[0_8px_32px_rgba(220,38,38,0.15)] ring-1 ring-destructive/10';
      case 'warning':
        return 'border-amber-500/30 bg-card/70 shadow-[0_8px_32px_rgba(245,158,11,0.15)] ring-1 ring-amber-500/10';
      case 'info':
      case 'loading':
        return 'border-primary/30 bg-card/70 shadow-[0_8px_32px_rgba(59,130,246,0.15)] ring-1 ring-primary/10';
      default:
        return 'border-border/50 bg-card/70 shadow-xl';
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95, y: 15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn(
        "glass w-[360px] p-4 flex gap-4 rounded-2xl font-[Urbanist,sans-serif] relative overflow-hidden group pointer-events-auto",
        getThemeStyles()
      )}
    >
      {/* Icon Area */}
      <div className="shrink-0 mt-0.5">
        {getIcon()}
      </div>

      {/* Content Area */}
      <div className="flex-1 space-y-1 relative pr-4">
        <p className="text-sm font-bold tracking-tight text-foreground leading-snug">
          {title}
        </p>
        {description && (
          <p className="text-xs font-semibold text-muted-foreground leading-relaxed mt-1">
            {description}
          </p>
        )}

        {/* Actions */}
        {(action || cancel) && (
          <div className="flex items-center gap-2 mt-3">
            {action && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick();
                  sonnerToast.dismiss(id);
                }}
                className="h-8 px-4 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
              >
                {action.label}
              </button>
            )}
            {cancel && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  cancel.onClick();
                  sonnerToast.dismiss(id);
                }}
                className="h-8 px-3 rounded-lg text-xs font-bold bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {cancel.label}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Close Button */}
      <button
        onClick={() => sonnerToast.dismiss(id)}
        className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-foreground/40 hover:bg-muted hover:text-foreground active:scale-95"
      >
        <X size={14} />
      </button>

      {/* Aesthetic Side Accent */}
      <div
        className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[50%] rounded-r-full opacity-80",
          type === 'success' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' :
          type === 'error' ? 'bg-destructive shadow-[0_0_8px_rgba(220,38,38,0.8)]' :
          type === 'warning' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]' :
          type === 'info' || type === 'loading' ? 'bg-primary shadow-[0_0_8px_rgba(59,130,246,0.8)]' : 'bg-muted-foreground'
        )}
      />
    </motion.div>
  );
};

export interface UndoToastOptions {
  title: string | React.ReactNode;
  description?: React.ReactNode;
  /** @default 5000 */
  durationMs?: number;
  /** Roda quando a pessoa clica em "Desfazer" — cancela o commit pendente. */
  onUndo: () => void;
  /**
   * Roda quando o anel fecha SEM undo — inclusive se a pessoa fechar o toast
   * pelo X (fechar manualmente conta como confirmar, não como desfazer).
   */
  onCommit: () => void;
}

/**
 * Anel SVG regressivo dentro do botão "Desfazer". Com reduced-motion o anel
 * fica estático e cheio (pathLength sempre 1) — o timer de commit continua
 * valendo do mesmo jeito, só a pista visual some.
 */
const UndoRing = ({ durationMs }: { durationMs: number }) => {
  const reduced = useReducedMotion();
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" className="-rotate-90 shrink-0" aria-hidden>
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      <motion.circle
        cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        initial={{ pathLength: 1 }}
        animate={{ pathLength: reduced ? 1 : 0 }}
        transition={reduced ? { duration: 0 } : { duration: durationMs / 1000, ease: 'linear' }}
      />
    </svg>
  );
};

interface UndoToastBaseProps {
  title: string | React.ReactNode;
  description?: React.ReactNode;
  durationMs: number;
  onUndoClick: () => void;
  onCloseClick: () => void;
}

/** Mesmo shell visual do CustomToastBase (glass card), com um único botão
 *  "Desfazer" (anel embutido) no lugar das ações genéricas. */
const UndoToastBase = ({ title, description, durationMs, onUndoClick, onCloseClick }: UndoToastBaseProps) => (
  <motion.div
    layout
    initial={{ opacity: 0, scale: 0.95, y: 15 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    className="glass w-[360px] p-4 flex gap-4 rounded-2xl font-[Urbanist,sans-serif] relative overflow-hidden group pointer-events-auto border-border/50 bg-card/70 shadow-xl"
  >
    {/* Icon Area */}
    <div className="shrink-0 mt-0.5">
      <Undo2 size={20} className="text-sidebar-foreground/50" />
    </div>

    {/* Content Area */}
    <div className="flex-1 space-y-1 relative pr-4">
      <p className="text-sm font-bold tracking-tight text-foreground leading-snug">
        {title}
      </p>
      {description && (
        <p className="text-xs font-semibold text-muted-foreground leading-relaxed mt-1">
          {description}
        </p>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onUndoClick(); }}
          className="h-8 px-4 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm inline-flex items-center gap-1.5"
        >
          <UndoRing durationMs={durationMs} />
          Desfazer
        </button>
      </div>
    </div>

    {/* Close Button — fechar manualmente conta como commit (ver onCloseClick) */}
    <button
      type="button"
      onClick={onCloseClick}
      className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-foreground/40 hover:bg-muted hover:text-foreground active:scale-95"
    >
      <X size={14} />
    </button>

    {/* Aesthetic Side Accent */}
    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[50%] rounded-r-full opacity-80 bg-muted-foreground" />
  </motion.div>
);

/**
 * Toast com "Desfazer": mostra o anel regressivo e agenda o commit num
 * `setTimeout` que vive FORA do ciclo de vida do componente React (aqui, no
 * módulo do toast) — se a tela for desmontada ou a pessoa navegar antes do
 * anel fechar, o commit ainda dispara (senão a remoção otimista da UI nunca
 * seria persistida). `committed`/`undone` colapsam num único flag de
 * closure: undo e commit são mutuamente exclusivos e só o primeiro conta.
 */
function undo({ title, description, durationMs = 5000, onUndo, onCommit }: UndoToastOptions) {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearPendingCommit = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // O sonner pausa a barra/anel regressivo no hover, mas o setTimeout do
  // commit abaixo NÃO pausa junto — sem derrubar o toast aqui, o usuário
  // podia clicar "Desfazer" depois do commit já ter rodado (no-op silencioso,
  // parecia bug). Derrubando o toast no commit, a janela real (ring) e a
  // visual (toast na tela) ficam sempre em sincronia.
  const commit = () => {
    if (settled) return;
    settled = true;
    clearPendingCommit();
    onCommit();
    sonnerToast.dismiss(id);
  };

  const cancel = () => {
    if (settled) return;
    settled = true;
    clearPendingCommit();
    onUndo();
  };

  const id = sonnerToast.custom(
    (toastId) => (
      <UndoToastBase
        title={title}
        description={description}
        durationMs={durationMs}
        onUndoClick={() => { cancel(); sonnerToast.dismiss(toastId); }}
        onCloseClick={() => { commit(); sonnerToast.dismiss(toastId); }}
      />
    ),
    { duration: durationMs },
  );

  timer = setTimeout(commit, durationMs);

  return id;
}

export const toast = Object.assign(
  (title: string | React.ReactNode, options?: CustomToastOptions) =>
    sonnerToast.custom((id) => <CustomToastBase id={id} title={title} type="default" {...options} />, { duration: options?.duration }),
  {
    success: (title: string | React.ReactNode, options?: CustomToastOptions) =>
      sonnerToast.custom((id) => <CustomToastBase id={id} title={title} type="success" {...options} />, { duration: options?.duration }),
    error: (title: string | React.ReactNode, options?: CustomToastOptions) =>
      sonnerToast.custom((id) => <CustomToastBase id={id} title={title} type="error" {...options} />, { duration: options?.duration }),
    warning: (title: string | React.ReactNode, options?: CustomToastOptions) =>
      sonnerToast.custom((id) => <CustomToastBase id={id} title={title} type="warning" {...options} />, { duration: options?.duration }),
    info: (title: string | React.ReactNode, options?: CustomToastOptions) =>
      sonnerToast.custom((id) => <CustomToastBase id={id} title={title} type="info" {...options} />, { duration: options?.duration }),
    loading: (title: string | React.ReactNode, options?: CustomToastOptions) =>
      sonnerToast.custom((id) => <CustomToastBase id={id} title={title} type="loading" {...options} />, { duration: options?.duration }),
    dismiss: sonnerToast.dismiss,
    promise: sonnerToast.promise,
    undo,
  }
);

'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Ancora = { x: number; y: number };

/**
 * Cartão flutuante posicionado perto do clique (popover de criação rápida e
 * de detalhes). No celular vira painel preso embaixo da tela. Fecha com Esc
 * ou clicando fora.
 */
export function Flutuante({
  ancora,
  onClose,
  titulo,
  largura = 360,
  children,
  className,
}: {
  ancora: Ancora;
  onClose: () => void;
  titulo: string;
  largura?: number;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const [mobile, setMobile] = React.useState(false);

  React.useLayoutEffect(() => {
    const m = window.innerWidth < 640;
    setMobile(m);
    if (m) return;
    const alt = ref.current?.offsetHeight ?? 300;
    const left = Math.min(Math.max(12, ancora.x + 12), window.innerWidth - largura - 12);
    const top = Math.min(Math.max(12, ancora.y - 40), window.innerHeight - alt - 12);
    setPos({ left, top });
  }, [ancora.x, ancora.y, largura]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      const alvo = e.target as HTMLElement;
      // Menus e listas em portal (select, busca) não contam como "fora".
      if (ref.current?.contains(alvo) || alvo.closest('[data-radix-popper-content-wrapper],[role="listbox"],[role="dialog"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    const t = window.setTimeout(() => window.addEventListener('pointerdown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown);
      window.clearTimeout(t);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={titulo}
      className={cn(
        'fixed z-[60] rounded-xl border bg-popover text-popover-foreground shadow-2xl',
        mobile ? 'inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-b-none pb-[env(safe-area-inset-bottom)]' : '',
        className,
      )}
      style={mobile ? undefined : { width: largura, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      {children}
    </div>,
    document.body,
  );
}

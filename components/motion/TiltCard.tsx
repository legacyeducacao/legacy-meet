'use client';

import React, { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/utils';

export interface TiltCardProps {
  children: React.ReactNode;
  /** Passthrough puro (sem motion.div/tilt) — usar em cards bloqueados/indisponíveis. */
  disabled?: boolean;
  className?: string;
}

/**
 * Tilt 3D sutil (±2°) que segue o ponteiro, com um brilho especular
 * (radial-gradient) acompanhando o mouse via CSS vars --mx/--my.
 * Passthrough puro (sem motion.div, sem listeners) quando `disabled`,
 * `prefers-reduced-motion` ou ponteiro grosso (touch) — nesses casos
 * renderiza só `children` num <div>, preservando cliques/estrutura.
 */
export const TiltCard: React.FC<TiltCardProps> = ({ children, disabled, className }) => {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [2, -2]), { stiffness: 250, damping: 30 });
  const ry = useSpring(useTransform(px, [0, 1], [-2, 2]), { stiffness: 250, damping: 30 });
  const isTouch =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  if (disabled || reduced || isTouch) {
    return <div className={className}>{children}</div>;
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const relX = e.clientX - r.left;
    const relY = e.clientY - r.top;
    px.set(relX / r.width);
    py.set(relY / r.height);
    glowRef.current?.style.setProperty('--mx', `${(relX / r.width) * 100}%`);
    glowRef.current?.style.setProperty('--my', `${(relY / r.height) * 100}%`);
  };

  const handlePointerLeave = () => {
    px.set(0.5);
    py.set(0.5);
    glowRef.current?.style.setProperty('--mx', '50%');
    glowRef.current?.style.setProperty('--my', '50%');
  };

  // I5(a): zera a rotação no clique. Sem isto, um clique no card enquanto o
  // ponteiro ainda estava fora de centro (tilt vivo, ex.: perto de uma
  // borda) deixava o card levemente rotacionado no exato frame em que o
  // layoutId do título (WorkflowDashboard) mede sua posição pra animar —
  // a medição saía distorcida e a animação de morph do título "pulava".
  // Zerar aqui (em vez de só no leave) garante que o clique sempre parte de
  // rotação ~0, independente de onde o ponteiro estava.
  const handlePointerDown = () => {
    px.set(0.5);
    py.set(0.5);
  };

  return (
    <motion.div
      ref={ref}
      className={cn('relative', className)}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
    >
      {children}
      <div
        ref={glowRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] overflow-hidden"
        style={{
          background:
            'radial-gradient(240px circle at var(--mx, 50%) var(--my, 50%), hsl(var(--sidebar-primary) / 0.06), transparent 70%)',
        }}
      />
    </motion.div>
  );
};

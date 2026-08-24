'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

/**
 * Confete CONTIDO no card — versão reduzida do StepCompletedCelebration para
 * comemorar uma meta cruzando 100% sem cobrir a tela: sem portal, sem
 * backdrop, sem mensagem, só as partículas. O componente aplica
 * `absolute inset-0 pointer-events-none` em si mesmo; o PAI precisa de
 * `relative overflow-visible` (sem isso as partículas mais distantes do
 * centro cortam no limite do container).
 *
 * `fire` é a borda de subida do gatilho (ex.: `useCrossedGoal(pct)`): o
 * burst dispara quando `fire` vira `true` e chama `onDone` ~700ms depois —
 * o pai usa isso pra zerar seu próprio estado local de disparo.
 */
export interface MiniBurstProps {
  /** true dispara um burst novo. */
  fire: boolean;
  /** Chamado ao fim da animação (~700ms) — o pai deve zerar `fire`. */
  onDone: () => void;
  /**
   * Raio máximo das partículas em px (faixa fica 18..maxDist). Default 40 —
   * ok pra ancoradores grandes (badge do GoalsDashboard). Ancoradores
   * pequenos (ex.: anel de 36px do StrategicGoalsView, dentro de card com
   * padding 12-16px e overflow-hidden) devem passar algo menor, ex. 24, pra
   * não cortar feio na borda do card.
   */
  maxDist?: number;
}

const BURST_MS = 700;
const PARTICLES = 12;
const MIN_DIST = 18;
const DEFAULT_MAX_DIST = 40;

const CONFETTI_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--sidebar-primary))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
];

interface Particle {
  xEnd: number;   // destino radial horizontal (px)
  yEnd: number;   // destino radial vertical (px)
  droop: number;  // queda gravitacional no fim (px)
  delay: number;
  duration: number;
  rotate: number;
  color: string;
  size: number;
}

function makeParticles(maxDist: number): Particle[] {
  // Nunca deixa a faixa inverter caso alguém passe maxDist < MIN_DIST.
  const max = Math.max(MIN_DIST, maxDist);
  return Array.from({ length: PARTICLES }, (_, i) => {
    // Explosão radial: ângulos distribuídos no círculo completo com jitter,
    // raio variável — MIN_DIST a maxDist (card pequeno, nada de vmin de
    // tela cheia).
    const angle = (i / PARTICLES) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const dist = MIN_DIST + Math.random() * (max - MIN_DIST);
    return {
      xEnd: Math.cos(angle) * dist,
      yEnd: Math.sin(angle) * dist,
      droop: 2 + Math.random() * 3,
      delay: Math.random() * 0.08,
      duration: 0.4 + Math.random() * 0.15,
      rotate: (Math.random() < 0.5 ? -1 : 1) * (280 + Math.random() * 320),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 4 + Math.random() * 3,
    };
  });
}

export const MiniBurst: React.FC<MiniBurstProps> = ({ fire, onDone, maxDist = DEFAULT_MAX_DIST }) => {
  const reducedMotion = useReducedMotion();
  // Novo conjunto de partículas a cada disparo.
  const particles = useMemo(() => (fire && !reducedMotion ? makeParticles(maxDist) : []), [fire, reducedMotion, maxDist]);

  // onDone vive num ref pelo mesmo motivo do StepCompletedCelebration: o pai
  // costuma passar uma arrow inline, e com ela nas dependências qualquer
  // re-render do card (autosave, refetch...) rearmaria o timeout.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    if (!fire) return;
    // reduced-motion: sem animação, mas o pai ainda precisa zerar `fire` —
    // chama onDone direto em vez de agendar 700ms à toa (o burst nem chega
    // a renderizar: componente retorna null logo abaixo).
    if (reducedMotion) {
      onDoneRef.current();
      return;
    }
    const t = setTimeout(() => onDoneRef.current(), BURST_MS);
    return () => clearTimeout(t);
  }, [fire, reducedMotion]);

  if (reducedMotion) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      <AnimatePresence>
        {fire && particles.map((p, i) => (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 rounded-[2px] will-change-transform"
            style={{ width: p.size, height: p.size, backgroundColor: p.color }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.4 }}
            animate={{
              // Fase 1 (estouro): dispara rápido até ~75% do raio;
              // Fase 2 (deriva): completa o raio devagar, com leve queda.
              x: [0, p.xEnd * 0.75, p.xEnd],
              y: [0, p.yEnd * 0.75, p.yEnd + p.droop],
              opacity: [1, 1, 0],
              rotate: [0, p.rotate * 0.6, p.rotate],
              scale: [0.4, 1, 0.85],
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: p.duration,
              delay: p.delay,
              times: [0, 0.32, 1],
              ease: ['circOut', 'easeOut'],
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default MiniBurst;

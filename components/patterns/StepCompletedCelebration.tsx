'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { PartyPopper } from 'lucide-react';

/**
 * Celebração de conclusão de etapa (gamificação de workflows/wizards):
 * overlay de tela cheia com confetes em Framer Motion + mensagem central,
 * auto-dismiss. Não bloqueia cliques (pointer-events-none) e respeita
 * prefers-reduced-motion (só a mensagem, sem confetes).
 *
 * Snapshot 2026-08-12 de `components/StepCompletedCelebration.tsx` do app,
 * generalizado: o app usa só `stepId` (número da etapa) para compor o texto
 * "Etapa N Concluída!"; aqui `title`/`subtitle` são props livres para servir
 * qualquer produto — omita-as para manter o texto padrão do app (exige
 * `stepId` numérico), ou passe `title` para um texto totalmente customizado
 * (útil quando não há "etapa" a numerar, ex.: "Meta batida!").
 */
interface StepCompletedCelebrationProps {
  /** Número da etapa concluída — `null` esconde o overlay. Também usado para gerar o `title` padrão. */
  stepId: number | null;
  /** Chamado ao fim da celebração (limpar o estado no pai). */
  onDone: () => void;
  /** Título central. Default: `Etapa ${stepId} Concluída!` — obrigatório se `stepId` for usado só como gatilho (não numérico no seu domínio). */
  title?: string;
  /** Subtítulo abaixo do título. Default: "Excelente trabalho 🎉". */
  subtitle?: string;
}

const CELEBRATION_MS = 2800;
const PARTICLE_COUNT = 48;

const CONFETTI_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--sidebar-primary))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--destructive))',
];

interface Particle {
  xEnd: number;   // destino radial horizontal (vmin)
  yEnd: number;   // destino radial vertical (vmin)
  droop: number;  // queda gravitacional no fim (vmin)
  delay: number;
  duration: number;
  rotate: number;
  color: string;
  width: number;
  height: number;
  shape: 'rect' | 'circle';
}

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    // Explosão radial: ângulos distribuídos no círculo completo com jitter,
    // raio variável — do centro para as extremidades.
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const dist = 18 + Math.random() * 26;
    return {
      xEnd: Math.cos(angle) * dist,
      yEnd: Math.sin(angle) * dist,
      droop: 5 + Math.random() * 8,
      delay: Math.random() * 0.12,
      duration: 1.5 + Math.random() * 0.7,
      rotate: (Math.random() < 0.5 ? -1 : 1) * (420 + Math.random() * 480),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      width: 6 + Math.random() * 6,
      height: 8 + Math.random() * 8,
      shape: Math.random() < 0.25 ? 'circle' : 'rect',
    };
  });
}

const StepCompletedCelebration: React.FC<StepCompletedCelebrationProps> = ({ stepId, onDone, title, subtitle }) => {
  const reducedMotion = useReducedMotion();
  // Novo conjunto de partículas a cada celebração (stepId muda).
  const particles = useMemo(() => (stepId != null ? makeParticles() : []), [stepId]);

  const resolvedTitle = title ?? `Etapa ${stepId} Concluída!`;
  const resolvedSubtitle = subtitle ?? 'Excelente trabalho 🎉';

  // `onDone` vive num ref porque quem chama costuma passar uma arrow inline:
  // com ele nas dependências, TODO re-render do container (refetch, autosave...)
  // rearmava o timeout e a celebração podia não terminar nunca — um overlay
  // com backdrop-blur preso na tela (achado da revisão 2026-08-11 no app
  // original). O relógio agora depende só de `stepId`, que é o que define
  // uma celebração.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    if (stepId == null) return;
    const t = setTimeout(() => onDoneRef.current(), CELEBRATION_MS);
    return () => clearTimeout(t);
  }, [stepId]);

  return createPortal(
    <AnimatePresence>
      {stepId != null && (
        <motion.div
          key={`celebration-${stepId}`}
          className="fixed inset-0 z-[9998] pointer-events-none overflow-hidden"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
          aria-live="polite"
          role="status"
        >
          {/* Backdrop com blur — escurece e desfoca o app durante a celebração */}
          <motion.div
            className="absolute inset-0 bg-background/30 backdrop-blur-[6px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
          {!reducedMotion && particles.map((p, i) => (
            <motion.span
              key={i}
              className="absolute left-1/2 top-1/2 will-change-transform"
              style={{
                width: p.width,
                height: p.shape === 'circle' ? p.width : p.height,
                backgroundColor: p.color,
                borderRadius: p.shape === 'circle' ? '50%' : 2,
              }}
              initial={{ x: '0vmin', y: '0vmin', opacity: 1, rotate: 0, scale: 0.4 }}
              animate={{
                // Fase 1 (estouro): dispara rápido até ~75% do raio;
                // Fase 2 (deriva): completa o raio devagar, com leve queda.
                x: ['0vmin', `${p.xEnd * 0.75}vmin`, `${p.xEnd}vmin`],
                y: ['0vmin', `${p.yEnd * 0.75}vmin`, `${p.yEnd + p.droop}vmin`],
                opacity: [1, 1, 0],
                rotate: [0, p.rotate * 0.6, p.rotate],
                scale: [0.4, 1, 0.85],
              }}
              transition={{
                duration: p.duration,
                delay: p.delay,
                times: [0, 0.32, 1],
                ease: ['circOut', 'easeOut'],
              }}
            />
          ))}

          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div
              className="flex items-center gap-3 px-6 py-4 rounded-2xl bg-card border border-sidebar-primary/40 shadow-2xl"
              initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.6, y: reducedMotion ? 0 : 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.9 }}
              transition={{ type: 'spring', damping: 16, stiffness: 260 }}
            >
              <motion.span
                initial={reducedMotion ? false : { rotate: -18, scale: 0.6 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ type: 'spring', damping: 8, stiffness: 200, delay: 0.12 }}
                className="text-sidebar-primary"
              >
                <PartyPopper size={30} />
              </motion.span>
              <div>
                <p className="text-xl font-extrabold text-foreground leading-tight">
                  {resolvedTitle}
                </p>
                <p className="text-sm font-medium text-muted-foreground">{resolvedSubtitle}</p>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default StepCompletedCelebration;

'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useAppReducedMotion } from '../../lib/useAppReducedMotion';

export interface FadeInContentProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Crossfade sutil pra conteúdo que acabou de terminar de carregar
 * (skeleton → conteúdo). Anima só na entrada — monta com opacity 0/y 4 e
 * relaxa pra opacity 1/y 0 em 150ms. Como o branch de loading e o branch de
 * conteúdo costumam ser mutuamente exclusivos (if/else no JSX), o unmount do
 * skeleton + mount deste componente já é o "mount natural": não precisa de
 * AnimatePresence (sem exit) e trocar filtro/estado SEM desmontar o branch
 * carregado não reaciona a animação, porque o `initial` só se aplica uma
 * vez, no mount.
 *
 * `useAppReducedMotion` (preferência do SO OU toggle in-app) desliga a
 * animação: renderiza o mesmo `motion.div` mas com `initial={false}`, então
 * já nasce no estado final sem transição.
 */
export function FadeInContent({ children, className }: FadeInContentProps) {
  const reducedMotion = useAppReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reducedMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.15, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

export default FadeInContent;

'use client';

﻿import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
import { cn } from '../../lib/utils';

/**
 * Balão de dica do Plan — o mesmo da sidebar recolhida, agora com direção.
 *
 * Nasceu dentro do SidebarNavItem, apontando sempre para a direita. Extraído
 * aqui porque a segunda tela que precisou dele (abas DRE/DFC) o queria embaixo:
 * copiar o balão significaria duas setas, duas animações e dois azuis para
 * manter em sincronia.
 *
 * A seta é o MESMO desenho nas quatro direções — um triângulo com a ponta
 * arredondada, girado por CSS. Redesenhá-lo por orientação faria as pontas
 * saírem sutilmente diferentes entre si.
 */
export type LadoDoBalao = 'top' | 'right' | 'bottom' | 'left';

/** Giro da seta e ordem no flex, por lado do balão. */
const GEOMETRIA: Record<LadoDoBalao, { eixo: string; giro: string; caixa: string; margem: string }> = {
  // `right` = balão à direita do gatilho, seta apontando para a ESQUERDA.
  right:  { eixo: 'flex-row',         giro: 'rotate-0',    caixa: 'h-3 w-[5px]', margem: '-mr-px' },
  left:   { eixo: 'flex-row-reverse', giro: 'rotate-180',  caixa: 'h-3 w-[5px]', margem: '-ml-px' },
  bottom: { eixo: 'flex-col',         giro: 'rotate-90',   caixa: 'h-[5px] w-3', margem: '-mb-px' },
  top:    { eixo: 'flex-col-reverse', giro: '-rotate-90',  caixa: 'h-[5px] w-3', margem: '-mt-px' },
};

/** Deslocamento de entrada da animação, no sentido de onde o balão surge. */
const ENTRADA: Record<LadoDoBalao, { x?: number; y?: number }> = {
  right: { x: -8 }, left: { x: 8 }, bottom: { y: -8 }, top: { y: 8 },
};

export function TooltipBalao({
  label, side = 'right', align = 'center', sideOffset = 2, children, className,
}: {
  label: React.ReactNode;
  side?: LadoDoBalao;
  /**
   * Onde o balão encosta no gatilho.
   *
   * `center` (padrão) espalha o balão para os dois lados — num gatilho estreito
   * e rótulo longo, ele avança sobre o que estiver ao lado (foi assim que a
   * dica das abas passou por cima da sidebar). `start` alinha as bordas
   * iniciais, então o balão só cresce para dentro do conteúdo.
   */
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /** O gatilho. Recebe os handlers do Radix via `asChild`. */
  children: React.ReactElement;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const g = GEOMETRIA[side];
  const entrada = ENTRADA[side];

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip open={aberto} onOpenChange={setAberto}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        {/* `forceMount` + AnimatePresence: sem ele o Radix desmonta o conteúdo
            antes de a animação de saída rodar. */}
        <AnimatePresence>
          {aberto && (
            <TooltipContent
              forceMount
              side={side}
              align={align}
              sideOffset={sideOffset}
              // Respiro mínimo até a borda de qualquer coisa (sidebar, janela):
              // sem ele o Radix encosta o balão no elemento vizinho.
              collisionPadding={8}
              hideArrow
              className={cn('flex items-center p-0 bg-transparent rounded-none animate-none', className)}
            >
              <motion.div
                // A seta acompanha o alinhamento: com `align="start"` ela fica
                // sobre a borda inicial do balão, apontando para o gatilho — no
                // centro, apontaria para o vazio ao lado dele.
                className={cn('flex', g.eixo,
                  align === 'start' ? 'items-start' : align === 'end' ? 'items-end' : 'items-center')}
                initial={{ opacity: 0, scale: 0.96, ...entrada }}
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, ...entrada }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className={cn('relative block shrink-0', g.caixa,
                  // Recuo para a seta cair sobre o gatilho, e não na quina.
                  align === 'start' && (side === 'bottom' || side === 'top') && 'ml-3',
                  align === 'end' && (side === 'bottom' || side === 'top') && 'mr-3')}>
                  <svg
                    width="5" height="12" viewBox="0 0 5 12" fill="none"
                    xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"
                    className={cn('absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2', g.giro)}
                  >
                    <path
                      d="M0.878646 8.12132C-0.292927 6.94975 -0.292928 5.05025 0.878644 3.87868L4.75732 7.15493e-08L4.75732 12L0.878646 8.12132Z"
                      fill="hsl(var(--sidebar-primary))"
                    />
                  </svg>
                </span>
                <span className={cn(
                  'flex h-[26px] items-center whitespace-nowrap rounded bg-sidebar-primary px-2 text-xs font-semibold text-white',
                  g.margem,
                )}>
                  {label}
                </span>
              </motion.div>
            </TooltipContent>
          )}
        </AnimatePresence>
      </Tooltip>
    </TooltipProvider>
  );
}

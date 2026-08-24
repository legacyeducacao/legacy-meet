'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SidebarCollapseButtonProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

/**
 * Botão de recolher/expandir no cabeçalho da sidebar — meia-pill do
 * primary/10 colada na borda direita quando expandida, pill do
 * foreground/16 colada em `left-full` (por fora da sidebar) quando
 * colapsada. `position: absolute`: precisa ficar dentro de um container
 * `relative` (o header da logo).
 *
 * Snapshot 2026-08-12 do `components/sidebar/SidebarCollapseButton.tsx` do
 * app — classes idênticas ao original; só o disparo do toggle varia entre
 * quem consome (estado local vs. prop do pai), por isso `onToggle` é
 * injetado.
 */
export const SidebarCollapseButton: React.FC<SidebarCollapseButtonProps> = ({ isCollapsed, onToggle }) => (
  <button
    onClick={onToggle}
    title={isCollapsed ? 'Expandir' : 'Recolher'}
    aria-label={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
    className={cn(
      'absolute top-1/2 -translate-y-1/2 flex items-center justify-center transition-colors',
      isCollapsed
        ? 'left-full z-50 h-[26px] w-6 rounded-tr-[8px] rounded-br-[8px] bg-foreground/[0.16] text-foreground hover:bg-foreground/[0.25]'
        : 'right-0 h-[26px] w-6 rounded-tl-[8px] rounded-bl-[8px] bg-sidebar-primary/10 text-sidebar-primary hover:bg-sidebar-primary/20',
    )}
  >
    {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
  </button>
);

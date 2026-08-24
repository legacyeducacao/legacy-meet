'use client';

import React from 'react';
import { Search } from 'lucide-react';

export interface SidebarSearchProps {
  isCollapsed: boolean;
  navQuery: string;
  onNavQueryChange: (value: string) => void;
  /** Colapsada → clicar na lupa expande a sidebar inteira (não é dona do
   *  toggle geral — quem decide como expandir é quem chama; ver
   *  SidebarCollapseButton para o botão de recolher/expandir "de verdade"). */
  onExpand: () => void;
}

/**
 * Busca da sidebar — filtra os NavItem via NavQueryContext (SidebarNavItem).
 * Dois estados: colapsada (botão-lupa que expande a sidebar) e expandida
 * (input real).
 *
 * Snapshot 2026-08-12 do `components/sidebar/SidebarSearch.tsx` do app —
 * classes e markup idênticos ao original.
 */
export const SidebarSearch: React.FC<SidebarSearchProps> = ({
  isCollapsed,
  navQuery,
  onNavQueryChange,
  onExpand,
}) => {
  if (isCollapsed) {
    return (
      <div className="pt-3 flex justify-center flex-shrink-0">
        <button
          onClick={onExpand}
          title="Buscar"
          aria-label="Buscar no menu"
          className="w-14 h-14 flex items-center justify-center rounded-xl bg-white/[0.06] text-sidebar-foreground/50 hover:bg-white/[0.09] hover:text-sidebar-foreground transition-colors"
        >
          <Search size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 flex-shrink-0">
      <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-white/[0.06] focus-within:bg-white/[0.09] transition-colors">
        <Search size={15} className="shrink-0 text-sidebar-foreground/40" />
        <input
          value={navQuery}
          onChange={(e) => onNavQueryChange(e.target.value)}
          placeholder="Buscar"
          className="w-full bg-transparent outline-none text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/40"
        />
      </div>
    </div>
  );
};

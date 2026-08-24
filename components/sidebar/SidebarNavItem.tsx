'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { TooltipBalao } from '../ui/tooltip-balao';

/**
 * Contexto module-level para a busca da sidebar: cada NavItem filtra a si
 * mesmo comparando seu label ao termo digitado, sem precisar prop-drill em
 * cada chamada (dezenas de NavItem espalhados pelos blocos de sidebar).
 * Compartilhado entre Layout.tsx (Plan) e GestaoSidebar.tsx (Gestão).
 */
export const NavQueryContext = React.createContext('');
export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
  className?: string;
  variants?: any;
}

/**
 * Item de navegação da sidebar — colapsado (ícone + tooltip Radix/Framer
 * deslizando da esquerda) ou expandido (ícone + label, chevron quando ativo).
 *
 * Extraído em 2026-08-11 (Onda D, achado de duplicação): Layout.tsx (Plan) e
 * GestaoSidebar.tsx (Gestão) tinham ~200 linhas idênticas — este componente,
 * junto de SidebarSearch/SidebarCollapseButton/tenantBranding, é o que sobrou
 * compartilhado. Comportamento e classes IDÊNTICOS ao original em ambos os
 * lados (diff renderizado zero).
 */
export const NavItem: React.FC<NavItemProps> = ({
  icon,
  label,
  active = false,
  collapsed = false,
  onClick,
  className,
  variants,
}) => {
  const navQuery = React.useContext(NavQueryContext);
  if (navQuery && !normalize(label).includes(normalize(navQuery))) return null;

  if (collapsed) {
    // Balão extraído para components/ui/tooltip-balao: as abas DRE/DFC do
    // Dashboard Financeiro precisavam do MESMO balão apontando para baixo, e
    // duplicá-lo significaria duas setas, duas animações e dois azuis.
    return (
      <TooltipBalao label={label} side="right">
        <motion.button
          variants={variants}
          whileTap={{ scale: 0.95 }}
          onClick={onClick}
          className={cn(
            'flex items-center justify-center w-[52px] h-[52px] mx-auto rounded-xl transition-all duration-200 cursor-pointer group relative',
            active
              ? 'bg-sidebar-primary/10 text-sidebar-primary border-l-[1.3px] border-sidebar-primary'
              : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-primary/10',
            className,
          )}
        >
          <span
            className={cn(
              'transition-all duration-200',
              active && 'drop-shadow-[0_0_8px_hsl(var(--sidebar-primary)/0.5)]',
            )}
          >
            {icon}
          </span>
        </motion.button>
      </TooltipBalao>
    );
  }

  return (
    <motion.button
      variants={variants}
      whileHover={{ x: 4 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'flex items-center w-full rounded-xl transition-all duration-200 cursor-pointer group relative overflow-hidden h-11 px-4 gap-3',
        active
          ? 'bg-sidebar-primary/10 text-sidebar-foreground border-l-[1.3px] border-sidebar-primary'
          : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-primary/10',
        className,
      )}
    >
      <span
        className={cn(
          'transition-all duration-200 shrink-0',
          active ? 'text-sidebar-primary' : 'opacity-50 group-hover:opacity-100',
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          'text-[11px] font-bold uppercase tracking-[0.15em] transition-all whitespace-nowrap',
          active ? 'text-sidebar-foreground' : '',
        )}
      >
        {label}
      </span>
      {active && <ChevronRight size={13} className="absolute right-4 opacity-30" />}
    </motion.button>
  );
};

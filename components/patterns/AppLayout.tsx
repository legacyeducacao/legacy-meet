'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { LogOut, ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import { NavItem, normalize } from '../sidebar/SidebarNavItem';
import { SidebarSearch } from '../sidebar/SidebarSearch';
import { SidebarCollapseButton } from '../sidebar/SidebarCollapseButton';

/**
 * Shell de aplicação do Legacy Plan, desacoplado de roteamento e auth:
 * sidebar dark navy colapsável (desktop), header com blur, header mobile
 * escuro com safe-area e bottom nav mobile.
 *
 * - Navegação: cada item tem uma `key`; o item ativo é `key === activeKey`
 *   e cliques chamam `onNavigate(key)` — plugue seu router aí.
 * - Bottom nav mobile: itens com `showInBottomNav` (máx. 4) + botão Sair.
 * - `headerActions` é o slot à direita dos headers (sino, switchers etc.).
 */
export interface NavEntry {
  key: string;
  label: string;
  icon: React.ReactNode;
  showInBottomNav?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavEntry[];
}

export interface AppLayoutProps {
  children: React.ReactNode;
  title: string;
  sections: NavSection[];
  activeKey: string;
  onNavigate: (key: string) => void;
  onLogout: () => void;
  user: { name: string; role?: string; avatarUrl?: string };
  logo?: { full: React.ReactNode; collapsed: React.ReactNode };
  appName?: string;
  headerActions?: React.ReactNode;
  onUserFooterClick?: () => void;
  onBack?: () => void;
}

const navContainerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const navItemVariants = {
  hidden: { opacity: 0, x: -15 },
  show: { opacity: 1, x: 0, transition: { type: 'spring' as const, damping: 20, stiffness: 100 } },
};

const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  title,
  sections,
  activeKey,
  onNavigate,
  onLogout,
  user,
  logo,
  appName = 'Legacy',
  headerActions,
  onUserFooterClick,
  onBack,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [navQuery, setNavQuery] = useState('');

  const bottomNavItems = sections
    .flatMap((s) => s.items)
    .filter((i) => i.showInBottomNav)
    .slice(0, 4);

  // Busca filtra os itens pelo label — seções que ficam sem nenhum item
  // correspondente somem inteiras (cabeçalho incluso).
  const visibleSections = navQuery
    ? sections
        .map((s) => ({ ...s, items: s.items.filter((i) => normalize(i.label).includes(normalize(navQuery))) }))
        .filter((s) => s.items.length > 0)
    : sections;

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground font-sans selection:bg-primary/20">

      {/* Sidebar */}
      <motion.aside
        initial={{ x: -280 }}
        animate={{ x: 0, width: isCollapsed ? 104 : 240 }}
        transition={{ type: 'tween', duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        className={cn(
          'flex-col hidden md:flex relative z-50',
          'bg-sidebar-background border-r border-sidebar-border shadow-2xl'
        )}
      >
        {/* Sidebar Header — Logo */}
        <div className={cn(
          'h-16 flex items-center flex-shrink-0 border-b border-sidebar-border relative',
          isCollapsed ? 'justify-center px-0' : 'px-5'
        )}>
          {isCollapsed
            ? (logo?.collapsed ?? (
              <div className="h-9 w-9 rounded-lg bg-sidebar-primary/20 text-sidebar-primary flex items-center justify-center font-bold text-sm">
                {appName.charAt(0).toUpperCase()}
              </div>
            ))
            : (logo?.full ?? (
              <span className="text-sidebar-foreground font-bold text-sm truncate">{appName}</span>
            ))}
          <SidebarCollapseButton isCollapsed={isCollapsed} onToggle={() => setIsCollapsed(!isCollapsed)} />
        </div>

        {/* Busca da sidebar — filtra os itens de navegação (visibleSections) */}
        <SidebarSearch
          isCollapsed={isCollapsed}
          navQuery={navQuery}
          onNavQueryChange={setNavQuery}
          onExpand={() => setIsCollapsed(false)}
        />

        {/* Navigation */}
        <nav className={cn(
          'flex-1 py-4 flex flex-col overflow-y-auto',
          isCollapsed ? 'px-2' : 'px-3'
        )}>
          <motion.div
            variants={navContainerVariants}
            initial="hidden"
            animate="show"
            className="space-y-1"
          >
            {visibleSections.map((section, sectionIndex) => (
              <React.Fragment key={section.label ?? sectionIndex}>
                {section.label && !isCollapsed && (
                  <div className="pt-5 pb-2 px-4 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/50">
                    {section.label}
                  </div>
                )}
                {section.label && isCollapsed && <div className="h-px bg-sidebar-border/50 my-3 mx-3" />}
                {section.items.map((item) => (
                  <NavItem
                    key={item.key}
                    variants={navItemVariants}
                    icon={item.icon}
                    label={item.label}
                    active={item.key === activeKey}
                    onClick={() => onNavigate(item.key)}
                    collapsed={isCollapsed}
                  />
                ))}
              </React.Fragment>
            ))}
          </motion.div>

          <div className="flex-1" />

          {/* Bottom Nav */}
          <div className={cn('mt-auto pt-2 border-t border-sidebar-border/50', isCollapsed ? 'space-y-1' : 'space-y-0.5')}>
            <NavItem icon={<LogOut size={18} />} label="Sair" onClick={onLogout} collapsed={isCollapsed} className="text-red-400/50 hover:text-red-400 hover:bg-red-500/10" />
          </div>
        </nav>

        {/* User Footer */}
        <div className={cn('border-t border-sidebar-border', isCollapsed ? 'p-2' : 'p-3')}>
          <button
            onClick={onUserFooterClick}
            className={cn(
              'flex items-center w-full rounded-xl transition-all duration-200 cursor-pointer',
              'hover:bg-sidebar-primary/10',
              isCollapsed ? 'justify-center p-1.5' : 'gap-3 p-2'
            )}
            title={isCollapsed ? user.name : undefined}
          >
            {user.avatarUrl
              ? <img src={user.avatarUrl} alt="User" className={cn(
                  'rounded-lg object-cover ring-1 ring-sidebar-border shadow-sm shrink-0',
                  isCollapsed ? 'w-8 h-8' : 'w-9 h-9'
                )} />
              : <div className={cn(
                  'rounded-lg bg-sidebar-primary/20 flex items-center justify-center text-sidebar-primary font-bold shrink-0',
                  isCollapsed ? 'w-8 h-8 text-xs' : 'w-9 h-9 text-sm'
                )}>{user.name?.charAt(0).toUpperCase()}</div>
            }
            {!isCollapsed && (
              <div className="flex-1 text-left overflow-hidden">
                <p className="text-sm font-semibold text-sidebar-foreground truncate">{user.name}</p>
                {user.role && (
                  <p className="text-[10px] text-sidebar-foreground/40 uppercase tracking-wider truncate">{user.role}</p>
                )}
              </div>
            )}
          </button>
        </div>
      </motion.aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">

        {/* Header Desktop */}
        <header className={cn(
          'h-16 hidden md:flex items-center justify-between pr-8 flex-shrink-0 sticky top-0 z-40 bg-card border-b border-foreground/10',
          isCollapsed ? 'pl-12' : 'pl-8'
        )}>
          <div className="flex items-center gap-3">
            {onBack && (
              <button onClick={onBack} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-muted transition-all">
                <ArrowLeft size={18} />
              </button>
            )}
            <h2 className="text-sm font-bold text-foreground/70 uppercase tracking-widest">{title}</h2>
          </div>

          <div className="flex items-center gap-3">
            {headerActions}
          </div>
        </header>

        {/* Mobile Header — dark sidebar style, extends behind status bar */}
        <header className="flex items-center justify-between px-4 md:hidden flex-shrink-0 sticky top-0 z-50 bg-sidebar-background border-b border-sidebar-border shadow-sm min-h-14" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {onBack ? (
              <button onClick={onBack} className="w-10 h-10 rounded-xl flex items-center justify-center text-sidebar-foreground/60 hover:text-sidebar-foreground active:scale-95 shrink-0 transition-all">
                <ArrowLeft size={20} />
              </button>
            ) : (
              logo?.collapsed ?? <span className="text-sidebar-foreground font-bold text-sm truncate">{appName}</span>
            )}
            <h1 className="text-base font-bold text-sidebar-foreground truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerActions}
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 relative overflow-y-auto px-5 pt-5 md:px-10 md:pt-10">
          <div className="w-full h-full">
            {children}
            {/* Spacer for mobile bottom nav — h-16 nav + safe-area + breathing room */}
            <div className="h-40 md:hidden shrink-0" aria-hidden="true" />
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation — dark sidebar style */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-sidebar-background border-t border-sidebar-border pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch justify-around h-16">
          {bottomNavItems.map((item) => (
            <BottomNavTab
              key={item.key}
              icon={item.icon}
              label={item.label}
              active={item.key === activeKey}
              onClick={() => onNavigate(item.key)}
            />
          ))}
          <BottomNavTab icon={<LogOut size={20} />} label="Sair" active={false} onClick={onLogout} isLogout />
        </div>
      </nav>
    </div>
  );
};

export const BottomNavTab = ({
  icon,
  label,
  active,
  onClick,
  badge,
  isLogout,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  isLogout?: boolean;
}) => (
  <button
    onClick={onClick}
    aria-label={label}
    className={cn(
      'flex flex-col items-center justify-center flex-1 h-16 gap-1 transition-colors duration-200 relative active:scale-95',
      isLogout
        ? 'text-red-400/60 active:text-red-400'
        : active
          ? 'text-sidebar-primary'
          : 'text-sidebar-foreground/40'
    )}
  >
    {active && (
      <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-[3px] rounded-full bg-sidebar-primary" />
    )}
    <span className="relative">
      {icon}
      {badge != null && badge > 0 && (
        <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center px-0.5 border-2 border-sidebar-background">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </span>
    <span className="text-[10px] font-semibold leading-tight">{label}</span>
  </button>
);

export default AppLayout;

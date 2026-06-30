'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home,
  Calendar,
  Video,
  ClipboardList,
  Users,
  LogOut,
  Menu,
  X,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Me = {
  name: string | null;
  isStaff: boolean;
  isAdmin: boolean;
  sector: 'comercial' | 'executoria' | 'ambos' | null;
} | null;

type NavEntry = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/** Item de navegação no estilo Legacy Plan (ativo = pílula azul + barra lateral + chevron). */
function NavItem({
  entry,
  active,
  collapsed,
  onNavigate,
}: {
  entry: NavEntry;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = entry.icon;
  if (collapsed) {
    return (
      <Link
        href={entry.href}
        title={entry.label}
        onClick={onNavigate}
        className={cn(
          'group relative mx-auto flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200',
          active
            ? 'bg-sidebar-primary/15 text-sidebar-primary'
            : 'text-sidebar-foreground/40 hover:bg-sidebar-primary/10 hover:text-sidebar-foreground',
        )}
      >
        <Icon size={19} />
        {active && (
          <span className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-sidebar-primary" />
        )}
      </Link>
    );
  }
  return (
    <Link
      href={entry.href}
      onClick={onNavigate}
      className={cn(
        'group relative flex h-11 w-full items-center gap-3 overflow-hidden rounded-xl px-4 transition-all duration-200 hover:translate-x-1',
        active
          ? 'bg-sidebar-primary/20 text-sidebar-foreground'
          : 'text-sidebar-foreground/50 hover:bg-sidebar-primary/10 hover:text-sidebar-foreground',
      )}
    >
      {active && (
        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-sidebar-primary" />
      )}
      <span
        className={cn(
          'shrink-0 transition-all duration-200',
          active ? 'text-sidebar-primary' : 'opacity-50 group-hover:opacity-100',
        )}
      >
        <Icon size={19} />
      </span>
      <span
        className={cn(
          'whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.15em]',
          active && 'text-sidebar-foreground',
        )}
      >
        {entry.label}
      </span>
      {active && <ChevronRight size={13} className="absolute right-4 opacity-30" />}
    </Link>
  );
}

/**
 * Casca das telas internas com a SIDEBAR do Legacy Plan: navy escura, navegação
 * com item ativo em pílula azul, Recolher/Sair no rodapé e perfil do usuário.
 * No mobile vira um drawer. A chamada (LiveKit) não usa esta casca.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = React.useState<Me>(null);
  const [open, setOpen] = React.useState(false); // drawer mobile
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('meet.sidebarCollapsed') === '1');
    } catch {
      /* sem localStorage */
    }
  }, []);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('meet.sidebarCollapsed', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });

  React.useEffect(() => {
    let active = true;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!active) return;
        const u = j?.user ?? null;
        if (!u || !u.isStaff) {
          router.push(u ? '/sem-acesso' : '/login');
          return;
        }
        setMe(u);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // mount-only: router é estável; não declarado para evitar re-fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // fecha o drawer ao navegar
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const nav: NavEntry[] = [
    { href: '/', label: 'Início', icon: Home },
    { href: '/agenda', label: 'Agenda', icon: Calendar },
    { href: '/gravacoes', label: 'Gravações', icon: Video },
    ...(me && (me.isAdmin || me.sector === 'executoria' || me.sector === 'ambos')
      ? [{ href: '/nps', label: 'NPS', icon: ClipboardList }]
      : []),
    ...(me?.isAdmin ? [{ href: '/admin/usuarios', label: 'Usuários', icon: Users }] : []),
  ];

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* segue para o login mesmo se a chamada falhar */
    }
    router.push('/login');
    router.refresh();
  };

  const initials =
    (me?.name ?? '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '—';

  const renderSidebar = (forDrawer: boolean) => {
    const isColl = collapsed && !forDrawer; // o drawer sempre mostra expandido
    return (
      <aside
        className={cn(
          'flex h-full flex-col bg-sidebar-background text-sidebar-foreground transition-[width] duration-300',
          isColl ? 'w-[72px]' : 'w-60',
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            'flex h-16 flex-shrink-0 items-center border-b border-sidebar-border',
            isColl ? 'justify-center px-0' : 'px-5',
          )}
        >
          {isColl ? (
            <Image src="/favicon.svg" alt="Legacy Meet" width={36} height={36} priority />
          ) : (
            <Image
              src="/logo-legacy-meet.svg"
              alt="Legacy Meet"
              width={123}
              height={40}
              className="object-contain"
              priority
            />
          )}
          {forDrawer && (
            <button
              type="button"
              aria-label="Fechar menu"
              onClick={() => setOpen(false)}
              className="ml-auto text-sidebar-foreground/60 hover:text-white md:hidden"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Navegação */}
        <nav className={cn('flex flex-1 flex-col overflow-y-auto py-4', isColl ? 'px-2' : 'px-3')}>
          <div className="space-y-1">
            {nav.map((e) => (
              <NavItem
                key={e.href}
                entry={e}
                active={isActive(e.href)}
                collapsed={isColl}
                onNavigate={() => setOpen(false)}
              />
            ))}
          </div>

          {/* Recolher + Sair */}
          <div className="mt-auto space-y-0.5 border-t border-sidebar-border/50 pt-2">
            {!forDrawer && (
              <button
                type="button"
                onClick={toggleCollapsed}
                className={cn(
                  'flex w-full items-center rounded-xl text-sidebar-foreground/30 transition-all duration-200 hover:bg-sidebar-primary/10 hover:text-sidebar-foreground',
                  isColl ? 'mx-auto h-10 w-10 justify-center' : 'h-11 gap-3 px-4',
                )}
                title="Recolher"
              >
                {isColl ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                {!isColl && (
                  <span className="text-[11px] font-bold uppercase tracking-[0.15em]">Recolher</span>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={logout}
              className={cn(
                'flex w-full items-center rounded-xl text-red-400/60 transition-all duration-200 hover:bg-red-500/10 hover:text-red-400',
                isColl ? 'mx-auto h-10 w-10 justify-center' : 'h-11 gap-3 px-4',
              )}
              title="Sair"
            >
              <LogOut size={18} />
              {!isColl && (
                <span className="text-[11px] font-bold uppercase tracking-[0.15em]">Sair</span>
              )}
            </button>
          </div>
        </nav>

        {/* Rodapé do usuário */}
        <div className={cn('border-t border-sidebar-border', isColl ? 'p-2' : 'p-3')}>
          <div
            className={cn('flex items-center rounded-xl', isColl ? 'justify-center p-1.5' : 'gap-3 p-2')}
            title={isColl ? (me?.name ?? '') : undefined}
          >
            <div
              className={cn(
                'flex shrink-0 items-center justify-center rounded-lg bg-sidebar-primary/20 font-bold text-sidebar-primary',
                isColl ? 'h-8 w-8 text-xs' : 'h-9 w-9 text-sm',
              )}
            >
              {initials}
            </div>
            {!isColl && (
              <div className="flex-1 overflow-hidden text-left">
                <p className="truncate text-sm font-semibold text-sidebar-foreground">
                  {me?.name ?? 'Carregando…'}
                </p>
                {me && (
                  <p className="truncate text-[10px] uppercase tracking-wider text-sidebar-foreground/40">
                    {me.isAdmin ? 'ADMIN' : (me.sector ?? '')}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
    );
  };

  return (
    <div className="flex h-full">
      {/* Sidebar fixa (desktop) */}
      <div className="hidden md:block">{renderSidebar(false)}</div>

      {/* Drawer (mobile) */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">{renderSidebar(true)}</div>
        </>
      )}

      {/* Coluna de conteúdo */}
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        {/* Topbar (mobile) */}
        <div className="flex h-14 items-center gap-3 border-b border-border/60 bg-card px-4 text-foreground [color-scheme:light] md:hidden">
          <button type="button" aria-label="Abrir menu" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <Link href="/" className="flex items-center gap-2 font-bold text-primary">
            <Image src="/favicon.svg" alt="" width={28} height={28} />
            Legacy Meet
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto bg-background text-foreground [color-scheme:light]">
          <main className="p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

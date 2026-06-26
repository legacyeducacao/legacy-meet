'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Home, Calendar, Video, Users, LogOut, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

type Me = { name: string | null; role: string } | null;

/**
 * Casca das telas internas com SIDEBAR escura (estilo Legacy Plan): navegação
 * à esquerda (navy) + conteúdo claro à direita. No mobile a sidebar vira um
 * drawer. A chamada (LiveKit) não usa esta casca.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = React.useState<Me>(null);
  const [open, setOpen] = React.useState(false); // drawer mobile

  React.useEffect(() => {
    let active = true;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active) setMe(j?.user ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // fecha o drawer ao navegar
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const nav = [
    { href: '/', label: 'Início', icon: Home },
    { href: '/agenda', label: 'Agenda', icon: Calendar },
    { href: '/gravacoes', label: 'Gravações', icon: Video },
    ...(me?.role === 'MASTER'
      ? [{ href: '/admin/usuarios', label: 'Usuários', icon: Users }]
      : []),
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

  const sidebar = (
    <aside className="flex h-full w-64 flex-col bg-sidebar-background text-sidebar-foreground">
      {/* Logo */}
      <div className="flex h-20 items-center justify-between border-b border-sidebar-border px-5">
        <Image src="/logo-legacy-meet.svg" alt="Legacy Meet" width={117} height={38} priority />
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
          className="text-sidebar-foreground/70 hover:text-white md:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navegação */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
        {nav.map(({ href, label, icon: Icon }) => {
          const activeItem = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors',
                activeItem
                  ? 'bg-sidebar-accent text-white'
                  : 'text-sidebar-foreground/55 hover:bg-sidebar-accent/50 hover:text-white',
              )}
            >
              <Icon className={cn('h-[18px] w-[18px]', activeItem && 'text-sidebar-primary')} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Sair + usuário */}
      <div className="mt-auto">
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut className="h-[18px] w-[18px]" />
            Sair
          </button>
        </div>
        <div className="flex items-center gap-3 border-t border-sidebar-border px-5 py-4">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-sidebar-accent text-xs font-semibold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {me?.name ?? 'Carregando…'}
            </p>
            {me?.role && (
              <p className="text-[11px] uppercase tracking-wide text-sidebar-foreground/50">
                {me.role}
              </p>
            )}
          </div>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-full">
      {/* Sidebar fixa (desktop) */}
      <div className="hidden md:block">{sidebar}</div>

      {/* Drawer (mobile) */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">{sidebar}</div>
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

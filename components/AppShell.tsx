'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Home, Calendar, Video, Users, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type Me = { name: string | null; role: string } | null;

/**
 * Casca das telas internas (Início, Gravações, Admin): cabeçalho com marca,
 * navegação e logout, sobre o tema claro do Legacy Plan. A chamada (LiveKit)
 * não usa esta casca.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = React.useState<Me>(null);

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

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-bold text-primary">
            <Image src="/favicon.svg" alt="" width={32} height={32} priority />
            <span className="hidden text-base sm:inline">Legacy Meet</span>
          </Link>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive(href)
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {me?.name && (
              <span className="hidden max-w-[12rem] truncate text-sm text-muted-foreground sm:inline">
                {me.name}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              aria-label="Sair"
              className="gap-2 text-muted-foreground"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

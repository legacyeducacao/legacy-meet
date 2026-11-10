'use client';

import * as React from 'react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, Calendar, CalendarRange, ClipboardList, Home, Users, Video } from 'lucide-react';
import AppLayout, { type NavSection } from '@/components/patterns/AppLayout';
import { ThemeToggle } from '@/components/ThemeToggle';

type Me = {
  name: string | null;
  isStaff: boolean;
  isAdmin: boolean;
  sector: 'comercial' | 'executoria' | 'ambos' | null;
  agendaNova?: boolean;
} | null;

type Route = { key: string; href: string; label: string; icon: React.ReactNode };

const ROUTES: Route[] = [
  { key: 'inicio', href: '/', label: 'Início', icon: <Home size={19} /> },
  { key: 'agenda', href: '/agenda', label: 'Agenda', icon: <Calendar size={19} /> },
  { key: 'agenda-nova', href: '/agenda/nova', label: 'Agenda nova', icon: <CalendarRange size={19} /> },
  { key: 'gravacoes', href: '/gravacoes', label: 'Gravações', icon: <Video size={19} /> },
  { key: 'nps', href: '/nps', label: 'NPS', icon: <ClipboardList size={19} /> },
  { key: 'usuarios', href: '/admin/usuarios', label: 'Usuários', icon: <Users size={19} /> },
  { key: 'diagnostico', href: '/admin/diagnostico', label: 'Diagnóstico', icon: <Activity size={19} /> },
];

/**
 * Casca das telas internas sobre o `AppLayout` do design system Legacy Plan
 * (sidebar navy com busca e colapso, header, bottom nav mobile), com a marca
 * Legacy Meet. A sala de reunião (LiveKit) não usa esta casca.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = React.useState<Me>(null);

  React.useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((json) => setMe(json?.user ?? null))
      .catch(() => setMe(null));
  }, []);

  const canNps = !!me && (me.isAdmin || me.sector === 'executoria' || me.sector === 'ambos');
  const visible = ROUTES.filter((r) => {
    if (r.key === 'nps') return canNps;
    if (r.key === 'agenda-nova') return !!me?.agendaNova;
    if (r.key === 'usuarios' || r.key === 'diagnostico') return !!me?.isAdmin;
    return true;
  });

  const sections: NavSection[] = [
    {
      items: visible.map((r) => ({
        key: r.key,
        label: r.label,
        icon: r.icon,
        showInBottomNav: r.key !== 'usuarios' && r.key !== 'diagnostico',
      })),
    },
  ];

  // O mais específico ganha: /agenda/nova não acende "Agenda".
  const active =
    visible
      .filter((r) => (r.href === '/' ? pathname === '/' : pathname === r.href || pathname.startsWith(r.href + '/')))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? visible[0];

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  };

  return (
    <AppLayout
      title={active?.label ?? 'Legacy Meet'}
      sections={sections}
      activeKey={active?.key ?? 'inicio'}
      onNavigate={(key) => {
        const r = ROUTES.find((x) => x.key === key);
        if (r) router.push(r.href);
      }}
      onLogout={logout}
      user={{ name: me?.name ?? '', role: me?.isAdmin ? 'Admin' : me ? 'Equipe' : undefined }}
      appName="Legacy Meet"
      logo={{
        full: (
          <Image
            src="/logo-legacy-meet.svg"
            alt="Legacy Meet"
            width={150}
            height={36}
            priority
            className="h-9 w-auto"
          />
        ),
        collapsed: <Image src="/favicon.svg" alt="Legacy Meet" width={36} height={36} priority />,
      }}
      headerActions={<ThemeToggle />}
    >
      {children}
    </AppLayout>
  );
}

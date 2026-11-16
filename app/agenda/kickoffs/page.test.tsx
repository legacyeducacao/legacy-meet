import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import type { CurrentUser } from '@/lib/auth';

// tsconfig usa "jsx": "preserve" (o Next compila); no Vitest o JSX vira React.createElement.
(globalThis as { React?: typeof React }).React = React;

// Página "Kickoffs Impulsão": só para quem gerencia kickoffs.
const state = vi.hoisted(() => ({ user: null as CurrentUser | null }));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/components/AppShell', () => ({ AppShell: () => null }));
vi.mock('@/components/agenda-nova/kickoffs/KickoffsImpulsao', () => ({ KickoffsImpulsao: () => null }));

import Page from './page';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});

beforeEach(() => {
  state.user = null;
});

describe('/agenda/kickoffs', () => {
  it('sem sessão vai para o login', async () => {
    await expect(Page()).rejects.toThrow('REDIRECT /login?next=/agenda/kickoffs');
  });

  it('cliente do Plan vai para /sem-acesso', async () => {
    state.user = mk({ isStaff: false, role: 'CLIENT' });
    await expect(Page()).rejects.toThrow('REDIRECT /sem-acesso');
  });

  it('equipe sem a permissão não vê a seção (404)', async () => {
    state.user = mk({});
    await expect(Page()).rejects.toThrow('NOT_FOUND');
  });

  it('quem gerencia kickoffs e o admin abrem a seção', async () => {
    state.user = mk({ capacidades: ['kickoff_impulsao.manage'] });
    await expect(Page()).resolves.toBeTruthy();
    state.user = mk({ isAdmin: true });
    await expect(Page()).resolves.toBeTruthy();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import type { ReactElement } from 'react';
import type { CurrentUser } from '@/lib/auth';

// tsconfig usa "jsx": "preserve" (o Next compila); no Vitest o JSX vira React.createElement.
(globalThis as { React?: typeof React }).React = React;

// Acesso às páginas da agenda (/agenda, /agenda/painel, /agenda/configuracoes).
// O redirect do Next lança um erro; aqui ele vira um erro com o destino.
const state = vi.hoisted(() => ({ user: null as CurrentUser | null }));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
// Telas trocadas por stubs: o teste é só do acesso e das props.
vi.mock('@/components/AppShell', () => ({ AppShell: () => null }));
vi.mock('@/components/agenda-nova/AgendaNova', () => ({ AgendaNova: () => null }));
vi.mock('@/components/agenda-nova/painel/Painel', () => ({ Painel: () => null }));
vi.mock('@/components/agenda-nova/config/Configuracoes', () => ({ Configuracoes: () => null }));

import AgendaPage from './page';
import PainelPage from './painel/page';
import ConfiguracoesPage from './configuracoes/page';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const executor = mk({ id: 'exec-x' });
const comercial = mk({ id: 'com', sector: 'comercial', role: 'COLLABORATOR' });
const admin = mk({ id: 'adm', isAdmin: true, sector: 'ambos', role: 'MASTER' });
const clienteDoPlan = mk({ id: 'cli-a', isStaff: false, sector: null, role: 'CLIENT', email: 'dono@empresa-a.com' });

const paginas = [
  { nome: '/agenda', Page: AgendaPage, login: '/login?next=/agenda' },
  { nome: '/agenda/configuracoes', Page: ConfiguracoesPage, login: '/login?next=/agenda/configuracoes' },
];

/** props.me do componente dentro do AppShell. */
const me = async (Page: () => Promise<ReactElement>) => {
  const el = (await Page()) as ReactElement<{ children: ReactElement<{ me: Record<string, unknown> }> }>;
  return el.props.children.props.me;
};

beforeEach(() => {
  state.user = null;
});

describe('Páginas da agenda: só a equipe do Meet', () => {
  for (const { nome, Page, login } of paginas) {
    it(`${nome}: sem sessão vai para o login (com o retorno de antes)`, async () => {
      await expect(Page()).rejects.toThrow(`REDIRECT ${login}`);
    });

    it(`${nome}: cliente do Plan vai para /sem-acesso`, async () => {
      state.user = clienteDoPlan;
      await expect(Page()).rejects.toThrow('REDIRECT /sem-acesso');
    });

    it(`${nome}: equipe do Meet abre a página`, async () => {
      state.user = executor;
      await expect(Page()).resolves.toBeTruthy();
    });
  }
});

describe('/agenda/painel: só admins do Meet (gestão)', () => {
  it('sem sessão vai para o login (com o retorno de antes)', async () => {
    await expect(PainelPage()).rejects.toThrow('REDIRECT /login?next=/agenda/painel');
  });

  it('equipe que não é admin e cliente do Plan voltam para /agenda (que barra quem não é da equipe)', async () => {
    for (const user of [executor, comercial, clienteDoPlan]) {
      state.user = user;
      await expect(PainelPage()).rejects.toThrow('REDIRECT /agenda');
    }
    state.user = clienteDoPlan;
    await expect(AgendaPage()).rejects.toThrow('REDIRECT /sem-acesso');
  });

  it('admin abre a página', async () => {
    state.user = admin;
    await expect(PainelPage()).resolves.toBeTruthy();
  });
});

describe('/agenda: a opção Comercial segue a regra do servidor (canSeeComercial)', () => {
  it('executor só da Executoria: podeComercial = false', async () => {
    state.user = executor;
    expect(await me(AgendaPage)).toMatchObject({ id: 'exec-x', podeComercial: false });
  });

  it('equipe do Comercial e admin: podeComercial = true', async () => {
    state.user = comercial;
    expect(await me(AgendaPage)).toMatchObject({ podeComercial: true });
    state.user = admin;
    expect(await me(AgendaPage)).toMatchObject({ podeComercial: true, isAdmin: true });
  });
});

describe('/agenda: ferramentas de kickoff só para quem gerencia (podeGerenciarKickoff)', () => {
  it('equipe sem a permissão: podeKickoff = false (sem filtro, sem atalho, sem opção no formulário)', async () => {
    state.user = executor;
    expect(await me(AgendaPage)).toMatchObject({ podeKickoff: false });
    state.user = comercial;
    expect(await me(AgendaPage)).toMatchObject({ podeKickoff: false });
  });

  it('quem tem a permissão e o admin: podeKickoff = true', async () => {
    state.user = mk({ id: 'cs-1', capacidades: ['kickoff_impulsao.manage'] });
    expect(await me(AgendaPage)).toMatchObject({ podeKickoff: true });
    state.user = admin;
    expect(await me(AgendaPage)).toMatchObject({ podeKickoff: true });
  });
});

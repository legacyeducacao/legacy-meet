import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth';

// Entrada única das rotas /api/agenda: usuarioAgenda -> podeUsarAgendaNova.
const state = vi.hoisted(() => ({ user: null as CurrentUser | null }));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));

import { usuarioAgenda } from './rota';
import { podeUsarAgendaNova } from './servidor';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const clienteDoPlan = mk({ id: 'cli-a', isStaff: false, sector: null, role: 'CLIENT', email: 'dono@empresa-a.com' });
const colaboradorDoPlan = mk({ id: 'col-a', isStaff: false, sector: null, role: 'COLLABORATOR', email: 'time@empresa-a.com' });
const equipe = [
  mk({ id: 'exec-x' }),
  mk({ id: 'com', sector: 'comercial', role: 'COLLABORATOR' }),
  mk({ id: 'adm', isAdmin: true, sector: 'ambos', role: 'MASTER' }),
  // Equipe só pelo domínio do e-mail, ainda sem perfil no Meet.
  mk({ id: 'novo', sector: null, role: 'COLLABORATOR' }),
];

beforeEach(() => {
  state.user = null;
});

describe('podeUsarAgendaNova', () => {
  it('sem sessão ou fora da equipe do Meet: não', async () => {
    expect(await podeUsarAgendaNova(null)).toBe(false);
    expect(await podeUsarAgendaNova(clienteDoPlan)).toBe(false);
    expect(await podeUsarAgendaNova(colaboradorDoPlan)).toBe(false);
  });

  it('qualquer pessoa da equipe do Meet: sim (as regras finas ficam em cada rota)', async () => {
    for (const u of equipe) expect(await podeUsarAgendaNova(u)).toBe(true);
  });
});

describe('usuarioAgenda (entrada das rotas /api/agenda)', () => {
  it('sem sessão: 403', async () => {
    const a = await usuarioAgenda();
    expect(a.res?.status).toBe(403);
  });

  it('cliente e colaborador do Plan: 403', async () => {
    for (const u of [clienteDoPlan, colaboradorDoPlan]) {
      state.user = u;
      const a = await usuarioAgenda();
      expect(a.user).toBeUndefined();
      expect(a.res?.status).toBe(403);
    }
  });

  it('equipe do Meet: passa, com o usuário completo para as regras da rota', async () => {
    for (const u of equipe) {
      state.user = u;
      const a = await usuarioAgenda();
      expect(a.res).toBeUndefined();
      expect(a.user).toEqual(u);
    }
  });
});

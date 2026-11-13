import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth';

// /api/me usa podeUsarAgendaNova só para o sinal agendaNova.
const state = vi.hoisted(() => ({ user: null as CurrentUser | null }));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));

import { GET } from './route';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});

beforeEach(() => {
  state.user = null;
});

describe('GET /api/me: sinal agendaNova', () => {
  it('sem sessão: user null (como antes)', async () => {
    expect(await (await GET()).json()).toEqual({ user: null });
  });

  it('cliente do Plan: agendaNova = false', async () => {
    state.user = mk({ id: 'cli-a', isStaff: false, sector: null, role: 'CLIENT', email: 'dono@empresa-a.com' });
    expect((await (await GET()).json()).user).toMatchObject({ id: 'cli-a', isStaff: false, agendaNova: false });
  });

  it('equipe do Meet: agendaNova = true', async () => {
    state.user = mk({ id: 'exec-x' });
    expect((await (await GET()).json()).user).toMatchObject({ id: 'exec-x', isStaff: true, agendaNova: true });
  });
});

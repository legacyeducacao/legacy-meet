import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CurrentUser } from '@/lib/auth';

// Conceder e revogar a permissão kickoff_impulsao.manage pela tela Usuários.
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  perfil: null as Record<string, unknown> | null,
  upserts: [] as Array<Record<string, unknown>>,
  lista: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      if (table === 'users') {
        const q = { select: () => q, ilike: () => q, order: async () => ({ data: state.lista, error: null }) };
        return q;
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.perfil, error: null }) }) }),
        upsert: async (row: Record<string, unknown>) => (state.upserts.push(row), { error: null }),
      };
    },
  }),
}));

import { GET, PATCH } from './route';

const admin: CurrentUser = {
  id: 'adm', email: 'adm@legacyeducacaocorp.com.br', name: 'Admin', role: 'MASTER',
  isStaff: true, isAdmin: true, sector: 'ambos',
};
const patch = (body: Record<string, unknown>) =>
  PATCH(new NextRequest('https://meet.example/api/admin/users', { method: 'PATCH', body: JSON.stringify(body) }));

beforeEach(() => {
  state.user = admin;
  state.perfil = { user_id: 'cs-1', is_admin: false, sector: 'executoria', capacidades: [] };
  state.upserts = [];
  state.lista = [];
});

describe('permissão kickoff_impulsao.manage na tela Usuários', () => {
  it('admin concede', async () => {
    expect((await patch({ userId: 'cs-1', isAdmin: false, sector: 'executoria', kickoffImpulsao: true })).status).toBe(200);
    expect(state.upserts[0]).toMatchObject({ user_id: 'cs-1', is_admin: false, sector: 'executoria', capacidades: ['kickoff_impulsao.manage'] });
  });

  it('admin revoga', async () => {
    state.perfil = { ...state.perfil, capacidades: ['kickoff_impulsao.manage'] };
    await patch({ userId: 'cs-1', isAdmin: false, sector: 'executoria', kickoffImpulsao: false });
    expect(state.upserts[0].capacidades).toEqual([]);
  });

  it('mudar admin ou setor não mexe na permissão (nem exige a coluna nova)', async () => {
    await patch({ userId: 'cs-1', isAdmin: true, sector: 'ambos' });
    expect(state.upserts[0]).not.toHaveProperty('capacidades');
  });

  it('quem não é admin não concede', async () => {
    state.user = { ...admin, isAdmin: false };
    expect((await patch({ userId: 'cs-1', kickoffImpulsao: true })).status).toBe(401);
    expect(state.upserts).toHaveLength(0);
  });

  it('a lista mostra quem tem a permissão, inclusive com perfis antigos sem a coluna', async () => {
    state.lista = [
      { id: 'cs-1', name: 'CS', email: 'cs@legacyeducacaocorp.com.br', meet_user_profile: { is_admin: false, sector: 'executoria', capacidades: ['kickoff_impulsao.manage'] } },
      { id: 'ex-1', name: 'Exec', email: 'ex@legacyeducacaocorp.com.br', meet_user_profile: { is_admin: false, sector: 'executoria' } },
    ];
    const j = await (await GET()).json();
    expect(j.users.map((u: { id: string; kickoffImpulsao: boolean }) => [u.id, u.kickoffImpulsao])).toEqual([
      ['cs-1', true],
      ['ex-1', false],
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CurrentUser } from '@/lib/auth';

// Rota representativa atrás de usuarioAgenda: a entrada barra quem não é da
// equipe, e a regra própria da rota (carteira/admin) continua valendo.
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  carteira: new Map<string, string | null>(),
  matriculas: [] as Array<{ tenantId: string; por: string }>,
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: (_c: string, id: string) => ({
          maybeSingle: async () =>
            state.carteira.has(id) ? { data: { executor_id: state.carteira.get(id) }, error: null } : { data: null, error: null },
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/agenda/grupos', () => ({
  matricular: async (tenantId: string, user: CurrentUser) => {
    state.matriculas.push({ tenantId, por: user.id });
    return { ok: true, jornadaId: 'j1' };
  },
}));

import { POST } from './route';

const EMPRESA_A = '11111111-1111-4111-8111-111111111111';
const EMPRESA_B = '22222222-2222-4222-8222-222222222222';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const executorX = mk({ id: 'exec-x' });
const admin = mk({ id: 'adm', isAdmin: true, sector: 'ambos', role: 'MASTER' });
const clienteDaEmpresaA = mk({ id: 'cli-a', isStaff: false, sector: null, role: 'CLIENT', email: 'dono@empresa-a.com' });

const matricular = (tenantId: string) =>
  POST(
    new NextRequest('https://meet.example/api/agenda/jornadas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId }),
    }),
  );

beforeEach(() => {
  state.user = null;
  state.matriculas = [];
  state.carteira = new Map([
    [EMPRESA_A, 'exec-x'],
    [EMPRESA_B, 'exec-y'],
  ]);
});

describe('POST /api/agenda/jornadas atrás da entrada da agenda', () => {
  it('sem sessão: 403', async () => {
    expect((await matricular(EMPRESA_A)).status).toBe(403);
    expect(state.matriculas).toHaveLength(0);
  });

  it('cliente do Plan: 403 na entrada, nem para a própria empresa', async () => {
    state.user = clienteDaEmpresaA;
    const res = await matricular(EMPRESA_A);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Não autorizado');
    expect(state.matriculas).toHaveLength(0);
  });

  it('executor matricula cliente da carteira e, desde 25/11, também de outra carteira', async () => {
    state.user = executorX;
    expect((await matricular(EMPRESA_A)).status).toBe(200);
    expect((await matricular(EMPRESA_B)).status).toBe(200);
    expect(state.matriculas).toEqual([
      { tenantId: EMPRESA_A, por: 'exec-x' },
      { tenantId: EMPRESA_B, por: 'exec-x' },
    ]);
  });

  it('quem só tem o Comercial não matricula', async () => {
    state.user = mk({ id: 'com', sector: 'comercial', role: 'COLLABORATOR' });
    expect((await matricular(EMPRESA_A)).status).toBe(403);
    expect(state.matriculas).toEqual([]);
  });

  it('admin continua matriculando cliente de qualquer carteira', async () => {
    state.user = admin;
    expect((await matricular(EMPRESA_B)).status).toBe(200);
    expect(state.matriculas).toEqual([{ tenantId: EMPRESA_B, por: 'adm' }]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CurrentUser } from '@/lib/auth';

// Banco falso: só o que a rota usa. Nada toca o Supabase de verdade.
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  carteira: new Map<string, string | null>(), // client_tenants.id -> executor_id
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      if (table === 'client_tenants') {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () =>
                state.carteira.has(id)
                  ? { data: { id, executor_id: state.carteira.get(id) }, error: null }
                  : { data: null, error: null },
            }),
          }),
        };
      }
      return {
        insert(row: Record<string, unknown>) {
          state.inserts.push({ table, row });
          return {
            select: () => ({ single: async () => ({ data: { id: 'meeting-1' }, error: null }) }),
            then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
          };
        },
        delete: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  }),
}));

import { POST } from './route';

const EMPRESA_A = '11111111-1111-4111-8111-111111111111';
const EMPRESA_B = '22222222-2222-4222-8222-222222222222';
const COMERCIAL = '99999999-9999-4999-8999-999999999999';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const executorX = mk({ id: 'exec-x' });
const admin = mk({ id: 'adm', isAdmin: true, sector: 'ambos', role: 'MASTER' });
const comercial = mk({ id: 'com', sector: 'comercial', role: 'COLLABORATOR' });
const clienteDaEmpresaA = mk({ id: 'cli-a', isStaff: false, sector: null, role: 'CLIENT', email: 'dono@empresa-a.com' });
const semVinculo = mk({ id: 'sem', isStaff: false, sector: null, role: 'CLIENT', email: 'x@gmail.com' });

const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest('https://meet.example/api/meetings/local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
const reunioesCriadas = () => state.inserts.filter((i) => i.table === 'meetings');

beforeEach(() => {
  process.env.MEET_COMMERCIAL_TENANT_ID = COMERCIAL;
  state.user = null;
  state.inserts = [];
  state.carteira = new Map([
    [EMPRESA_A, 'exec-x'],
    [EMPRESA_B, 'exec-y'],
  ]);
});

describe('POST /api/meetings/local: autorização por empresa', () => {
  it('sem sessão: 401 e nada é criado', async () => {
    const res = await post({ sector: 'executoria', title: 'Reunião', tenantId: EMPRESA_A });
    expect(res.status).toBe(401);
    expect(reunioesCriadas()).toHaveLength(0);
  });

  it('executor cria reunião para cliente da sua carteira', async () => {
    state.user = executorX;
    const res = await post({ sector: 'executoria', title: 'Planejamento', tenantId: EMPRESA_A });
    expect(res.status).toBe(200);
    expect((await res.json()).roomName).toMatch(/^meet_/);
    expect(reunioesCriadas()).toHaveLength(1);
    expect(reunioesCriadas()[0].row).toMatchObject({ tenant_id: EMPRESA_A, host_id: 'exec-x', status: 'live' });
  });

  it('desde 25/11 o executor cria reunião também para cliente de outro executor; só Comercial não', async () => {
    state.user = executorX;
    expect((await post({ sector: 'executoria', title: 'Alinhamento', tenantId: EMPRESA_B })).status).toBe(200);
    state.inserts = [];
    state.user = comercial;
    const res = await post({ sector: 'executoria', title: 'Invasão', tenantId: EMPRESA_B });
    expect(res.status).toBe(403);
    expect(state.inserts).toHaveLength(0);
  });

  it('cliente de uma empresa (login do Plan) não cria reunião para outra', async () => {
    state.user = clienteDaEmpresaA;
    const res = await post({ sector: 'executoria', title: 'Invasão', tenantId: EMPRESA_B });
    expect(res.status).toBe(403);
    expect(state.inserts).toHaveLength(0);
  });

  it('usuário sem vínculo empresarial não usa tenantId arbitrário (Executoria nem Comercial)', async () => {
    state.user = semVinculo;
    expect((await post({ sector: 'executoria', title: 'X', tenantId: EMPRESA_A })).status).toBe(403);
    expect((await post({ sector: 'comercial', title: 'X', tenantId: EMPRESA_A })).status).toBe(403);
    expect(state.inserts).toHaveLength(0);
  });

  it('admin mantém o acesso a qualquer cliente', async () => {
    state.user = admin;
    const res = await post({ sector: 'executoria', title: 'Revisão', tenantId: EMPRESA_B });
    expect(res.status).toBe(200);
    expect(reunioesCriadas()[0].row).toMatchObject({ tenant_id: EMPRESA_B, host_id: 'adm' });
  });

  it('cliente inexistente: 404 e nada é criado', async () => {
    state.user = admin;
    const res = await post({ sector: 'executoria', title: 'X', tenantId: '44444444-4444-4444-8444-444444444444' });
    expect(res.status).toBe(404);
    expect(state.inserts).toHaveLength(0);
  });

  it('Comercial: continua funcionando e grava sempre a empresa sentinela, ignorando o tenantId do corpo', async () => {
    state.user = comercial;
    const res = await post({ sector: 'comercial', title: 'Reunião com prospect', tenantId: EMPRESA_B });
    expect(res.status).toBe(200);
    expect(reunioesCriadas()[0].row).toMatchObject({ tenant_id: COMERCIAL, host_id: 'com' });
    expect(state.inserts.find((i) => i.table === 'meet_meeting_sector')?.row).toMatchObject({ sector: 'comercial', onboarding: false });
  });
});

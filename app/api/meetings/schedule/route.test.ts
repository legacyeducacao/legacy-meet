import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CurrentUser } from '@/lib/auth';
import type { CriarReunioesInput } from '@/lib/meetingsCore';

// Banco e criação de reuniões falsos: nada toca o Supabase nem o Google Agenda.
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  carteira: new Map<string, string | null>(), // client_tenants.id -> executor_id
  criadas: [] as CriarReunioesInput[],
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () =>
            state.carteira.has(id)
              ? { data: { id, executor_id: state.carteira.get(id) }, error: null }
              : { data: null, error: null },
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/meetingsCore', () => ({
  criarReunioes: async (i: CriarReunioesInput) => {
    state.criadas.push(i);
    return { ok: true, ids: i.ocorrencias.map((_, k) => `m${k}`), roomNames: i.ocorrencias.map((_, k) => `sala-${k}`) };
  },
}));

vi.mock('@/lib/meetingHosts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meetingHosts')>()),
  listTeamMembers: async () => [],
}));

import { POST } from './route';

const EMPRESA_A = '11111111-1111-4111-8111-111111111111';
const EMPRESA_B = '22222222-2222-4222-8222-222222222222';
const COMERCIAL = '99999999-9999-4999-8999-999999999999';
const INICIO = '2026-12-01T13:00:00.000Z';

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
    new NextRequest('https://meet.example/api/meetings/schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Reunião', startAt: INICIO, ...body }),
    }),
  );

beforeEach(() => {
  process.env.MEET_COMMERCIAL_TENANT_ID = COMERCIAL;
  state.user = null;
  state.criadas = [];
  state.carteira = new Map([
    [EMPRESA_A, 'exec-x'],
    [EMPRESA_B, 'exec-y'],
  ]);
});

describe('POST /api/meetings/schedule: autorização por empresa', () => {
  it('sem sessão: 401 e nada é agendado', async () => {
    const res = await post({ sector: 'executoria', tenantId: EMPRESA_A });
    expect(res.status).toBe(401);
    expect(state.criadas).toHaveLength(0);
  });

  it('executor agenda (inclusive série) para cliente da sua carteira', async () => {
    state.user = executorX;
    const res = await post({ sector: 'executoria', tenantId: EMPRESA_A, recurrence: { frequency: 'weekly', count: 4 } });
    expect(res.status).toBe(200);
    expect((await res.json()).occurrences).toBe(4);
    expect(state.criadas).toHaveLength(1);
    expect(state.criadas[0]).toMatchObject({ tenantId: EMPRESA_A, hostId: 'exec-x', sector: 'executoria' });
  });

  it('desde 25/11 o executor agenda também para cliente de outro executor; só Comercial não', async () => {
    state.user = executorX;
    expect((await post({ sector: 'executoria', tenantId: EMPRESA_B })).status).toBe(200);
    state.criadas = [];
    state.user = comercial;
    expect((await post({ sector: 'executoria', tenantId: EMPRESA_B })).status).toBe(403);
    expect(state.criadas).toHaveLength(0);
  });

  it('cliente de uma empresa (login do Plan) não agenda para outra', async () => {
    state.user = clienteDaEmpresaA;
    const res = await post({ sector: 'executoria', tenantId: EMPRESA_B, guestEmails: ['alvo@empresa-b.com'] });
    expect(res.status).toBe(403);
    expect(state.criadas).toHaveLength(0);
  });

  it('usuário sem vínculo empresarial não usa tenantId arbitrário (Executoria nem Comercial)', async () => {
    state.user = semVinculo;
    expect((await post({ sector: 'executoria', tenantId: EMPRESA_A })).status).toBe(403);
    expect((await post({ sector: 'comercial', tenantId: EMPRESA_A })).status).toBe(403);
    expect(state.criadas).toHaveLength(0);
  });

  it('admin mantém o acesso a qualquer cliente', async () => {
    state.user = admin;
    const res = await post({ sector: 'executoria', tenantId: EMPRESA_B });
    expect(res.status).toBe(200);
    expect(state.criadas[0]).toMatchObject({ tenantId: EMPRESA_B, hostId: 'adm' });
  });

  it('Comercial: continua funcionando e usa sempre a empresa sentinela, ignorando o tenantId do corpo', async () => {
    state.user = comercial;
    const res = await post({ sector: 'comercial', tenantId: EMPRESA_B });
    expect(res.status).toBe(200);
    expect(state.criadas[0]).toMatchObject({ tenantId: COMERCIAL, sector: 'comercial', hostId: 'com' });
  });
});

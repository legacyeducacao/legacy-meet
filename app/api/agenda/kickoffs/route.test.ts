import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth';

// Seção "Kickoffs Impulsão": só quem gerencia kickoffs lê.
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  semTabela: false,
  sessoes: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      if (table === 'client_tenants') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Customer Success' }, error: null }) }) }) };
      }
      const erro = state.semTabela ? { code: 'PGRST205', message: 'tabela ausente' } : null;
      const q = {
        select: () => q,
        gte: () => q,
        limit: async () => ({ data: erro ? null : state.sessoes, error: erro }),
        lt: () => q,
      };
      return q;
    },
  }),
}));

import { GET } from './route';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const ORG = '77777777-7777-4777-8777-777777777777';

beforeEach(() => {
  state.user = null;
  state.semTabela = false;
  state.sessoes = [
    {
      capacidade: 5,
      aceita_reservas: true,
      meetings: {
        id: 'k1',
        title: 'Kickoff Impulsão',
        status: 'scheduled',
        scheduled_start_at: '2026-12-01T17:00:00.000Z',
        scheduled_end_at: '2026-12-01T18:00:00.000Z',
        recurrence_parent_id: null,
        users: { name: 'Anfitrião' },
      },
    },
  ];
  process.env.MEET_KICKOFF_TENANT_ID = ORG;
});

describe('GET /api/agenda/kickoffs', () => {
  it('equipe sem a permissão e cliente do Plan não leem', async () => {
    state.user = mk({});
    expect((await GET()).status).toBe(403);
    state.user = mk({ isStaff: false, role: 'CLIENT' });
    expect((await GET()).status).toBe(403);
  });

  it('quem gerencia vê a configuração do tipo de evento e as sessões', async () => {
    state.user = mk({ capacidades: ['kickoff_impulsao.manage'] });
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.estrutura).toBe('ok');
    expect(j.configuracao).toMatchObject({
      organizador: { configurado: true, encontrado: true, nome: 'Customer Success' },
      capacidadePadrao: 5,
      googleAgenda: false,
      salaDoMeet: false,
    });
    expect(j.sessoes).toEqual([
      expect.objectContaining({ id: 'k1', anfitriao: 'Anfitrião', capacidade: 5, status: 'scheduled' }),
    ]);
  });

  it('estrutura pendente e organizadora não configurada aparecem como tal', async () => {
    state.user = mk({ isAdmin: true });
    state.semTabela = true;
    delete process.env.MEET_KICKOFF_TENANT_ID;
    const j = await (await GET()).json();
    expect(j.estrutura).toBe('pendente');
    expect(j.configuracao.organizador.configurado).toBe(false);
    expect(j.sessoes).toEqual([]);
  });
});

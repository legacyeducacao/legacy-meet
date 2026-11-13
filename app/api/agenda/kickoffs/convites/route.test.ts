import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CurrentUser } from '@/lib/auth';

// Gestão dos convites (M3): só quem gerencia kickoffs; o usuário vem da sessão.
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  chamadas: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpc: null as null | ((fn: string) => { data: unknown; error: { code: string; message: string } | null }),
  consultas: 0,
  semTabela: false,
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.chamadas.push({ fn, args });
      return state.rpc ? state.rpc(fn) : { data: { codigo: 'abcdefghjkmn', reutilizado: false }, error: null };
    },
    from: () => {
      state.consultas += 1;
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'is', 'order', 'limit', 'in']) q[m] = () => q;
      q.then = (resolve: (v: unknown) => unknown) =>
        resolve(state.semTabela ? { data: null, error: { code: '42P01', message: 'x' } } : { data: [], error: null });
      return q;
    },
  }),
}));

import { GET, POST } from './route';

const ORG = '77777777-7777-4777-8777-777777777777';
const COMERCIAL = '99999999-9999-4999-8999-999999999999';
const EMPRESA = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://agenda.exemplo.com.br';
const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const gestor = mk({ id: 'gestor-1', capacidades: ['kickoff_impulsao.manage'] });
const req = (body: unknown) =>
  new NextRequest('https://meet.example/api/agenda/kickoffs/convites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  state.user = null;
  state.chamadas = [];
  state.rpc = null;
  state.consultas = 0;
  state.semTabela = false;
  process.env.MEET_KICKOFF_TENANT_ID = ORG;
  process.env.MEET_COMMERCIAL_TENANT_ID = COMERCIAL;
  process.env.KICKOFF_PUBLIC_BASE_URL = BASE;
});

describe('gestão dos convites', () => {
  it('sem KICKOFF_PUBLIC_BASE_URL (ou com endereço local): gerar e reemitir recusam com o motivo, sem ir ao banco', async () => {
    state.user = gestor;
    for (const valor of [undefined, 'http://localhost:3000', 'https://127.0.0.1']) {
      if (valor === undefined) delete process.env.KICKOFF_PUBLIC_BASE_URL;
      else process.env.KICKOFF_PUBLIC_BASE_URL = valor;
      for (const acao of ['gerar', 'reemitir']) {
        const res = await POST(req({ acao, tenantId: EMPRESA, motivo: 'x' }));
        expect(res.status).toBe(409);
        expect(await res.text()).toMatch(/KICKOFF_PUBLIC_BASE_URL/);
      }
    }
    expect(state.chamadas).toEqual([]);
    // A lista continua abrindo e avisa o motivo; revogar não depende do endereço.
    const lista = await (await GET()).json();
    expect(lista.endereco).toEqual({ ok: false, motivo: expect.stringMatching(/KICKOFF_PUBLIC_BASE_URL/) });
    expect((await POST(req({ acao: 'revogar', tenantId: EMPRESA }))).status).toBe(200);
  });

  it('com o endereço oficial, a lista informa a base usada nos links', async () => {
    state.user = gestor;
    expect(await (await GET()).json()).toEqual({ convites: [], endereco: { ok: true, base: BASE } });
  });

  it('sem login, equipe sem a permissão e cliente do Plan não leem nem mexem (o banco nem é chamado)', async () => {
    for (const u of [null, mk({ id: 'equipe' }), mk({ id: 'cli', isStaff: false, role: 'CLIENT', capacidades: ['kickoff_impulsao.manage'] })]) {
      state.user = u;
      expect((await GET()).status).toBe(403);
      for (const acao of ['gerar', 'reemitir', 'revogar']) expect((await POST(req({ acao, tenantId: EMPRESA }))).status).toBe(403);
    }
    expect(state.chamadas).toEqual([]);
    expect(state.consultas).toBe(0);
  });

  it('gestor gera, reemite e revoga; o usuário vai da sessão para o banco', async () => {
    state.user = gestor;
    const gerado = await POST(req({ acao: 'gerar', tenantId: EMPRESA, p_usuario: 'outro' }));
    expect(gerado.status).toBe(200);
    // O link vem do endereço oficial configurado no servidor, nunca do navegador.
    expect((await gerado.json()).convite.link).toBe(`${BASE}/impulsao/agendar/abcdefghjkmn`);
    expect((await POST(req({ acao: 'reemitir', tenantId: EMPRESA, motivo: 'Vazou', dias: 30 }))).status).toBe(200);
    expect((await POST(req({ acao: 'revogar', tenantId: EMPRESA }))).status).toBe(200);
    expect(state.chamadas).toEqual([
      { fn: 'agenda_kickoff_convite_gerar', args: { p_tenant_id: EMPRESA, p_validade_dias: null, p_usuario: 'gestor-1' } },
      { fn: 'agenda_kickoff_convite_reemitir', args: { p_tenant_id: EMPRESA, p_validade_dias: 30, p_motivo: 'Vazou', p_usuario: 'gestor-1' } },
      { fn: 'agenda_kickoff_convite_revogar', args: { p_tenant_id: EMPRESA, p_motivo: null, p_usuario: 'gestor-1' } },
    ]);
  });

  it('empresas internas não recebem convite; ação desconhecida e empresa inválida não chegam ao banco', async () => {
    state.user = gestor;
    for (const tenantId of [ORG, COMERCIAL]) {
      const res = await POST(req({ acao: 'gerar', tenantId }));
      expect(res.status).toBe(422);
    }
    expect((await POST(req({ acao: 'apagar', tenantId: EMPRESA }))).status).toBe(400);
    expect((await POST(req({ acao: 'gerar', tenantId: 'x' }))).status).toBe(400);
    expect(state.chamadas).toEqual([]);
  });

  it('recusa do banco volta com a mensagem dele; sem a migration, a lista avisa', async () => {
    state.user = gestor;
    state.rpc = () => ({ data: null, error: { code: '22023', message: 'Esta empresa já concluiu o kickoff: não precisa de convite.' } });
    const res = await POST(req({ acao: 'gerar', tenantId: EMPRESA }));
    expect(res.status).toBe(422);
    expect(await res.text()).toBe('Esta empresa já concluiu o kickoff: não precisa de convite.');
    state.semTabela = true;
    expect((await GET()).status).toBe(503);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CurrentUser } from '@/lib/auth';

// Acesso Zoom no painel da equipe (Zoom E2): a ação explícita "gerar acesso" e o
// estado mostrado nas reservas. Banco e Zoom simulados (o fetch global é um Zoom
// falso que falha em qualquer URL inesperada). Só quem gerencia kickoffs.
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpc: {} as Record<string, { data: unknown; error: { code: string; message: string } | null }>,
  tabelas: {} as Record<string, { data: unknown; error: { code: string; message: string } | null }>,
  consultas: [] as string[],
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcs.push({ fn, args });
      return state.rpc[fn] ?? { data: null, error: null };
    },
    from: (tabela: string) => {
      state.consultas.push(tabela);
      const r = state.tabelas[tabela] ?? { data: [], error: null };
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'order', 'limit', 'eq', 'in', 'is', 'neq']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
      q.then = (resolve: (v: unknown) => unknown) => resolve(r);
      return q;
    },
  }),
}));

import { POST } from './[id]/route';
import { acessosDoPainel } from '@/lib/kickoff/zoomAcesso';
import { _esquecerClienteZoom } from '@/lib/kickoff/zoomSalaServidor';

const SALA = '81234567890';
const RESERVA = '44444444-4444-4444-8444-444444444444';
const INSCRICAO = '55555555-5555-4555-8555-555555555555';
const TENANT = 'a1b2c3d4-0000-4000-8000-000000000001';
const CODIGO = 'abcdefghjkmn';
const JOIN = `https://us02web.zoom.us/w/${SALA}?tk=SEGREDO-INDIVIDUAL`;
const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const gestor = mk({ id: 'gestor-1', capacidades: ['kickoff_impulsao.manage'] });
const gerar = (id = RESERVA) =>
  POST(
    new NextRequest(`https://meet.example/api/agenda/kickoffs/reservas/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acao: 'gerarAcesso', usuario: 'intruso', tenantId: 'x' }) }),
    { params: Promise.resolve({ id }) },
  );
const contexto = { reserva_id: RESERVA, tenant_id: TENANT, empresa: 'Padaria Pão Bom', participante: 'Maria Silva', email: 'maria@padaria.com.br', zoom_meeting_id: SALA };
const ok = (data: unknown) => ({ data, error: null });
const fns = () => state.rpcs.map((r) => r.fn);

let zoom: { chamadas: string[]; statusAoInscrever: number };
beforeEach(() => {
  state.user = null;
  state.rpcs = [];
  state.rpc = {};
  state.tabelas = {};
  state.consultas = [];
  process.env.ZOOM_ACCOUNT_ID = 'conta';
  process.env.ZOOM_CLIENT_ID = 'cliente';
  process.env.ZOOM_CLIENT_SECRET = 'segredo-do-servidor';
  process.env.KICKOFF_PUBLIC_BASE_URL = 'https://kickoff.legacy.example';
  _esquecerClienteZoom();
  zoom = { chamadas: [], statusAoInscrever: 201 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const metodo = (init?.method ?? 'GET').toUpperCase();
      zoom.chamadas.push(`${metodo} ${u.replace(/\?.*$/, '')}`);
      if (u.startsWith('https://zoom.us/oauth/token')) return new Response(JSON.stringify({ access_token: 'tok-secreto', expires_in: 3600 }), { status: 200 });
      if (metodo === 'GET' && u === `https://api.zoom.us/v2/meetings/${SALA}`) return new Response(JSON.stringify({ id: 1, type: 8, settings: { approval_type: 0, registration_type: 1 } }), { status: 200 });
      if (metodo === 'POST' && u === `https://api.zoom.us/v2/meetings/${SALA}/registrants`) {
        return zoom.statusAoInscrever === 201
          ? new Response(JSON.stringify({ registrant_id: 'reg-1', join_url: JOIN }), { status: 201 })
          : new Response(JSON.stringify({ code: 0, message: 'detalhe interno' }), { status: zoom.statusAoInscrever });
      }
      if (metodo === 'GET' && u.endsWith('/registrants/reg-1')) return new Response(JSON.stringify({ id: 'reg-1', email: 'maria@padaria.com.br', first_name: 'Maria', last_name: 'Silva | Padaria Pão Bom #A1B2C3D4', status: 'approved' }), { status: 200 });
      throw new Error(`chamada externa inesperada: ${metodo} ${u}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/agenda/kickoffs/reservas/[id] { acao: "gerarAcesso" }', () => {
  it('sem login, equipe sem a permissão e cliente do Plan: barrados, sem banco nem Zoom', async () => {
    for (const [user, status] of [
      [null, 401],
      [mk({ id: 'equipe' }), 403],
      [mk({ id: 'cliente', isStaff: false, role: 'CLIENT' }), 403],
    ] as const) {
      state.user = user;
      const res = await gerar();
      expect([status, 403]).toContain(res.status);
    }
    expect(state.rpcs).toEqual([]);
    expect(zoom.chamadas).toEqual([]);
  });

  it('gera o acesso com o usuário da sessão, cria o convite que faltava e devolve o endereço da Legacy (nunca o link do Zoom)', async () => {
    state.user = gestor;
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = ok({ acao: 'criar', inscricao: { id: INSCRICAO }, contexto });
    state.tabelas.agenda_kickoff_reservas = ok({ tenant_id: TENANT, status: 'ativa' });
    state.tabelas.agenda_kickoff_convites = ok([]);
    state.rpc.agenda_kickoff_convite_gerar = ok({ codigo: CODIGO, reutilizado: false });
    const res = await gerar();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toEqual({
      ok: true,
      acesso: { estado: 'pronto', mensagem: 'Acesso Zoom pronto.', endereco: `https://kickoff.legacy.example/impulsao/reuniao/${CODIGO}`, avisoDoEndereco: null },
    });
    expect(JSON.stringify(j)).not.toMatch(/SEGREDO|zoom\.us|reg-1/);
    // A equipe pede no modo "tentar de novo", identificada pela sessão (nada do corpo).
    expect(state.rpcs[0]).toEqual({ fn: 'agenda_kickoff_zoom_inscricao_decidir', args: { p_reserva_id: RESERVA, p_modo: 'tentar_de_novo', p_usuario: 'gestor-1' } });
    expect(state.rpcs.find((r) => r.fn === 'agenda_kickoff_convite_gerar')?.args).toEqual({ p_tenant_id: TENANT, p_validade_dias: null, p_usuario: 'gestor-1' });
    expect(JSON.stringify(state.rpcs)).not.toContain('intruso');
    expect(zoom.chamadas).toContain(`POST https://api.zoom.us/v2/meetings/${SALA}/registrants`);
  });

  it('empresa já tem convite em vigor (mesmo expirado): reaproveita o código, sem gerar outro', async () => {
    state.user = gestor;
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = ok({ acao: 'reaproveitar', inscricao: { id: INSCRICAO, zoom_registrant_id: 'reg-1', join_url: JOIN, verificada_em: new Date().toISOString() }, contexto });
    state.tabelas.agenda_kickoff_reservas = ok({ tenant_id: TENANT, status: 'ativa' });
    state.tabelas.agenda_kickoff_convites = ok([{ codigo: CODIGO }]);
    const j = await (await gerar()).json();
    expect(j.acesso).toMatchObject({ estado: 'pronto', endereco: `https://kickoff.legacy.example/impulsao/reuniao/${CODIGO}` });
    expect(fns()).toEqual(['agenda_kickoff_zoom_inscricao_decidir']);
    expect(zoom.chamadas).toEqual([]);
  });

  it('falha do Zoom, conflito, sala ausente e reserva inativa: 200 com o estado e a explicação para a equipe; a reserva não é tocada', async () => {
    state.user = gestor;
    state.tabelas.agenda_kickoff_reservas = ok({ tenant_id: TENANT, status: 'ativa' });
    state.tabelas.agenda_kickoff_convites = ok([{ codigo: CODIGO }]);
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = ok({ acao: 'criar', inscricao: { id: INSCRICAO }, contexto });
    zoom.statusAoInscrever = 503;
    let j = await (await gerar()).json();
    expect(j.acesso).toMatchObject({ estado: 'erro', mensagem: 'O Zoom está com instabilidade. Tente de novo em instantes.' });
    expect(JSON.stringify(j)).not.toContain('detalhe interno');

    const casos: Array<[unknown, string, RegExp]> = [
      [{ acao: 'conflito', motivo: 'outra_empresa' }, 'conflito', /outra empresa/],
      [{ acao: 'indisponivel', motivo: 'sem_sala' }, 'sem_sala', /Sala Zoom/],
      [{ acao: 'indisponivel', motivo: 'sala_com_problemas' }, 'sala_com_problemas', /problemas/],
      [{ acao: 'indisponivel', motivo: 'reserva_inativa' }, 'reserva_inativa', /reserva ativa/],
      [{ acao: 'aguardar' }, 'preparando', /Outro pedido/],
    ];
    for (const [decisao, estado, texto] of casos) {
      state.rpc.agenda_kickoff_zoom_inscricao_decidir = ok(decisao);
      j = await (await gerar()).json();
      expect(j.acesso.estado).toBe(estado);
      expect(j.acesso.mensagem).toMatch(texto);
    }
    expect(fns().filter((f) => /cancelar|remanejar|atualizar_participante/.test(f))).toEqual([]);
  });

  it('sem credenciais (409), migration 007 pendente (503), permissão recusada pelo banco (403), id inválido (404)', async () => {
    state.user = gestor;
    expect((await gerar('nao-e-uuid')).status).toBe(404);
    delete process.env.ZOOM_CLIENT_ID;
    let res = await gerar();
    expect(res.status).toBe(409);
    expect(await res.text()).toBe('Integração Zoom não configurada no servidor: falta ZOOM_CLIENT_ID.');
    expect(state.rpcs).toEqual([]);
    process.env.ZOOM_CLIENT_ID = 'cliente';
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = { data: null, error: { code: 'PGRST202', message: 'function does not exist' } };
    res = await gerar();
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('migration 007');
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = { data: null, error: { code: '42501', message: 'Só quem gerencia os kickoffs do Impulsão pode fazer isso.' } };
    expect((await gerar()).status).toBe(403);
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = { data: null, error: { code: 'XX000', message: 'detalhe interno do banco' } };
    res = await gerar();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('detalhe interno');
    expect(zoom.chamadas).toEqual([]);
  });

  it('sem KICKOFF_PUBLIC_BASE_URL: o acesso é gerado, mas o endereço não é montado e o motivo aparece', async () => {
    state.user = gestor;
    delete process.env.KICKOFF_PUBLIC_BASE_URL;
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = ok({ acao: 'criar', inscricao: { id: INSCRICAO }, contexto });
    const j = await (await gerar()).json();
    expect(j.acesso).toMatchObject({ estado: 'pronto', endereco: null });
    expect(j.acesso.avisoDoEndereco).toContain('KICKOFF_PUBLIC_BASE_URL');
    expect(fns()).not.toContain('agenda_kickoff_convite_gerar');
  });
});

describe('estado do acesso no painel (acessosDoPainel)', () => {
  const linha = (estado: string, extra: Record<string, unknown> = {}) => ({ reserva_id: RESERVA, estado, erro: null, nome_no_zoom: null, nome_difere: false, sala_anterior: false, sala_com_problemas: false, atualizado_em: null, ...extra });
  const reservas = [
    { id: RESERVA, tenantId: TENANT, status: 'ativa' },
    { id: '66666666-6666-4666-8666-666666666666', tenantId: TENANT, status: 'cancelada' },
  ];

  it('só lê o banco (nenhuma chamada ao Zoom), só reservas ativas, e nunca traz link do Zoom nem id de registrante', async () => {
    state.tabelas.agenda_kickoff_zoom_salas = ok({ verificacao_ok: true });
    state.tabelas.agenda_kickoff_convites = ok([{ codigo: CODIGO, tenant_id: TENANT }]);
    state.rpc.agenda_kickoff_zoom_acessos = ok([linha('pronto', { nome_no_zoom: 'Maria Silva | Padaria #A1B2C3D4', join_url: JOIN, zoom_registrant_id: 'reg-1' })]);
    const p = await acessosDoPainel(reservas);
    expect(p).toEqual({
      estrutura: 'ok',
      integracao: { configurada: true, faltando: [] },
      sala: { verificacaoOk: true },
      acessos: {
        [RESERVA]: {
          estado: 'pronto', erro: null, nomeNoZoom: 'Maria Silva | Padaria #A1B2C3D4', nomeDifere: false, salaAnterior: false, salaComProblemas: false, atualizadoEm: null,
          endereco: `https://kickoff.legacy.example/impulsao/reuniao/${CODIGO}`,
        },
      },
    });
    expect(JSON.stringify(p)).not.toMatch(/SEGREDO|zoom\.us|reg-1/);
    expect(state.rpcs).toEqual([{ fn: 'agenda_kickoff_zoom_acessos', args: { p_reserva_ids: [RESERVA] } }]);
    expect(zoom.chamadas).toEqual([]);
  });

  it('sem sala ativa, sem credenciais, sem convite e migration 007 pendente', async () => {
    state.tabelas.agenda_kickoff_zoom_salas = ok(null);
    state.rpc.agenda_kickoff_zoom_acessos = ok([linha('sem_sala')]);
    delete process.env.ZOOM_ACCOUNT_ID;
    let p = await acessosDoPainel(reservas);
    expect(p).toMatchObject({ estrutura: 'ok', sala: null, integracao: { configurada: false, faltando: ['ZOOM_ACCOUNT_ID'] } });
    expect(p.acessos[RESERVA]).toMatchObject({ estado: 'sem_sala', endereco: null });
    state.tabelas.agenda_kickoff_zoom_inscricoes = { data: null, error: { code: '42P01', message: 'relation does not exist' } };
    p = await acessosDoPainel(reservas);
    expect(p).toMatchObject({ estrutura: 'pendente', acessos: {} });
    expect(zoom.chamadas).toEqual([]);
  });
});

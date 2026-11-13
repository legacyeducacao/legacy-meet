import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CurrentUser } from '@/lib/auth';

// Sala Zoom (E1): só quem gerencia kickoffs. Zoom e banco simulados: o fetch global
// é trocado por um Zoom falso que falha em qualquer URL inesperada (nenhuma chamada
// externa real), e o banco só registra o que receberia.
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
      for (const m of ['select', 'order', 'limit', 'eq', 'in']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
      q.then = (resolve: (v: unknown) => unknown) => resolve(r);
      return q;
    },
  }),
}));

import { GET, POST } from './route';
import { _esquecerClienteZoom } from '@/lib/kickoff/zoomSalaServidor';

const SALA = '81234567890';
const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const gestor = mk({ id: 'gestor-1', capacidades: ['kickoff_impulsao.manage'] });
const req = (body: unknown) =>
  new NextRequest('https://meet.example/api/agenda/kickoffs/zoom', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const futura = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const reuniaoBoa = {
  id: 81234567890,
  topic: 'Kickoff Impulsão',
  type: 8,
  timezone: 'America/Sao_Paulo',
  duration: 60,
  recurrence: { type: 2, repeat_interval: 1, end_times: 30 },
  occurrences: [{ start_time: futura(7), status: 'available' }, { start_time: futura(120), status: 'available' }],
  start_url: 'https://zoom.us/s/81234567890?zak=SEGREDO',
  join_url: 'https://zoom.us/j/81234567890?pwd=SEGREDO',
  password: 'senha-secreta',
  settings: { approval_type: 0, registration_type: 1, meeting_authentication: false },
};

let zoom: { reuniao: unknown; status: number; tokens: number; chamadas: string[] };
function zoomFalso() {
  zoom = { reuniao: reuniaoBoa, status: 200, tokens: 0, chamadas: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      zoom.chamadas.push(u);
      if (u.startsWith('https://zoom.us/oauth/token')) {
        zoom.tokens += 1;
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      if (u === `https://api.zoom.us/v2/meetings/${SALA}` || u.startsWith('https://api.zoom.us/v2/meetings/')) {
        return new Response(JSON.stringify(zoom.status === 200 ? zoom.reuniao : { code: zoom.status === 404 ? 3001 : 0, message: 'x' }), { status: zoom.status });
      }
      throw new Error(`chamada externa inesperada: ${u}`);
    }),
  );
}

beforeEach(() => {
  state.user = null;
  state.rpcs = [];
  state.rpc = {};
  state.tabelas = {};
  state.consultas = [];
  process.env.ZOOM_ACCOUNT_ID = 'conta';
  process.env.ZOOM_CLIENT_ID = 'cliente';
  process.env.ZOOM_CLIENT_SECRET = 'segredo-do-servidor';
  _esquecerClienteZoom();
  zoomFalso();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autorização', () => {
  it('sem login, equipe sem a permissão e cliente do Plan: 403, sem banco e sem Zoom', async () => {
    for (const u of [null, mk({ id: 'equipe' }), mk({ id: 'cli', isStaff: false, role: 'CLIENT', capacidades: ['kickoff_impulsao.manage'] })]) {
      state.user = u;
      expect((await GET()).status).toBe(403);
      for (const acao of ['verificar', 'ativar', 'verificar_ativa']) expect((await POST(req({ acao, entrada: SALA, motivo: 'x' }))).status).toBe(403);
    }
    expect(state.rpcs).toEqual([]);
    expect(state.consultas).toEqual([]);
    expect(zoom.chamadas).toEqual([]);
  });

  it('admin do Meet sem a permissão também gerencia', async () => {
    state.user = mk({ id: 'admin', isAdmin: true });
    expect((await GET()).status).toBe(200);
  });
});

describe('estado (abrir a tela)', () => {
  it('lê só o banco: nenhuma chamada ao Zoom; nada de credencial na resposta', async () => {
    state.user = gestor;
    state.tabelas.agenda_kickoff_zoom_salas = {
      data: [
        {
          id: 's1', zoom_meeting_id: SALA, topico: 'Kickoff', ativa: true, verificacao_ok: true, verificacao_problemas: [],
          verificacao_resumo: { tipo: 8 }, verificada_em: 'x', ativada_em: 'y', desativada_em: null, motivo_desativacao: null,
        },
      ],
      error: null,
    };
    state.tabelas.agenda_kickoff_zoom_salas_historico = {
      data: [{ id: 1, sala_id: 's1', acao: 'ativada', verificacao_ok: true, problemas: [], motivo: null, usuario: 'gestor-1', em: 'z' }],
      error: null,
    };
    state.tabelas.users = { data: [{ id: 'gestor-1', name: 'Gestor' }], error: null };
    const res = await GET();
    const j = await res.json();
    expect(j).toMatchObject({
      integracao: { configurada: true, faltando: [] },
      estrutura: 'ok',
      ativa: { meetingId: SALA, ativa: true },
      historico: [{ acao: 'ativada', meetingId: SALA, usuario: 'Gestor' }],
    });
    expect(zoom.chamadas).toEqual([]);
    expect(JSON.stringify(j)).not.toMatch(/segredo|conta|cliente|tok/);
  });

  it('credenciais ausentes e migration pendente aparecem como tal', async () => {
    state.user = gestor;
    delete process.env.ZOOM_CLIENT_SECRET;
    state.tabelas.agenda_kickoff_zoom_salas = { data: null, error: { code: '42P01', message: 'relation does not exist' } };
    expect(await (await GET()).json()).toEqual({
      integracao: { configurada: false, faltando: ['ZOOM_CLIENT_SECRET'] },
      estrutura: 'pendente',
      ativa: null,
      anteriores: [],
      historico: [],
    });
  });
});

describe('verificar', () => {
  beforeEach(() => {
    state.user = gestor;
  });
  const verificar = async (entrada: unknown) => (await (await POST(req({ acao: 'verificar', entrada }))).json()).verificacao;

  it('sala válida: aprovada, com resumo e sem links ou senha; não grava nada', async () => {
    state.rpc.agenda_kickoff_zoom_sala_usada_no_plan = { data: false, error: null };
    const v = await verificar('812 3456 7890');
    expect(v).toMatchObject({ status: 'verificada', meetingId: SALA, ok: true, problemas: [], topico: 'Kickoff Impulsão', resumo: { tipo: 8, ocorrenciasFuturas: 2 } });
    expect(JSON.stringify(v)).not.toMatch(/SEGREDO|senha-secreta|zak|pwd/);
    expect(state.rpcs.map((r) => r.fn)).toEqual(['agenda_kickoff_zoom_sala_usada_no_plan']);
    expect(zoom.chamadas).toEqual([expect.stringMatching(/oauth\/token/), `https://api.zoom.us/v2/meetings/${SALA}`]);
  });

  it('credenciais ausentes: "não configurada", sem chamar o Zoom', async () => {
    delete process.env.ZOOM_ACCOUNT_ID;
    expect(await verificar(SALA)).toEqual({ status: 'nao_configurada', faltando: ['ZOOM_ACCOUNT_ID'] });
    expect(zoom.chamadas).toEqual([]);
  });

  it('entrada inválida não chega ao Zoom', async () => {
    expect(await verificar('abc')).toMatchObject({ status: 'entrada_invalida' });
    expect(zoom.chamadas).toEqual([]);
  });

  it('Meeting ID inexistente, limite e instabilidade viram mensagens próprias', async () => {
    zoom.status = 404;
    expect(await verificar(SALA)).toMatchObject({ status: 'erro', tipo: 'nao_encontrada', temporaria: false });
    zoom.status = 429;
    expect(await verificar(SALA)).toMatchObject({ status: 'erro', tipo: 'limite', temporaria: true });
    zoom.status = 503;
    expect(await verificar(SALA)).toMatchObject({ status: 'erro', tipo: 'indisponivel', temporaria: true });
    expect(state.rpcs).toEqual([]);
  });

  it('tipo incorreto, inscrição desligada, aprovação manual e sala de turma do Plan', async () => {
    zoom.reuniao = { ...reuniaoBoa, type: 2 };
    expect((await verificar(SALA)).problemas.map((p: { codigo: string }) => p.codigo)).toEqual(['reuniao_unica']);
    zoom.reuniao = { ...reuniaoBoa, settings: { approval_type: 2 } };
    expect((await verificar(SALA)).problemas.map((p: { codigo: string }) => p.codigo)).toEqual(['inscricao_desligada']);
    zoom.reuniao = { ...reuniaoBoa, settings: { approval_type: 1, registration_type: 1 } };
    expect((await verificar(SALA)).problemas.map((p: { codigo: string }) => p.codigo)).toEqual(['aprovacao_manual']);
    zoom.reuniao = reuniaoBoa;
    state.rpc.agenda_kickoff_zoom_sala_usada_no_plan = { data: true, error: null };
    expect(await verificar(SALA)).toMatchObject({ ok: false, problemas: [{ codigo: 'sala_do_plan' }] });
  });

  it('token reaproveitado entre verificações (um pedido de token para várias consultas)', async () => {
    await verificar(SALA);
    await verificar(SALA);
    expect(zoom.tokens).toBe(1);
  });
});

describe('ativar', () => {
  beforeEach(() => {
    state.user = gestor;
    state.rpc.agenda_kickoff_zoom_sala_usada_no_plan = { data: false, error: null };
  });

  it('sala válida: verifica de novo no Zoom e grava com o usuário da sessão', async () => {
    state.rpc.agenda_kickoff_zoom_sala_ativar = { data: { acao: 'ativada', anterior: null }, error: null };
    const res = await POST(req({ acao: 'ativar', entrada: SALA, p_usuario: 'outro' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, acao: 'ativada', anterior: null });
    expect(zoom.chamadas.filter((u) => u.includes('/meetings/'))).toHaveLength(1);
    const chamada = state.rpcs.find((r) => r.fn === 'agenda_kickoff_zoom_sala_ativar');
    expect(chamada?.args).toMatchObject({ p_zoom_meeting_id: SALA, p_topico: 'Kickoff Impulsão', p_motivo: null, p_usuario: 'gestor-1' });
    expect(JSON.stringify(chamada?.args.p_resumo)).not.toMatch(/SEGREDO|senha|zak|pwd|join_url|start_url/);
  });

  it('sala com problema nunca é gravada', async () => {
    zoom.reuniao = { ...reuniaoBoa, settings: { approval_type: 1 } };
    const res = await POST(req({ acao: 'ativar', entrada: SALA }));
    expect(res.status).toBe(422);
    expect(await res.text()).toMatch(/aprovação manual/);
    expect(state.rpcs.map((r) => r.fn)).not.toContain('agenda_kickoff_zoom_sala_ativar');
  });

  it('substituição: o motivo vai ao banco, que exige e devolve a sala anterior', async () => {
    state.rpc.agenda_kickoff_zoom_sala_ativar = { data: null, error: { code: '22023', message: 'Informe o motivo da troca de sala.' } };
    const sem = await POST(req({ acao: 'ativar', entrada: SALA }));
    expect(sem.status).toBe(422);
    expect(await sem.text()).toBe('Informe o motivo da troca de sala.');
    state.rpc.agenda_kickoff_zoom_sala_ativar = { data: { acao: 'ativada', anterior: '81234567891' }, error: null };
    const com = await POST(req({ acao: 'ativar', entrada: SALA, motivo: 'Sala antiga acabou' }));
    expect(await com.json()).toMatchObject({ acao: 'ativada', anterior: '81234567891' });
    expect(state.rpcs.slice(-1)[0]?.args.p_motivo).toBe('Sala antiga acabou');
  });

  it('Zoom fora do ar ou sem credenciais: nada é gravado', async () => {
    zoom.status = 503;
    expect((await POST(req({ acao: 'ativar', entrada: SALA }))).status).toBe(503);
    delete process.env.ZOOM_CLIENT_ID;
    expect((await POST(req({ acao: 'ativar', entrada: SALA }))).status).toBe(409);
    expect(state.rpcs.map((r) => r.fn)).not.toContain('agenda_kickoff_zoom_sala_ativar');
  });

  it('migration 006 pendente: aviso claro', async () => {
    state.rpc.agenda_kickoff_zoom_sala_ativar = { data: null, error: { code: 'PGRST202', message: 'function not found' } };
    const res = await POST(req({ acao: 'ativar', entrada: SALA }));
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/migration 006/);
  });
});

describe('verificar a sala ativa', () => {
  beforeEach(() => {
    state.user = gestor;
    state.rpc.agenda_kickoff_zoom_sala_usada_no_plan = { data: false, error: null };
    state.tabelas.agenda_kickoff_zoom_salas = { data: [{ id: 's1', zoom_meeting_id: SALA }], error: null };
  });
  const registros = () => state.rpcs.filter((r) => r.fn === 'agenda_kickoff_zoom_sala_registrar_verificacao');

  it('grava o resultado, aprovado ou não', async () => {
    expect((await POST(req({ acao: 'verificar_ativa' }))).status).toBe(200);
    zoom.reuniao = { ...reuniaoBoa, settings: { approval_type: 1 } };
    await POST(req({ acao: 'verificar_ativa' }));
    expect(registros().map((r) => [r.args.p_sala_id, r.args.p_ok, r.args.p_usuario])).toEqual([
      ['s1', true, 'gestor-1'],
      ['s1', false, 'gestor-1'],
    ]);
  });

  it('reunião apagada no Zoom: grava "não encontrada"; falha passageira não grava', async () => {
    zoom.status = 404;
    await POST(req({ acao: 'verificar_ativa' }));
    expect(registros().slice(-1)[0]?.args).toMatchObject({ p_ok: false, p_problemas: [expect.objectContaining({ codigo: 'nao_encontrada' })] });
    const antes = registros().length;
    zoom.status = 429;
    expect((await POST(req({ acao: 'verificar_ativa' }))).status).toBe(503);
    expect(registros()).toHaveLength(antes);
  });

  it('sem sala ativa: 404', async () => {
    state.tabelas.agenda_kickoff_zoom_salas = { data: [], error: null };
    expect((await POST(req({ acao: 'verificar_ativa' }))).status).toBe(404);
  });
});

it('ação desconhecida: 400, sem banco nem Zoom', async () => {
  state.user = gestor;
  expect((await POST(req({ acao: 'criar_reuniao' }))).status).toBe(400);
  expect(state.rpcs).toEqual([]);
  expect(zoom.chamadas).toEqual([]);
});

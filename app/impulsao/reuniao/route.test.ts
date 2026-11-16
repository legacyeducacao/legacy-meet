import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Rotas PÚBLICAS do acesso à reunião (Zoom E2): a recuperação do acesso e o que o
// agendamento devolve. A página de entrada e o botão estão em entrada.test.ts. Banco e Zoom simulados: o
// fetch global é um Zoom falso que falha em qualquer URL inesperada (nenhuma chamada
// externa real). As regras do banco estão em lib/kickoff/zoomInscricaoBanco.test.ts.
const state = vi.hoisted(() => ({
  chamadas: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpc: {} as Record<string, unknown | ((args: Record<string, unknown>) => unknown)>,
  erro: {} as Record<string, { code: string; message: string }>,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.chamadas.push({ fn, args });
      if (state.erro[fn]) return { data: null, error: state.erro[fn] };
      const r = state.rpc[fn];
      return { data: typeof r === 'function' ? (r as (a: Record<string, unknown>) => unknown)(args) : (r ?? null), error: null };
    },
  }),
}));

import { POST as pedirAcesso } from '@/app/api/impulsao/convites/[codigo]/acesso/route';
import { GET as abrirConvite } from '@/app/api/impulsao/convites/[codigo]/route';
import { POST as agendar } from '@/app/api/impulsao/convites/[codigo]/agendar/route';
import { _esquecerClienteZoom } from '@/lib/kickoff/zoomSalaServidor';

const CODIGO = 'abcdefghjkmn';
const SALA = '81234567890';
const RESERVA = '44444444-4444-4444-8444-444444444444';
const INSCRICAO = '55555555-5555-4555-8555-555555555555';
const SESSAO = '22222222-2222-4222-8222-222222222222';
const TENANT = 'a1b2c3d4-0000-4000-8000-000000000001';
const JOIN = `https://us02web.zoom.us/w/${SALA}?tk=SEGREDO-INDIVIDUAL`;
const params = (codigo: string) => ({ params: Promise.resolve({ codigo }) });
const cabecalhos = (ip: string) => ({ 'cf-connecting-ip': ip, 'content-type': 'application/json' });

const daqui = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const estado = (e: string, extra: Record<string, unknown> = {}) => ({ reserva_id: RESERVA, estado: e, erro: null, nome_no_zoom: null, nome_difere: false, sala_anterior: false, sala_com_problemas: false, atualizado_em: null, ...extra });
/** O que agenda_kickoff_zoom_reserva_do_convite devolve para uma reserva ativa. */
const reservaAtiva = (inicioEmMin: number, e = 'pronto', extra: Record<string, unknown> = {}) => ({
  status: 'ok',
  reserva_id: RESERVA,
  tenant_id: TENANT, // o banco não manda isto; se mandasse, não poderia vazar
  inicio: daqui(inicioEmMin),
  fim: daqui(inicioEmMin + 60),
  acesso: estado(e, extra),
});
const contexto = { reserva_id: RESERVA, tenant_id: TENANT, empresa: 'Padaria Pão Bom', participante: 'Maria Silva', email: 'maria@padaria.com.br', zoom_meeting_id: SALA };
const reaproveitar = { acao: 'reaproveitar', inscricao: { id: INSCRICAO, zoom_registrant_id: 'reg-1', join_url: JOIN, verificada_em: new Date().toISOString() }, contexto };
const criar = { acao: 'criar', inscricao: { id: INSCRICAO }, contexto };

let zoom: { chamadas: string[]; statusAoInscrever: number; corpos: string[] };
function zoomFalso() {
  zoom = { chamadas: [], statusAoInscrever: 201, corpos: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const metodo = (init?.method ?? 'GET').toUpperCase();
      zoom.chamadas.push(`${metodo} ${u.replace(/\?.*$/, '')}`);
      if (u.startsWith('https://zoom.us/oauth/token')) return new Response(JSON.stringify({ access_token: 'tok-secreto', expires_in: 3600 }), { status: 200 });
      if (metodo === 'GET' && u === `https://api.zoom.us/v2/meetings/${SALA}`) {
        return new Response(JSON.stringify({ id: Number(SALA), type: 8, join_url: 'https://zoom.us/j/GENERICO', settings: { approval_type: 0, registration_type: 1, meeting_authentication: false } }), { status: 200 });
      }
      if (metodo === 'POST' && u === `https://api.zoom.us/v2/meetings/${SALA}/registrants`) {
        zoom.corpos.push(String(init?.body ?? ''));
        if (zoom.statusAoInscrever !== 201) return new Response(JSON.stringify({ code: 0, message: 'detalhe interno' }), { status: zoom.statusAoInscrever });
        return new Response(JSON.stringify({ registrant_id: 'reg-1', join_url: JOIN }), { status: 201 });
      }
      if (metodo === 'GET' && u === `https://api.zoom.us/v2/meetings/${SALA}/registrants/reg-1`) {
        return new Response(JSON.stringify({ id: 'reg-1', email: 'maria@padaria.com.br', first_name: 'Maria', last_name: 'Silva | Padaria Pão Bom #A1B2C3D4', status: 'approved', join_url: JOIN }), { status: 200 });
      }
      throw new Error(`chamada externa inesperada: ${metodo} ${u}`);
    }),
  );
}

const fns = () => state.chamadas.map((c) => c.fn);
let logs: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  state.chamadas = [];
  state.rpc = {};
  state.erro = {};
  process.env.KICKOFF_ORIGEM_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
  process.env.KICKOFF_PUBLIC_BASE_URL = 'https://kickoff.legacy.example';
  process.env.ZOOM_ACCOUNT_ID = 'conta';
  process.env.ZOOM_CLIENT_ID = 'cliente';
  process.env.ZOOM_CLIENT_SECRET = 'segredo-do-servidor';
  _esquecerClienteZoom();
  zoomFalso();
  logs = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
});

afterEach(() => {
  // Nada sensível em log: nem link individual, nem token, nem segredo.
  const tudo = JSON.stringify(logs.flatMap((l) => l.mock.calls));
  expect(tudo).not.toMatch(/SEGREDO|tok-secreto|segredo-do-servidor|zoom\.us/);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/impulsao/convites/[codigo]/acesso (público): recuperar o acesso', () => {
  const post = (codigo = CODIGO, corpo: unknown = {}) =>
    pedirAcesso(new NextRequest(`https://meet.example/api/impulsao/convites/${codigo}/acesso`, { method: 'POST', headers: cabecalhos('203.0.113.7'), body: JSON.stringify(corpo) }), params(codigo));

  it('gera o acesso que faltava e devolve só o estado e o endereço da Legacy, nunca o link do Zoom', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(2 * 24 * 60, 'erro');
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = criar;
    const res = await post(CODIGO, { reservaId: 'outra', tenantId: 'x', email: 'intruso@x.com' });
    const j = await res.json();
    expect(j).toEqual({
      status: 'ok',
      acesso: { estado: 'pronto', endereco: `https://kickoff.legacy.example/impulsao/reuniao/${CODIGO}`, abreEm: expect.any(String), fechaEm: expect.any(String) },
    });
    expect(JSON.stringify(j)).not.toMatch(/SEGREDO|zoom\.us|reg-1|a1b2c3d4|4444/i);
    // Nada do corpo chega ao banco.
    expect(JSON.stringify(state.chamadas)).not.toMatch(/intruso|outra/);
    expect(state.chamadas[0].args).toMatchObject({ p_codigo: CODIGO, p_contar: true });
  });

  it('Zoom falhou: "preparando" (vale tentar de novo), sem detalhe do erro; conflito e sala ausente: "indisponivel"', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(2 * 24 * 60, 'pendente');
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = criar;
    zoom.statusAoInscrever = 500;
    let j = await (await post()).json();
    expect(j.acesso.estado).toBe('preparando');
    expect(JSON.stringify(j)).not.toMatch(/instabilidade|Zoom|erro/i);

    state.rpc.agenda_kickoff_zoom_inscricao_decidir = { acao: 'conflito', motivo: 'outra_empresa' };
    j = await (await post()).json();
    expect(j.acesso.estado).toBe('indisponivel');
    expect(JSON.stringify(j)).not.toMatch(/outra empresa|conflito/i);

    // Sem sala ativa não há o que tentar: nem decide, nem Zoom.
    state.chamadas = [];
    zoom.chamadas = [];
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(2 * 24 * 60, 'sem_sala');
    expect((await (await post()).json()).acesso.estado).toBe('indisponivel');
    expect(fns()).toEqual(['agenda_kickoff_zoom_reserva_do_convite']);
    expect(zoom.chamadas).toEqual([]);
  });

  it('acesso já pronto não chama o Zoom de novo; recusas do convite saem no formato público', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(60);
    expect((await (await post()).json()).acesso.estado).toBe('pronto');
    expect(fns()).toEqual(['agenda_kickoff_zoom_reserva_do_convite']);
    expect(zoom.chamadas).toEqual([]);
    for (const status of ['convite_revogado', 'convite_expirado', 'muitas_tentativas', 'sem_reserva', 'concluida']) {
      state.rpc.agenda_kickoff_zoom_reserva_do_convite = { status, tenant_id: TENANT };
      expect(await (await post()).json()).toEqual({ status });
    }
    expect(await (await post('ruim')).json()).toEqual({ status: 'convite_invalido' });
  });
});

describe('agendamento público com o acesso à reunião', () => {
  const reservaPublica = { data: '2026-12-01', inicio: '14:00', fim: '15:00', starts_at: 'x', participante: 'Maria', anfitriao: null };
  const postAgendar = () =>
    agendar(
      new NextRequest(`https://meet.example/api/impulsao/convites/${CODIGO}/agendar`, { method: 'POST', headers: cabecalhos('203.0.113.7'), body: JSON.stringify({ sessaoId: SESSAO, nome: 'Maria Silva', email: 'maria@padaria.com.br' }) }),
      params(CODIGO),
    );
  const getConvite = () => abrirConvite(new NextRequest(`https://meet.example/api/impulsao/convites/${CODIGO}`, { headers: cabecalhos('203.0.113.7') }), params(CODIGO));

  it('confirmou a reserva: o servidor garante a inscrição no Zoom e a resposta traz o acesso pronto (sem link do Zoom)', async () => {
    state.rpc.agenda_kickoff_publico_agendar = { status: 'ok', reserva: reservaPublica };
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(2 * 24 * 60, 'pendente');
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = criar;
    const j = await (await postAgendar()).json();
    expect(j).toMatchObject({ status: 'ok', reserva: { participante: 'Maria' }, acesso: { estado: 'pronto', endereco: `https://kickoff.legacy.example/impulsao/reuniao/${CODIGO}` } });
    expect(JSON.stringify(j)).not.toMatch(/SEGREDO|zoom\.us/);
    // Primeiro a reserva (regras da M2), depois o Zoom.
    expect(fns().slice(0, 3)).toEqual(['agenda_kickoff_publico_agendar', 'agenda_kickoff_zoom_reserva_do_convite', 'agenda_kickoff_zoom_inscricao_decidir']);
    expect(zoom.chamadas).toContain(`POST https://api.zoom.us/v2/meetings/${SALA}/registrants`);
  });

  it('o Zoom falhou depois de a reserva ser gravada: a reserva é devolvida normalmente, com o acesso "preparando"', async () => {
    state.rpc.agenda_kickoff_publico_agendar = { status: 'ok', reserva: reservaPublica };
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(2 * 24 * 60, 'pendente');
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = criar;
    zoom.statusAoInscrever = 503;
    const res = await postAgendar();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', reserva: { participante: 'Maria' }, acesso: { estado: 'preparando' } });
    // Nenhuma chamada desfaz a reserva.
    expect(fns().filter((f) => /cancelar|remanejar/.test(f))).toEqual([]);
  });

  it('sem a migration 007 (função ausente): o agendamento e a página seguem como na M3, sem o campo de acesso', async () => {
    state.rpc.agenda_kickoff_publico_agendar = { status: 'ok', reserva: reservaPublica };
    state.erro.agenda_kickoff_zoom_reserva_do_convite = { code: 'PGRST202', message: 'x' };
    const j = await (await postAgendar()).json();
    expect(j).toEqual({ status: 'ok', reserva: reservaPublica });
    state.rpc.agenda_kickoff_publico_convite = { status: 'ok', empresa: { nome: 'Padaria' }, situacao: 'reservada', expirado: false, reserva: reservaPublica, sessoes: [] };
    const p = await (await getConvite()).json();
    expect(p).toMatchObject({ status: 'ok', situacao: 'reservada' });
    expect(p.acesso).toBeUndefined();
    expect(zoom.chamadas).toEqual([]);
  });

  it('reserva recusada (lotada, convite expirado...): nem consulta acesso, nem chama o Zoom', async () => {
    for (const status of ['sessao_lotada', 'convite_expirado', 'dados_invalidos', 'concluida']) {
      state.chamadas = [];
      state.rpc.agenda_kickoff_publico_agendar = { status };
      expect((await (await postAgendar()).json()).status).toBe(status);
      expect(fns()).toEqual(['agenda_kickoff_publico_agendar']);
    }
    expect(zoom.chamadas).toEqual([]);
  });

  it('abrir a página do convite NUNCA chama o Zoom: só lê o estado (e só quando há reserva)', async () => {
    state.rpc.agenda_kickoff_publico_convite = { status: 'ok', empresa: { nome: 'Padaria' }, situacao: 'reservada', expirado: true, reserva: reservaPublica, sessoes: [] };
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(2 * 24 * 60, 'pendente');
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = criar;
    const p = await (await getConvite()).json();
    expect(p).toMatchObject({ situacao: 'reservada', expirado: true, acesso: { estado: 'preparando', endereco: `https://kickoff.legacy.example/impulsao/reuniao/${CODIGO}` } });
    expect(fns()).toEqual(['agenda_kickoff_publico_convite', 'agenda_kickoff_zoom_reserva_do_convite']);
    expect(state.chamadas[1].args.p_contar).toBe(false);
    expect(zoom.chamadas).toEqual([]);
    // Sem reserva (calendário): nem a consulta de acesso acontece.
    state.chamadas = [];
    state.rpc.agenda_kickoff_publico_convite = { status: 'ok', empresa: { nome: 'Padaria' }, situacao: 'disponivel', expirado: false, reserva: null, sessoes: [] };
    await getConvite();
    expect(fns()).toEqual(['agenda_kickoff_publico_convite']);
    expect(zoom.chamadas).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as React from 'react';

// tsconfig usa "jsx": "preserve" (o Next compila); no Vitest o JSX vira React.createElement.
(globalThis as { React?: typeof React }).React = React;

// Página de entrada da reunião (/impulsao/reuniao/<código>) e a operação do botão
// "Entrar na reunião" (Zoom E2). Banco e Zoom simulados: o fetch global é um Zoom
// falso que falha em qualquer URL inesperada (nenhuma chamada externa real).
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
vi.mock('@/components/impulsao/EntradaNaReuniao', () => ({ EntradaNaReuniao: () => null }));

import Page, { metadata } from './[codigo]/page';
import * as rotaDeEntrada from './[codigo]/entrar/route';
import { POST as pedirPasse } from '@/app/api/impulsao/convites/[codigo]/entrada/route';
import { emitirPasse, passeValido, pedidoDaPropriaPagina, VALIDADE_DO_PASSE_S } from '@/lib/kickoff/entradaToken';
import { _esquecerClienteZoom } from '@/lib/kickoff/zoomSalaServidor';

const CODIGO = 'abcdefghjkmn';
const OUTRO = 'zyxwvutsrqpn';
const SALA = '81234567890';
const RESERVA = '44444444-4444-4444-8444-444444444444';
const INSCRICAO = '55555555-5555-4555-8555-555555555555';
const TENANT = 'a1b2c3d4-0000-4000-8000-000000000001';
const JOIN = `https://us02web.zoom.us/w/${SALA}?tk=SEGREDO-INDIVIDUAL`;
const PAGINA = `https://meet.example/impulsao/reuniao/${CODIGO}`;
const params = (codigo: string) => ({ params: Promise.resolve({ codigo }) });

/** Cabeçalhos de um formulário enviado pela nossa página (política no-referrer: Origin "null"). */
const DA_PAGINA = { 'cf-connecting-ip': '203.0.113.7', 'sec-fetch-site': 'same-origin', origin: 'null' };

function entrar(passe: string | null, opcoes: { codigo?: string; cabecalhos?: Record<string, string> } = {}) {
  const codigo = opcoes.codigo ?? CODIGO;
  const corpo = new URLSearchParams();
  if (passe !== null) corpo.set('passe', passe);
  return rotaDeEntrada.POST(
    new NextRequest(`https://meet.example/impulsao/reuniao/${codigo}/entrar`, {
      method: 'POST',
      headers: { ...(opcoes.cabecalhos ?? DA_PAGINA), 'content-type': 'application/x-www-form-urlencoded' },
      body: corpo.toString(),
    }),
    params(codigo),
  );
}
const passe = (codigo = CODIGO) =>
  pedirPasse(new NextRequest(`https://meet.example/api/impulsao/convites/${codigo}/entrada`, { method: 'POST', headers: DA_PAGINA }), params(codigo));

const daqui = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const reservaAtiva = (inicioEmMin: number, estado = 'pronto') => ({
  status: 'ok',
  reserva_id: RESERVA,
  inicio: daqui(inicioEmMin),
  fim: daqui(inicioEmMin + 60),
  acesso: { reserva_id: RESERVA, estado, erro: null, nome_no_zoom: null, nome_difere: false, sala_anterior: false, sala_com_problemas: false, atualizado_em: null },
});
const contexto = { reserva_id: RESERVA, tenant_id: TENANT, empresa: 'Padaria Pão Bom', participante: 'Maria Silva', email: 'maria@padaria.com.br', zoom_meeting_id: SALA };
const reaproveitar = { acao: 'reaproveitar', inscricao: { id: INSCRICAO, zoom_registrant_id: 'reg-1', join_url: JOIN, verificada_em: new Date().toISOString() }, contexto };
const criar = { acao: 'criar', inscricao: { id: INSCRICAO }, contexto };

let zoom: { chamadas: string[]; statusAoInscrever: number };
const fns = () => state.chamadas.map((c) => c.fn);
const inscricoesNoZoom = () => zoom.chamadas.filter((c) => c.startsWith('POST https://api.zoom.us'));
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
  logs = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
});

afterEach(() => {
  // Nada sensível em log: nem link individual, nem token, nem segredo.
  expect(JSON.stringify(logs.flatMap((l) => l.mock.calls))).not.toMatch(/SEGREDO|tok-secreto|segredo-do-servidor|zoom\.us/);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('abrir a página (GET) e pré-visualizações', () => {
  it('a página não consulta o banco no servidor, não chama o Zoom, não encaminha e não traz link nenhum', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(0);
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = reaproveitar;
    for (const retorno of [undefined, 'pendente', 'javascript:alert(1)']) {
      const el = (await Page({ params: Promise.resolve({ codigo: CODIGO }), searchParams: Promise.resolve({ retorno }) })) as React.ReactElement<{ codigo: string; retorno: string | null }>;
      expect(el.props.codigo).toBe(CODIGO);
      expect(el.props.retorno).toBe(retorno === 'pendente' ? 'pendente' : null);
      expect(JSON.stringify(el.props)).not.toMatch(/zoom\.us|SEGREDO/);
    }
    expect(state.chamadas).toEqual([]);
    expect(zoom.chamadas).toEqual([]);
    expect(metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: 'no-referrer' });
  });

  it('a operação de entrada só existe em POST: não há GET (nem HEAD) que inscreva ou encaminhe', () => {
    expect(Object.keys(rotaDeEntrada).filter((k) => /^(GET|HEAD|PUT|PATCH|DELETE|OPTIONS)$/.test(k))).toEqual([]);
    expect(typeof rotaDeEntrada.POST).toBe('function');
  });
});

describe('POST /api/impulsao/convites/[codigo]/entrada: o passe do clique', () => {
  it('dentro do horário: devolve só o passe; não chama o Zoom, não cria inscrição, não conta no limite de acessos', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(10, 'pendente');
    const res = await passe();
    const j = await res.json();
    expect(Object.keys(j).sort()).toEqual(['passe', 'status']);
    expect(j.status).toBe('ok');
    expect(passeValido(j.passe, CODIGO)).toBe(true);
    expect(JSON.stringify(j)).not.toMatch(/zoom\.us|SEGREDO|4444|a1b2c3d4/i);
    expect(fns()).toEqual(['agenda_kickoff_zoom_reserva_do_convite']);
    expect(state.chamadas[0].args).toMatchObject({ p_codigo: CODIGO, p_contar: false });
    expect(zoom.chamadas).toEqual([]);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('fora do horário, sem reserva ou convite recusado: sem passe', async () => {
    for (const inicioEmMin of [31, 3 * 24 * 60, -(60 + 31)]) {
      state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(inicioEmMin);
      expect(await (await passe()).json()).toEqual({ status: 'fora_do_horario' });
    }
    for (const status of ['sem_reserva', 'concluida', 'convite_revogado', 'convite_invalido', 'convite_expirado', 'muitas_tentativas']) {
      state.rpc.agenda_kickoff_zoom_reserva_do_convite = { status, tenant_id: TENANT };
      expect(await (await passe()).json()).toEqual({ status });
    }
    expect(await (await passe('ruim')).json()).toEqual({ status: 'convite_invalido' });
    expect(zoom.chamadas).toEqual([]);
  });

  it('pedido de outro site não recebe passe (e nem chega ao banco)', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(0);
    for (const cabecalhos of <Array<Record<string, string>>>[
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      { origin: 'https://site-malicioso.example' },
    ]) {
      const res = await pedirPasse(new NextRequest(`https://meet.example/api/impulsao/convites/${CODIGO}/entrada`, { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.7', ...cabecalhos } }), params(CODIGO));
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).not.toContain('passe');
    }
    expect(state.chamadas).toEqual([]);
  });
});

describe('POST /impulsao/reuniao/[codigo]/entrar: o botão "Entrar na reunião"', () => {
  it('clique com passe válido, no horário, com a inscrição pronta: 303 para o link individual, só no cabeçalho Location', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(10);
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = reaproveitar;
    const { passe: p } = await (await passe()).json();
    state.chamadas = [];
    const res = await entrar(p);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(JOIN);
    expect(await res.text()).toBe('');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    // Tudo é conferido de novo no banco: convite (contando no limite), reserva e inscrição.
    expect(fns()).toEqual(['agenda_kickoff_zoom_reserva_do_convite', 'agenda_kickoff_zoom_inscricao_decidir', 'agenda_kickoff_zoom_inscricao_entregue']);
    expect(state.chamadas[0].args).toMatchObject({ p_codigo: CODIGO, p_contar: true });
    expect(String(state.chamadas[0].args.p_origem)).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(state.chamadas[1].args).toEqual({ p_reserva_id: RESERVA, p_modo: 'normal', p_usuario: null });
    expect(zoom.chamadas).toEqual([]);
  });

  it('acesso ainda não gerado: a inscrição é criada no clique (nunca antes) e o participante é encaminhado', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(-5, 'pendente');
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = criar;
    // Abrir a página e pedir o passe não inscrevem ninguém.
    await Page({ params: Promise.resolve({ codigo: CODIGO }), searchParams: Promise.resolve({}) });
    const { passe: p } = await (await passe()).json();
    expect(inscricoesNoZoom()).toEqual([]);
    expect(fns()).not.toContain('agenda_kickoff_zoom_inscricao_decidir');
    const res = await entrar(p);
    expect(res.headers.get('location')).toBe(JOIN);
    expect(inscricoesNoZoom()).toEqual([`POST https://api.zoom.us/v2/meetings/${SALA}/registrants`]);
  });

  it('cliques repetidos não duplicam registrantes: o banco reaproveita a inscrição a partir do segundo', async () => {
    let pedidos = 0;
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(0, 'pendente');
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = () => (++pedidos === 1 ? criar : reaproveitar);
    for (let i = 0; i < 4; i++) {
      const res = await entrar(emitirPasse(CODIGO));
      expect(res.headers.get('location')).toBe(JOIN);
    }
    expect(pedidos).toBe(4);
    expect(inscricoesNoZoom()).toHaveLength(1);
    // Enquanto outro pedido cria (aguardar), este não fala com o Zoom nem entrega link.
    zoom.chamadas = [];
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = { acao: 'aguardar' };
    const res = await entrar(emitirPasse(CODIGO));
    expect(res.headers.get('location')).toBe(`${PAGINA}?retorno=pendente`);
    expect(zoom.chamadas).toEqual([]);
  });

  it('sem passe, passe adulterado, vencido ou de outro convite: volta à página, sem banco nem Zoom', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(0);
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = reaproveitar;
    const bom = emitirPasse(CODIGO);
    const vencido = emitirPasse(CODIGO, process.env, Date.now() - (VALIDADE_DO_PASSE_S + 5) * 1000);
    const doFuturo = emitirPasse(CODIGO, process.env, Date.now() + 3600_000);
    for (const p of [null, '', 'qualquer', bom.replace(/.$/, (c) => (c === '0' ? '1' : '0')), `${bom.split('.')[0]}.${'0'.repeat(64)}`, vencido, doFuturo, emitirPasse(OUTRO)]) {
      const res = await entrar(p);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(`${PAGINA}?retorno=expirou`);
    }
    // O passe de um convite não serve para outro, nos dois sentidos.
    expect((await entrar(bom, { codigo: OUTRO })).headers.get('location')).toBe(`https://meet.example/impulsao/reuniao/${OUTRO}?retorno=expirou`);
    expect(state.chamadas).toEqual([]);
    expect(zoom.chamadas).toEqual([]);
  });

  it('formulário enviado por outro site (CSRF), mesmo com passe válido: recusado, sem banco nem Zoom', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(0);
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = reaproveitar;
    const p = emitirPasse(CODIGO);
    for (const cabecalhos of <Array<Record<string, string>>>[
      { 'cf-connecting-ip': '203.0.113.7', 'sec-fetch-site': 'cross-site', origin: 'https://site-malicioso.example' },
      { 'cf-connecting-ip': '203.0.113.7', 'sec-fetch-site': 'same-site', origin: 'https://outro.meet.example' },
      { 'cf-connecting-ip': '203.0.113.7', 'sec-fetch-site': 'none' },
      { 'cf-connecting-ip': '203.0.113.7', origin: 'https://site-malicioso.example' },
    ]) {
      const res = await entrar(p, { cabecalhos });
      expect(res.status).toBe(403);
      expect(res.headers.get('location')).toBeNull();
    }
    expect(state.chamadas).toEqual([]);
    expect(zoom.chamadas).toEqual([]);
    // Da própria aplicação: mesma origem, pelo host do pedido ou pelo endereço oficial.
    for (const cabecalhos of <Array<Record<string, string>>>[
      { 'cf-connecting-ip': '203.0.113.7', 'sec-fetch-site': 'same-origin', origin: 'https://meet.example' },
      { 'cf-connecting-ip': '203.0.113.7', origin: 'https://kickoff.legacy.example' },
      { 'cf-connecting-ip': '203.0.113.7' }, // navegador antigo, sem Sec-Fetch-Site: vale o passe
    ]) {
      expect((await entrar(emitirPasse(CODIGO), { cabecalhos })).headers.get('location')).toBe(JOIN);
    }
  });

  it('convite inválido ou revogado é recusado; expirado sem reserva também; nenhum entrega link', async () => {
    for (const status of ['convite_revogado', 'convite_invalido', 'convite_expirado', 'muitas_tentativas']) {
      state.chamadas = [];
      state.rpc.agenda_kickoff_zoom_reserva_do_convite = { status, tenant_id: TENANT };
      state.rpc.agenda_kickoff_zoom_inscricao_decidir = reaproveitar;
      const res = await entrar(emitirPasse(CODIGO));
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(`${PAGINA}?retorno=recusa`);
      expect(fns()).toEqual(['agenda_kickoff_zoom_reserva_do_convite']);
    }
    // Código fora do formato: nem chega ao banco.
    state.chamadas = [];
    const res = await entrar('x', { codigo: 'curto' });
    expect(res.status).toBe(404);
    expect(state.chamadas).toEqual([]);
    expect(zoom.chamadas).toEqual([]);
  });

  it('convite expirado COM reserva ativa (o banco responde ok): entra normalmente', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(0);
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = reaproveitar;
    expect((await entrar(emitirPasse(CODIGO))).headers.get('location')).toBe(JOIN);
  });

  it('fora da janela da sessão da reserva (mesmo com passe válido): não entrega o link nem chama o Zoom', async () => {
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = reaproveitar;
    for (const inicioEmMin of [31, 2 * 24 * 60, -(60 + 31)]) {
      state.chamadas = [];
      state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(inicioEmMin);
      const res = await entrar(emitirPasse(CODIGO));
      expect(res.headers.get('location')).toBe(`${PAGINA}?retorno=pendente`);
      expect(fns()).toEqual(['agenda_kickoff_zoom_reserva_do_convite']);
    }
    expect(zoom.chamadas).toEqual([]);
    // Limites: abre 30 min antes do início e fecha 30 min depois do fim.
    for (const inicioEmMin of [29, -(60 + 29)]) {
      state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(inicioEmMin);
      expect((await entrar(emitirPasse(CODIGO))).headers.get('location')).toBe(JOIN);
    }
  });

  it('sem reserva elegível (sem reserva, cancelada, concluída): volta à página, sem link', async () => {
    for (const status of ['sem_reserva', 'concluida']) {
      state.chamadas = [];
      state.rpc.agenda_kickoff_zoom_reserva_do_convite = { status };
      expect((await entrar(emitirPasse(CODIGO))).headers.get('location')).toBe(`${PAGINA}?retorno=pendente`);
      expect(fns()).toEqual(['agenda_kickoff_zoom_reserva_do_convite']);
    }
    expect(zoom.chamadas).toEqual([]);
  });

  it('falha do Zoom preserva a reserva: volta à página com "pendente", erro guardado sem o texto do Zoom', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(5, 'pendente');
    state.rpc.agenda_kickoff_zoom_inscricao_decidir = criar;
    zoom.statusAoInscrever = 503;
    const res = await entrar(emitirPasse(CODIGO));
    expect(res.headers.get('location')).toBe(`${PAGINA}?retorno=pendente`);
    const concluir = state.chamadas.find((c) => c.fn === 'agenda_kickoff_zoom_inscricao_concluir');
    expect(concluir?.args).toMatchObject({ p_status: 'erro', p_join_url: null });
    expect(String(concluir?.args.p_erro)).not.toContain('detalhe interno');
    // Só funções de inscrição foram chamadas: nada cancela, remaneja ou altera a reserva.
    expect(fns().every((f) => f.startsWith('agenda_kickoff_zoom_'))).toBe(true);
    expect(fns()).not.toContain('agenda_kickoff_zoom_inscricao_entregue');
  });

  it('conflito, sala ausente, inscrição em criação ou link que não é do Zoom: sem entrega', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(5, 'pendente');
    for (const decisao of [
      { acao: 'conflito', motivo: 'outra_empresa' },
      { acao: 'indisponivel', motivo: 'sem_sala' },
      { acao: 'indisponivel', motivo: 'reserva_inativa' },
      { acao: 'aguardar' },
      { ...reaproveitar, inscricao: { ...reaproveitar.inscricao, join_url: 'https://zoom.us.exemplo.com/roubo' } },
    ]) {
      state.chamadas = [];
      state.rpc.agenda_kickoff_zoom_inscricao_decidir = decisao;
      const res = await entrar(emitirPasse(CODIGO));
      expect(res.headers.get('location')).toBe(`${PAGINA}?retorno=pendente`);
      expect(fns()).not.toContain('agenda_kickoff_zoom_inscricao_entregue');
    }
  });

  it('sem credenciais do Zoom, banco fora (ou 007 ausente) e produção sem KICKOFF_ORIGEM_SECRET: nada é entregue', async () => {
    state.rpc.agenda_kickoff_zoom_reserva_do_convite = reservaAtiva(5, 'pendente');
    delete process.env.ZOOM_CLIENT_SECRET;
    let res = await entrar(emitirPasse(CODIGO));
    expect(res.headers.get('location')).toBe(`${PAGINA}?retorno=pendente`);
    expect(fns()).toEqual(['agenda_kickoff_zoom_reserva_do_convite']);
    process.env.ZOOM_CLIENT_SECRET = 'segredo-do-servidor';

    state.erro.agenda_kickoff_zoom_reserva_do_convite = { code: 'PGRST202', message: 'function does not exist' };
    res = await entrar(emitirPasse(CODIGO));
    expect(res.headers.get('location')).toBe(`${PAGINA}?retorno=falha`);
    expect((await passe()).status).toBe(503);

    const p = emitirPasse(CODIGO);
    state.chamadas = [];
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.KICKOFF_ORIGEM_SECRET;
    res = await entrar(p);
    expect(res.headers.get('location')).toBe(`${PAGINA}?retorno=falha`);
    expect((await passe()).status).toBe(503);
    expect(state.chamadas).toEqual([]);
    expect(zoom.chamadas).toEqual([]);
  });
});

describe('passe e origem (regras puras)', () => {
  it('o passe vale 2 minutos, só para o convite em que foi emitido, e depende da chave do servidor', () => {
    const agora = Date.parse('2026-12-01T17:00:00Z');
    const p = emitirPasse(CODIGO, process.env, agora);
    expect(p).toMatch(/^\d{10}\.[0-9a-f]{64}$/);
    expect(passeValido(p, CODIGO, process.env, agora)).toBe(true);
    expect(passeValido(p, CODIGO, process.env, agora + 119_000)).toBe(true);
    expect(passeValido(p, CODIGO, process.env, agora + 121_000)).toBe(false);
    expect(passeValido(p, OUTRO, process.env, agora)).toBe(false);
    expect(passeValido(p, CODIGO, { KICKOFF_ORIGEM_SECRET: 'outra-chave-com-mais-de-32-caracteres-aqui' }, agora)).toBe(false);
    for (const ruim of [null, undefined, 42, '', 'a.b', `${p}0`, p.toUpperCase().replace(/^\d+/, (d) => d)]) {
      if (ruim !== p) expect(passeValido(ruim, CODIGO, process.env, agora)).toBe(false);
    }
    // Em produção, sem a chave, não se emite passe.
    expect(() => emitirPasse(CODIGO, { NODE_ENV: 'production' })).toThrow();
    expect(passeValido(p, CODIGO, { NODE_ENV: 'production' }, agora)).toBe(false);
  });

  it('origem do pedido: Sec-Fetch-Site tem de ser same-origin; Origin, quando vem com endereço, tem de ser nosso', () => {
    const h = (c: Record<string, string>) => new Headers(c);
    const hosts = ['meet.example', 'kickoff.legacy.example'];
    expect(pedidoDaPropriaPagina(h({ 'sec-fetch-site': 'same-origin', origin: 'null' }), hosts)).toBe(true);
    expect(pedidoDaPropriaPagina(h({ 'sec-fetch-site': 'same-origin', origin: 'https://MEET.example' }), hosts)).toBe(true);
    expect(pedidoDaPropriaPagina(h({}), hosts)).toBe(true);
    for (const site of ['cross-site', 'same-site', 'none']) expect(pedidoDaPropriaPagina(h({ 'sec-fetch-site': site }), hosts)).toBe(false);
    expect(pedidoDaPropriaPagina(h({ 'sec-fetch-site': 'same-origin', origin: 'https://meet.example.malicioso.com' }), hosts)).toBe(false);
    expect(pedidoDaPropriaPagina(h({ origin: 'isto não é um endereço' }), hosts)).toBe(false);
  });
});

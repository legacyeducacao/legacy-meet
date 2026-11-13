import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CurrentUser } from '@/lib/auth';

// Rotas de gestão das reservas do kickoff (M2). O banco é simulado: aqui se testa
// quem pode, o que vai para as funções do banco e como as respostas voltam. As
// regras em si (vaga, trava, histórico) estão testadas no banco real em
// lib/kickoff/reservas.test.ts e reservasConcorrencia.test.ts.
type Rpc = (fn: string, args: Record<string, unknown>) => { data: unknown; error: { code: string; message: string } | null };
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  rpc: null as Rpc | null,
  chamadas: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  consultas: [] as Array<{ tabela: string; filtros: unknown[][] }>,
  empresas: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));
vi.mock('@/lib/supabase/admin', () => {
  const from = (tabela: string) => {
    const filtros: unknown[][] = [];
    state.consultas.push({ tabela, filtros });
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'ilike', 'order', 'limit', 'not']) {
      q[m] = (...a: unknown[]) => (filtros.push([m, ...a]), q);
    }
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: tabela === 'client_tenants' ? state.empresas : [], error: null });
    return q;
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    state.chamadas.push({ fn, args });
    return state.rpc ? state.rpc(fn, args) : { data: { id: 'r1' }, error: null };
  };
  return { createAdminSupabase: () => ({ from, rpc }) };
});

import { POST as RESERVAR } from './route';
import { GET as HISTORICO, PATCH as PARTICIPANTE, POST as ACAO } from './[id]/route';
import { GET as EMPRESAS } from '../empresas/route';
import { PATCH as CONFIGURAR, POST as CANCELAR_SESSAO } from '../sessoes/[id]/route';

const ORG = '77777777-7777-4777-8777-777777777777';
const COMERCIAL = '99999999-9999-4999-8999-999999999999';
const EMPRESA = '11111111-1111-4111-8111-111111111111';
const SESSAO = '22222222-2222-4222-8222-222222222222';
const OUTRA = '33333333-3333-4333-8333-333333333333';
const RESERVA = '44444444-4444-4444-8444-444444444444';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const gestor = mk({ id: 'gestor-1', capacidades: ['kickoff_impulsao.manage'] });
const admin = mk({ id: 'admin-1', isAdmin: true });
const equipe = mk({ id: 'equipe-1' });
const clienteDoPlan = mk({ id: 'cli-1', isStaff: false, role: 'CLIENT', email: 'dono@cliente.com.br', capacidades: ['kickoff_impulsao.manage'] });

const req = (method: string, body?: unknown, url = 'https://meet.example/api/agenda/kickoffs/reservas') =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const pedido = (over: Record<string, unknown> = {}) => ({
  sessaoId: SESSAO,
  tenantId: EMPRESA,
  nome: ' Maria Silva ',
  email: ' Maria@Empresa.com.br ',
  telefone: '(11) 98888-7777',
  ...over,
});

beforeEach(() => {
  state.user = null;
  state.rpc = null;
  state.chamadas = [];
  state.consultas = [];
  state.empresas = [];
  process.env.MEET_KICKOFF_TENANT_ID = ORG;
  process.env.MEET_COMMERCIAL_TENANT_ID = COMERCIAL;
});

describe('quem pode administrar reservas', () => {
  it('sem login, equipe sem a permissão e cliente do Plan não fazem nada (e o banco nem é chamado)', async () => {
    for (const u of [null, equipe, clienteDoPlan]) {
      state.user = u;
      expect((await RESERVAR(req('POST', pedido()))).status).toBe(403);
      expect((await ACAO(req('POST', { acao: 'cancelar' }), params(RESERVA))).status).toBe(403);
      expect((await ACAO(req('POST', { acao: 'remanejar', sessaoId: OUTRA }), params(RESERVA))).status).toBe(403);
      expect((await PARTICIPANTE(req('PATCH', { nome: 'X Y', email: 'x@y.com.br' }), params(RESERVA))).status).toBe(403);
      expect((await HISTORICO(req('GET'), params(RESERVA))).status).toBe(403);
      expect((await EMPRESAS(req('GET', undefined, 'https://meet.example/api/agenda/kickoffs/empresas?q=emp'))).status).toBe(403);
      expect((await CONFIGURAR(req('PATCH', { capacidade: 3 }), params(SESSAO))).status).toBe(403);
      expect((await CANCELAR_SESSAO(req('POST', { acao: 'cancelar', comReservas: true }), params(SESSAO))).status).toBe(403);
    }
    expect(state.chamadas).toEqual([]);
    expect(state.consultas).toEqual([]);
  });

  it('gestor e admin inscrevem; o usuário vai da sessão para o banco, nunca do corpo', async () => {
    for (const u of [gestor, admin]) {
      state.user = u;
      state.chamadas = [];
      const res = await RESERVAR(req('POST', pedido({ usuario: 'outro', p_usuario: 'outro' })));
      expect(res.status).toBe(200);
      expect(state.chamadas).toEqual([
        {
          fn: 'agenda_kickoff_reservar',
          args: {
            p_meeting_id: SESSAO,
            p_tenant_id: EMPRESA,
            p_nome: 'Maria Silva',
            p_email: 'maria@empresa.com.br',
            p_telefone: '(11) 98888-7777',
            p_usuario: u.id,
          },
        },
      ]);
    }
  });
});

describe('inscrever empresa', () => {
  beforeEach(() => {
    state.user = gestor;
  });

  it('a empresa organizadora e a sentinela do Comercial não são inscritas', async () => {
    for (const tenantId of [ORG, ORG.toUpperCase(), COMERCIAL]) {
      const res = await RESERVAR(req('POST', pedido({ tenantId })));
      expect(res.status).toBe(422);
      expect(await res.text()).toBe('Empresa interna da Legacy não pode ser inscrita como participante.');
    }
    expect(state.chamadas).toEqual([]);
  });

  it('e-mail obrigatório e dados inválidos voltam 400 sem chamar o banco', async () => {
    expect(await (await RESERVAR(req('POST', pedido({ email: '' })))).text()).toBe('Informe o e-mail do participante principal.');
    expect(await (await RESERVAR(req('POST', pedido({ email: 'sem-arroba' })))).text()).toBe('E-mail do participante inválido.');
    expect((await RESERVAR(req('POST', pedido({ telefone: '12' })))).status).toBe(400);
    expect((await RESERVAR(req('POST', pedido({ sessaoId: 'x' })))).status).toBe(400);
    expect((await RESERVAR(req('POST', pedido({ tenantId: undefined })))).status).toBe(400);
    expect(state.chamadas).toEqual([]);
  });

  it('as recusas do banco voltam com a mensagem dele', async () => {
    state.rpc = () => ({ data: null, error: { code: '22023', message: 'Sessão lotada: 5 de 5 empresas.' } });
    let res = await RESERVAR(req('POST', pedido()));
    expect(res.status).toBe(422);
    expect(await res.text()).toBe('Sessão lotada: 5 de 5 empresas.');

    state.rpc = () => ({ data: null, error: { code: '23505', message: 'Esta empresa já tem kickoff marcado em 03/12 às 14:00. Para trocar, remaneje a reserva existente.' } });
    res = await RESERVAR(req('POST', pedido()));
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/^Esta empresa já tem kickoff marcado/);

    state.rpc = () => ({ data: null, error: { code: '42501', message: 'Só quem gerencia os kickoffs do Impulsão pode fazer isso.' } });
    expect((await RESERVAR(req('POST', pedido()))).status).toBe(403);

    state.rpc = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    res = await RESERVAR(req('POST', pedido()));
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/migration 003 pendente/);
  });
});

describe('cancelar, remanejar, participante', () => {
  beforeEach(() => {
    state.user = gestor;
  });

  it('cancelar e remanejar chamam a função certa, com o usuário da sessão', async () => {
    expect((await ACAO(req('POST', { acao: 'cancelar', motivo: 'Pediu' }), params(RESERVA))).status).toBe(200);
    expect((await ACAO(req('POST', { acao: 'remanejar', sessaoId: OUTRA, motivo: 'Agenda' }), params(RESERVA))).status).toBe(200);
    expect(state.chamadas).toEqual([
      { fn: 'agenda_kickoff_cancelar_reserva', args: { p_reserva_id: RESERVA, p_motivo: 'Pediu', p_usuario: 'gestor-1' } },
      { fn: 'agenda_kickoff_remanejar', args: { p_reserva_id: RESERVA, p_para_meeting_id: OUTRA, p_motivo: 'Agenda', p_usuario: 'gestor-1' } },
    ]);
  });

  it('presença, conclusão e reagendamento chamam a função certa, com o usuário da sessão', async () => {
    expect((await ACAO(req('POST', { acao: 'presenca', presenca: 'presente' }), params(RESERVA))).status).toBe(200);
    expect((await ACAO(req('POST', { acao: 'concluir', observacao: 'Ok' }), params(RESERVA))).status).toBe(200);
    expect((await ACAO(req('POST', { acao: 'reagendar', sessaoId: OUTRA, motivo: 'Faltou' }), params(RESERVA))).status).toBe(200);
    expect(state.chamadas).toEqual([
      { fn: 'agenda_kickoff_registrar_presenca', args: { p_reserva_id: RESERVA, p_presenca: 'presente', p_usuario: 'gestor-1' } },
      { fn: 'agenda_kickoff_concluir', args: { p_reserva_id: RESERVA, p_observacao: 'Ok', p_usuario: 'gestor-1' } },
      { fn: 'agenda_kickoff_reagendar', args: { p_reserva_ausente_id: RESERVA, p_para_meeting_id: OUTRA, p_motivo: 'Faltou', p_usuario: 'gestor-1' } },
    ]);
  });

  it('participação não concluída e correção de presença: motivo obrigatório, usuário da sessão', async () => {
    expect((await ACAO(req('POST', { acao: 'interromper', motivo: '  ' }), params(RESERVA))).status).toBe(400);
    expect((await ACAO(req('POST', { acao: 'corrigirPresenca', presenca: 'nenhuma' }), params(RESERVA))).status).toBe(400);
    expect((await ACAO(req('POST', { acao: 'corrigirPresenca', presenca: 'talvez', motivo: 'x' }), params(RESERVA))).status).toBe(400);
    expect(state.chamadas).toEqual([]);
    expect((await ACAO(req('POST', { acao: 'interromper', motivo: 'Caiu a conexão' }), params(RESERVA))).status).toBe(200);
    expect((await ACAO(req('POST', { acao: 'corrigirPresenca', presenca: 'nenhuma', motivo: 'Clique errado' }), params(RESERVA))).status).toBe(200);
    expect(state.chamadas).toEqual([
      { fn: 'agenda_kickoff_registrar_interrupcao', args: { p_reserva_id: RESERVA, p_motivo: 'Caiu a conexão', p_usuario: 'gestor-1' } },
      {
        fn: 'agenda_kickoff_corrigir_presenca',
        args: { p_reserva_id: RESERVA, p_presenca: 'nenhuma', p_motivo: 'Clique errado', p_usuario: 'gestor-1' },
      },
    ]);
    for (const u of [equipe, clienteDoPlan, null]) {
      state.user = u;
      expect((await ACAO(req('POST', { acao: 'interromper', motivo: 'x' }), params(RESERVA))).status).toBe(403);
      expect((await ACAO(req('POST', { acao: 'corrigirPresenca', presenca: 'ausente', motivo: 'x' }), params(RESERVA))).status).toBe(403);
    }
    expect(state.chamadas).toHaveLength(2);
  });

  it('presença inválida não chega ao banco; recusa de conclusão volta com a mensagem do banco', async () => {
    expect((await ACAO(req('POST', { acao: 'presenca', presenca: 'talvez' }), params(RESERVA))).status).toBe(400);
    expect((await ACAO(req('POST', { acao: 'reagendar' }), params(RESERVA))).status).toBe(400);
    expect(state.chamadas).toEqual([]);
    state.rpc = () => ({ data: null, error: { code: '22023', message: 'Para concluir, registre antes que a empresa compareceu.' } });
    const res = await ACAO(req('POST', { acao: 'concluir' }), params(RESERVA));
    expect(res.status).toBe(422);
    expect(await res.text()).toBe('Para concluir, registre antes que a empresa compareceu.');
  });

  it('quem não gerencia não registra presença, não conclui e não reagenda', async () => {
    for (const u of [equipe, clienteDoPlan, null]) {
      state.user = u;
      for (const corpo of [{ acao: 'presenca', presenca: 'presente' }, { acao: 'concluir' }, { acao: 'reagendar', sessaoId: OUTRA }]) {
        expect((await ACAO(req('POST', corpo), params(RESERVA))).status).toBe(403);
      }
    }
    expect(state.chamadas).toEqual([]);
  });

  it('ação desconhecida, reserva ou destino inválidos não chegam ao banco', async () => {
    expect((await ACAO(req('POST', { acao: 'apagar' }), params(RESERVA))).status).toBe(400);
    expect((await ACAO(req('POST', { acao: 'cancelar' }), params('nao-e-uuid'))).status).toBe(404);
    expect((await ACAO(req('POST', { acao: 'remanejar', sessaoId: '' }), params(RESERVA))).status).toBe(400);
    expect(state.chamadas).toEqual([]);
  });

  it('participante: valida e normaliza antes de gravar', async () => {
    expect((await PARTICIPANTE(req('PATCH', { nome: 'Ana Souza', email: '' }), params(RESERVA))).status).toBe(400);
    expect((await PARTICIPANTE(req('PATCH', { nome: 'Ana Souza', email: 'ANA@x.com.br', telefone: '' }), params(RESERVA))).status).toBe(200);
    expect(state.chamadas).toEqual([
      {
        fn: 'agenda_kickoff_atualizar_participante',
        args: { p_reserva_id: RESERVA, p_nome: 'Ana Souza', p_email: 'ana@x.com.br', p_telefone: null, p_usuario: 'gestor-1' },
      },
    ]);
  });
});

describe('sessão: capacidade, bloqueio e cancelamento com reservas', () => {
  beforeEach(() => {
    state.user = gestor;
  });

  it('capacidade de 1 a 50; bloqueio sozinho também vale', async () => {
    expect((await CONFIGURAR(req('PATCH', { capacidade: 0 }), params(SESSAO))).status).toBe(400);
    expect((await CONFIGURAR(req('PATCH', { capacidade: 51 }), params(SESSAO))).status).toBe(400);
    expect((await CONFIGURAR(req('PATCH', {}), params(SESSAO))).status).toBe(400);
    expect((await CONFIGURAR(req('PATCH', { aceitaReservas: false }), params(SESSAO))).status).toBe(200);
    state.rpc = () => ({ data: null, error: { code: '22023', message: 'Esta sessão tem 4 empresa(s) inscrita(s): a capacidade não pode ficar abaixo disso.' } });
    const res = await CONFIGURAR(req('PATCH', { capacidade: 3 }), params(SESSAO));
    expect(res.status).toBe(422);
    expect(state.chamadas.map((c) => c.args)).toEqual([
      { p_meeting_id: SESSAO, p_capacidade: null, p_aceita_reservas: false, p_usuario: 'gestor-1' },
      { p_meeting_id: SESSAO, p_capacidade: 3, p_aceita_reservas: null, p_usuario: 'gestor-1' },
    ]);
  });

  it('cancelar a sessão com as reservas exige a confirmação explícita', async () => {
    expect((await CANCELAR_SESSAO(req('POST', { acao: 'cancelar' }), params(SESSAO))).status).toBe(400);
    expect((await CANCELAR_SESSAO(req('POST', { acao: 'cancelar', comReservas: 'sim' }), params(SESSAO))).status).toBe(400);
    expect(state.chamadas).toEqual([]);
    state.rpc = () => ({ data: { sessoes: [SESSAO], reservasCanceladas: 2 }, error: null });
    const res = await CANCELAR_SESSAO(req('POST', { acao: 'cancelar', comReservas: true, motivo: 'Feriado' }), params(SESSAO));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sessoes: [SESSAO], reservasCanceladas: 2 });
    expect(state.chamadas[0]).toEqual({
      fn: 'agenda_kickoff_cancelar_sessoes',
      args: { p_ids: [SESSAO], p_cancelar_reservas: true, p_motivo: 'Feriado', p_origem: 'legacy', p_usuario: 'gestor-1' },
    });
  });
});

describe('busca de empresas', () => {
  beforeEach(() => {
    state.user = gestor;
  });

  it('menos de 2 letras não consulta; a busca exclui as empresas internas e limita a 20', async () => {
    const curta = await EMPRESAS(req('GET', undefined, 'https://meet.example/api/agenda/kickoffs/empresas?q=a'));
    expect(await curta.json()).toEqual({ empresas: [] });
    expect(state.consultas).toEqual([]);

    state.empresas = [{ id: EMPRESA, name: 'Empresa Teste', produto: 'impulsao_empresarial' }];
    const res = await EMPRESAS(req('GET', undefined, 'https://meet.example/api/agenda/kickoffs/empresas?q=100%25_emp'));
    expect(await res.json()).toEqual({
      empresas: [{ id: EMPRESA, nome: 'Empresa Teste', produto: 'impulsao_empresarial', reservaAtiva: null, concluida: false, ausente: false }],
    });
    const busca = state.consultas.find((c) => c.tabela === 'client_tenants')!.filtros;
    expect(busca).toContainEqual(['ilike', 'name', '%100\\%\\_emp%']); // curingas escapados
    expect(busca).toContainEqual(['limit', 20]);
    expect(busca).toContainEqual(['not', 'id', 'in', `(${ORG},${COMERCIAL})`]);
  });
});

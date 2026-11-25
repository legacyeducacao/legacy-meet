import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CurrentUser } from '@/lib/auth';

// Edição (PATCH) e cancelamento (POST .../cancelar) passam pela mesma checagem
// (lib/agenda/alvos.ts). Banco em memória: nada toca o Supabase nem o Google Agenda.
type Linha = Record<string, unknown>;
type Rpc = (fn: string, args: Record<string, unknown>) => { data: unknown; error: { code: string; message: string } | null };
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  tabelas: {} as Record<string, Linha[]>,
  /** Funções do banco (reservas do kickoff, migration 003). null = ainda não instaladas. */
  rpc: null as Rpc | null,
  chamadas: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));
vi.mock('@/lib/calendar', () => ({ updateCalendarEvent: async () => undefined, deleteCalendarEvent: async () => undefined }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => undefined,
}));

vi.mock('@/lib/supabase/admin', () => {
  type Filtro = (r: Linha) => boolean;
  const consulta = (tabela: string) => {
    const filtros: Filtro[] = [];
    let soDoMeet = false;
    let mudanca: Linha | null = null;
    const linhas = () =>
      (state.tabelas[tabela] ?? []).filter((r) => (!soDoMeet || r.meet_meeting_sector) && filtros.every((f) => f(r)));
    const q = {
      select(cols?: string) {
        soDoMeet = !!cols?.includes('meet_meeting_sector!inner');
        return q;
      },
      update(m: Linha) {
        mudanca = m;
        return q;
      },
      insert(rows: Linha | Linha[]) {
        (state.tabelas[tabela] ??= []).push(...(Array.isArray(rows) ? rows : [rows]));
        return Promise.resolve({ error: null });
      },
      eq: (c: string, v: unknown) => (filtros.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (filtros.push((r) => (r[c] ?? null) === v), q),
      in: (c: string, vs: unknown[]) => (filtros.push((r) => vs.includes(r[c])), q),
      gte: (c: string, v: string) => (filtros.push((r) => String(r[c]) >= v), q),
      lt: (c: string, v: string) => (filtros.push((r) => String(r[c]) < v), q),
      lte: (c: string, v: string) => (filtros.push((r) => String(r[c]) <= v), q),
      gt: (c: string, v: string) => (filtros.push((r) => String(r[c]) > v), q),
      neq: (c: string, v: unknown) => (filtros.push((r) => r[c] !== v), q),
      not: () => q,
      or: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
      then(resolve: (v: { data: Linha[] | null; error: null }) => unknown) {
        if (mudanca) {
          for (const r of linhas()) Object.assign(r, mudanca);
          return resolve({ data: null, error: null });
        }
        return resolve({ data: linhas(), error: null });
      },
    };
    return q;
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    state.chamadas.push({ fn, args });
    return state.rpc ? state.rpc(fn, args) : { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  };
  return { createAdminSupabase: () => ({ from: consulta, rpc }) };
});

import { PATCH } from './route';
import { POST as CANCELAR } from './cancelar/route';

const EMPRESA_A = '11111111-1111-4111-8111-111111111111'; // carteira do executor X
const EMPRESA_B = '22222222-2222-4222-8222-222222222222'; // carteira do executor Y
const COMERCIAL = '99999999-9999-4999-8999-999999999999';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const executorX = mk({ id: 'exec-x' });
const executorY = mk({ id: 'exec-y' });
const admin = mk({ id: 'adm', isAdmin: true, sector: 'ambos', role: 'MASTER' });
const comercial = mk({ id: 'com', sector: 'comercial', role: 'COLLABORATOR' });
const clienteDaEmpresaA = mk({ id: 'cli-a', isStaff: false, sector: null, role: 'CLIENT', email: 'dono@empresa-a.com' });

const reuniao = (id: string, o: Partial<Linha> = {}): Linha => ({
  id,
  host_id: 'exec-x',
  tenant_id: EMPRESA_A,
  title: id,
  status: 'scheduled',
  scheduled_start_at: '2026-12-01T13:00:00.000Z',
  scheduled_end_at: '2026-12-01T14:00:00.000Z',
  recurrence_parent_id: null,
  meet_meeting_sector: { sector: 'executoria' },
  ...o,
});
const serie = { recurrence_parent_id: 's1' };

beforeEach(() => {
  process.env.MEET_COMMERCIAL_TENANT_ID = COMERCIAL;
  state.user = null;
  state.rpc = null;
  state.chamadas = [];
  state.tabelas = {
    client_tenants: [
      { id: EMPRESA_A, executor_id: 'exec-x' },
      { id: EMPRESA_B, executor_id: 'exec-y' },
      { id: COMERCIAL, executor_id: null },
    ],
    meetings: [
      // Série do executor X com a empresa A...
      reuniao('s1', { ...serie, scheduled_start_at: '2026-12-01T13:00:00.000Z' }),
      reuniao('s1-2', { ...serie, scheduled_start_at: '2026-12-08T13:00:00.000Z', scheduled_end_at: '2026-12-08T14:00:00.000Z' }),
      // ...e linhas com o mesmo recurrence_parent_id que a série NÃO pode atingir:
      reuniao('intruso-host', { ...serie, host_id: 'exec-y', scheduled_start_at: '2026-12-15T13:00:00.000Z' }),
      reuniao('intruso-empresa', { ...serie, tenant_id: EMPRESA_B, scheduled_start_at: '2026-12-22T13:00:00.000Z' }),
      reuniao('intruso-planner', { ...serie, meet_meeting_sector: null, scheduled_start_at: '2026-12-29T13:00:00.000Z' }),
      reuniao('da-carteira-y', { host_id: 'exec-y', tenant_id: EMPRESA_B }),
      reuniao('cliente-mudou-de-carteira', { tenant_id: EMPRESA_B }),
      reuniao('so-do-planner-do-plan', { meet_meeting_sector: null }),
      reuniao('comercial-do-com', { host_id: 'com', tenant_id: COMERCIAL, meet_meeting_sector: { sector: 'comercial' } }),
      reuniao('comercial-do-x', { tenant_id: COMERCIAL, meet_meeting_sector: { sector: 'comercial' } }),
      // Reunião que um cliente do Plan conseguiu criar pela falha antiga (ele é o anfitrião).
      reuniao('criada-pelo-cliente', { host_id: 'cli-a' }),
    ],
  };
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: Record<string, unknown>) =>
  new NextRequest('https://meet.example/api/agenda/eventos/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const cancelar = (id: string, escopo = 'esta') => CANCELAR(req({ escopo }), params(id));
const renomear = (id: string, titulo = 'Novo título') => PATCH(req({ titulo }), params(id));
const status = (id: string) => state.tabelas.meetings.find((m) => m.id === id)?.status;
const titulo = (id: string) => state.tabelas.meetings.find((m) => m.id === id)?.title;

describe('Edição e cancelamento de evento: quem pode', () => {
  it('sem sessão: bloqueado e nada muda', async () => {
    expect((await cancelar('s1')).status).toBe(403);
    expect((await renomear('s1')).status).toBe(403);
    expect(status('s1')).toBe('scheduled');
    expect(titulo('s1')).toBe('s1');
  });

  it('cliente do Plan não edita nem cancela, nem reunião da própria empresa', async () => {
    state.user = clienteDaEmpresaA;
    expect((await cancelar('s1')).status).toBe(403);
    expect((await renomear('s1')).status).toBe(403);
    expect(status('s1')).toBe('scheduled');
  });

  it('cliente do Plan não altera nem reunião em que aparece como anfitrião', async () => {
    state.user = clienteDaEmpresaA;
    const res = await cancelar('criada-pelo-cliente');
    expect(res.status).toBe(403);
    // Barrado já na entrada da agenda (podeUsarAgendaNova); resolverAlvos repete a checagem.
    expect(await res.text()).toBe('Não autorizado');
    expect((await renomear('criada-pelo-cliente')).status).toBe(403);
    expect(status('criada-pelo-cliente')).toBe('scheduled');
  });

  it('anfitrião com o cliente na carteira edita e cancela', async () => {
    state.user = executorX;
    expect((await renomear('s1')).status).toBe(200);
    expect(titulo('s1')).toBe('Novo título');
    const res = await cancelar('s1');
    expect(res.status).toBe(200);
    expect((await res.json()).cancelados).toEqual(['s1']);
    expect(status('s1')).toBe('canceled');
  });

  it('executor não mexe em reunião de outra carteira (operação e empresa)', async () => {
    state.user = executorX;
    expect((await cancelar('da-carteira-y')).status).toBe(403);
    expect((await renomear('da-carteira-y')).status).toBe(403);
    expect(status('da-carteira-y')).toBe('scheduled');
  });

  it('desde 25/11 o anfitrião altera a própria reunião mesmo com o cliente em outra carteira', async () => {
    state.user = executorX;
    expect((await cancelar('cliente-mudou-de-carteira')).status).toBe(200);
    expect(status('cliente-mudou-de-carteira')).toBe('canceled');
  });

  it('reunião que não é do Meet (Planner do Plan) não é alcançada', async () => {
    state.user = admin;
    expect((await cancelar('so-do-planner-do-plan')).status).toBe(404);
    expect(status('so-do-planner-do-plan')).toBe('scheduled');
  });

  it('série ("todas"): só reuniões do mesmo anfitrião, da mesma empresa e do Meet', async () => {
    state.user = executorX;
    const res = await cancelar('s1', 'todas');
    expect(res.status).toBe(200);
    expect((await res.json()).cancelados).toEqual(['s1', 's1-2']);
    for (const intruso of ['intruso-host', 'intruso-empresa', 'intruso-planner']) expect(status(intruso)).toBe('scheduled');
  });

  it('admin mantém o acesso: altera reunião de qualquer carteira, com a série igualmente contida', async () => {
    state.user = admin;
    expect((await renomear('da-carteira-y', 'Ajuste do gestor')).status).toBe(200);
    expect(titulo('da-carteira-y')).toBe('Ajuste do gestor');
    const res = await cancelar('s1', 'todas');
    expect((await res.json()).cancelados).toEqual(['s1', 's1-2']);
    expect(status('intruso-empresa')).toBe('scheduled');
  });

  it('Comercial: anfitrião com acesso altera; anfitrião sem acesso ao Comercial não', async () => {
    state.user = comercial;
    expect((await renomear('comercial-do-com')).status).toBe(200);
    state.user = executorX;
    const res = await cancelar('comercial-do-x');
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Sem acesso a reuniões do Comercial');
    expect(status('comercial-do-x')).toBe('scheduled');
  });

  it('outro executor da equipe não altera reunião de que não é anfitrião', async () => {
    state.user = executorY;
    expect((await cancelar('s1')).status).toBe(403);
    expect(status('s1')).toBe('scheduled');
  });
});

describe('Edição e cancelamento de sessão de kickoff do Impulsão (M1)', () => {
  const ORG = '77777777-7777-4777-8777-777777777777'; // empresa organizadora interna (fora de qualquer carteira)
  const gestorKickoff = mk({ id: 'cs-2', role: 'CUSTOMER_SUCCESS', capacidades: ['kickoff_impulsao.manage'] });
  const kickoff = (id: string, o: Partial<Linha> = {}) =>
    reuniao(id, { host_id: 'cs-1', tenant_id: ORG, meet_meeting_sector: { sector: 'executoria' }, ...o });

  beforeEach(() => {
    state.tabelas.client_tenants.push({ id: ORG, executor_id: null });
    state.tabelas.meetings.push(
      kickoff('k1', { recurrence_parent_id: 'ks', scheduled_start_at: '2026-12-03T17:00:00.000Z', scheduled_end_at: '2026-12-03T18:00:00.000Z' }),
      kickoff('k2', { recurrence_parent_id: 'ks', scheduled_start_at: '2026-12-10T17:00:00.000Z', scheduled_end_at: '2026-12-10T18:00:00.000Z' }),
      kickoff('k-do-executor', { host_id: 'exec-x' }),
    );
    state.tabelas.agenda_kickoff_sessoes = ['k1', 'k2', 'k-do-executor'].map((meeting_id) => ({
      meeting_id,
      capacidade: 5,
      aceita_reservas: true,
    }));
  });

  it('quem gerencia kickoffs edita e cancela a série, mesmo sem ser o anfitrião', async () => {
    state.user = gestorKickoff;
    expect((await renomear('k1', 'Kickoff Impulsão (turma de dezembro)')).status).toBe(200);
    expect(titulo('k1')).toBe('Kickoff Impulsão (turma de dezembro)');
    const res = await cancelar('k1', 'todas');
    expect(res.status).toBe(200);
    expect((await res.json()).cancelados).toEqual(['k1', 'k2']);
  });

  it('admin global também pode', async () => {
    state.user = admin;
    expect((await cancelar('k2')).status).toBe(200);
  });

  it('o anfitrião sem a permissão não altera a sessão de kickoff', async () => {
    state.user = executorX; // anfitrião de k-do-executor
    const res = await cancelar('k-do-executor');
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Só quem gerencia os kickoffs do Impulsão pode alterar esta sessão');
    expect(status('k-do-executor')).toBe('scheduled');
  });

  it('equipe sem a permissão não altera', async () => {
    state.user = executorY;
    expect((await renomear('k1')).status).toBe(403);
    expect(titulo('k1')).toBe('k1');
  });

  it('a permissão de kickoff não vale para reuniões comuns', async () => {
    state.user = gestorKickoff;
    expect((await cancelar('s1')).status).toBe(403);
    expect(status('s1')).toBe('scheduled');
  });
});

describe('Sessão de kickoff com reservas (M2): edição e cancelamento passam pelas regras do banco', () => {
  const ORG = '77777777-7777-4777-8777-777777777777';
  const gestorKickoff = mk({ id: 'cs-2', role: 'CUSTOMER_SUCCESS', capacidades: ['kickoff_impulsao.manage'] });
  const mover = (id: string, escopo = 'esta') =>
    PATCH(req({ inicio: '2026-12-03T18:00:00.000Z', fim: '2026-12-03T19:00:00.000Z', escopo }), params(id));

  beforeEach(() => {
    state.tabelas.client_tenants.push({ id: ORG, executor_id: null });
    state.tabelas.meetings.push(
      reuniao('k1', { host_id: 'cs-1', tenant_id: ORG, scheduled_start_at: '2026-12-03T17:00:00.000Z', scheduled_end_at: '2026-12-03T18:00:00.000Z' }),
    );
    state.tabelas.agenda_kickoff_sessoes = [{ meeting_id: 'k1', capacidade: 5, aceita_reservas: true }];
  });

  it('com empresa inscrita: mover é recusado (422, mensagem do banco) e nada muda', async () => {
    state.user = gestorKickoff;
    state.rpc = () => ({
      data: null,
      error: { code: '22023', message: 'A sessão de 03/12 às 14:00 tem 2 empresa(s) inscrita(s). Remaneje ou cancele as reservas antes de mudar o horário.' },
    });
    const res = await mover('k1');
    expect(res.status).toBe(422);
    expect(await res.text()).toMatch(/tem 2 empresa\(s\) inscrita\(s\)/);
    expect(state.tabelas.meetings.find((m) => m.id === 'k1')?.scheduled_start_at).toBe('2026-12-03T17:00:00.000Z');
    expect(state.chamadas.map((c) => c.fn)).toEqual(['agenda_kickoff_remarcar_sessoes']);
    expect(state.chamadas[0].args.p_usuario).toBe('cs-2'); // o usuário vem da sessão
    expect(state.tabelas.agenda_remarcacoes ?? []).toHaveLength(0);
  });

  it('com empresa inscrita: cancelar pela agenda é recusado e nada muda', async () => {
    state.user = gestorKickoff;
    state.rpc = () => ({ data: null, error: { code: '22023', message: 'A sessão de 03/12 às 14:00 tem 1 empresa(s) inscrita(s).' } });
    const res = await cancelar('k1');
    expect(res.status).toBe(422);
    expect(status('k1')).toBe('scheduled');
    expect(state.tabelas.agenda_cancelamentos ?? []).toHaveLength(0);
    expect(state.chamadas[0]).toMatchObject({ fn: 'agenda_kickoff_cancelar_sessoes', args: { p_ids: ['k1'], p_cancelar_reservas: false } });
  });

  it('sem reservas: o banco faz a mudança (a rota não escreve de novo em meetings)', async () => {
    state.user = gestorKickoff;
    state.rpc = (fn, args) => {
      for (const i of args.p_itens as Array<{ id: string; inicio: string; fim: string }>) {
        Object.assign(state.tabelas.meetings.find((m) => m.id === i.id)!, { scheduled_start_at: i.inicio, scheduled_end_at: i.fim });
      }
      return { data: 1, error: null };
    };
    expect((await mover('k1')).status).toBe(200);
    expect(state.tabelas.meetings.find((m) => m.id === 'k1')?.scheduled_start_at).toBe('2026-12-03T18:00:00.000Z');
  });

  it('reunião comum não passa pelas funções do kickoff', async () => {
    state.user = executorX;
    expect((await cancelar('s1')).status).toBe(200);
    expect(state.chamadas).toEqual([]);
  });
});

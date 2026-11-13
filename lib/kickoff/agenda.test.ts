import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth';

// A sessão de kickoff na agenda de verdade (listarReunioes, contextoExecutor e
// o motor de conflitos), sobre um banco em memória. Nada toca o Supabase.
type Linha = Record<string, unknown>;
const state = vi.hoisted(() => ({
  tabelas: {} as Record<string, Linha[]>,
  /** Tabelas que "não existem" (migration não aplicada). */
  semTabela: new Set<string>(),
}));

vi.mock('@/lib/supabase/admin', () => {
  type Filtro = (r: Linha) => boolean;
  const consulta = (tabela: string) => {
    const filtros: Filtro[] = [];
    const linhas = () => (state.tabelas[tabela] ?? []).filter((r) => filtros.every((f) => f(r)));
    const resposta = () =>
      state.semTabela.has(tabela)
        ? { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${tabela}'` } }
        : { data: linhas(), error: null };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filtros.push((r) => r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filtros.push((r) => vs.includes(r[c])), q),
      is: (c: string, v: unknown) => (filtros.push((r) => (r[c] ?? null) === v), q),
      not: (c: string, _op: string, v: unknown) => (filtros.push((r) => (r[c] ?? null) !== v), q),
      gt: (c: string, v: string) => (filtros.push((r) => String(r[c]) > v), q),
      gte: (c: string, v: string) => (filtros.push((r) => String(r[c]) >= v), q),
      lt: (c: string, v: string) => (filtros.push((r) => String(r[c]) < v), q),
      lte: (c: string, v: string) => (filtros.push((r) => String(r[c]) <= v), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => {
        const r = resposta();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      then: (resolve: (v: unknown) => unknown) => resolve(resposta()),
    };
    return q;
  };
  return { createAdminSupabase: () => ({ from: consulta }) };
});

import { contextoExecutor, listarReunioes } from '@/lib/agenda/servidor';
import { EXPEDIENTE_PADRAO, NIVEIS_PADRAO, REGRAS_PADRAO, validarConflitos } from '@/lib/agenda-engine';
import { PERMISSAO_KICKOFF } from './regras';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
// Terça, 01/12/2026, 14h às 15h em Brasília (dentro do expediente padrão).
const INICIO = '2026-12-01T17:00:00.000Z';
const FIM = '2026-12-01T18:00:00.000Z';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'cs-1', email: 'cs@legacyeducacaocorp.com.br', name: 'CS', role: 'CUSTOMER_SUCCESS',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const gestor = mk({ capacidades: [PERMISSAO_KICKOFF] });
const anfitriaoSemPermissao = mk({});

const reuniao = (id: string, o: Linha = {}): Linha => ({
  id,
  title: id,
  host_id: 'cs-1',
  status: 'scheduled',
  scheduled_start_at: INICIO,
  scheduled_end_at: FIM,
  room_name: `meet_${id}`,
  recording_enabled: true,
  auto_transcribe: true,
  recurrence_parent_id: null,
  tenant_id: CLIENTE,
  users: { name: 'CS' },
  client_tenants: { name: 'Cliente', produto: 'legado_online' },
  meet_meeting_sector: { sector: 'executoria', onboarding: false },
  meet_meeting_hosts: [],
  ...o,
});

beforeEach(() => {
  state.semTabela = new Set();
  state.tabelas = {
    meetings: [
      reuniao('kickoff', {
        title: 'Kickoff Impulsão',
        tenant_id: ORG,
        recording_enabled: false,
        auto_transcribe: false,
        client_tenants: { name: 'Legacy Executoria', produto: null },
        meet_meeting_sector: { sector: 'executoria', onboarding: true },
      }),
      reuniao('comum', { scheduled_start_at: '2026-12-02T17:00:00.000Z', scheduled_end_at: '2026-12-02T18:00:00.000Z' }),
    ],
    agenda_kickoff_sessoes: [{ meeting_id: 'kickoff', capacidade: 5, aceita_reservas: true }],
  };
});

const de = new Date('2026-11-30T03:00:00.000Z');
const ate = new Date('2026-12-07T03:00:00.000Z');
const evento = (lista: Awaited<ReturnType<typeof listarReunioes>>, id: string) => lista.find((e) => e.id === id)!;

describe('sessão de kickoff na agenda do Meet', () => {
  it('é identificada e vai para o calendário Kickoffs, sem sala do Meet e sem a empresa organizadora', async () => {
    const lista = await listarReunioes(gestor, ['cs-1'], de, ate);
    const k = evento(lista, 'kickoff');
    expect(k).toMatchObject({ tipo: 'reuniao', calendario: 'kickoff', tipoEvento: 'kickoff_impulsao', cliente: null, tenantId: null, podeEditar: true });
    expect(k.roomName).toBeUndefined();
    expect(k.kickoff).toEqual({ capacidade: 5, aceitaReservas: true, ocupadas: 0 });
  });

  it('as reuniões comuns continuam iguais', async () => {
    const c = evento(await listarReunioes(gestor, ['cs-1'], de, ate), 'comum');
    expect(c).toMatchObject({ calendario: 'legado', roomName: 'meet_comum', cliente: 'Cliente', tenantId: CLIENTE, podeEditar: true });
    expect(c.tipoEvento).toBeUndefined();
  });

  it('o anfitrião sem a permissão vê a sessão na própria agenda, sem detalhes internos e sem editar', async () => {
    const k = evento(await listarReunioes(anfitriaoSemPermissao, ['cs-1'], de, ate), 'kickoff');
    expect(k.calendario).toBe('kickoff');
    expect(k.kickoff).toBeUndefined();
    expect(k.podeEditar).toBe(false);
  });

  it('antes da migration (tabela ausente) a agenda continua abrindo, sem nada marcado como kickoff', async () => {
    state.semTabela.add('agenda_kickoff_sessoes');
    const lista = await listarReunioes(gestor, ['cs-1'], de, ate);
    expect(lista).toHaveLength(2);
    expect(lista.some((e) => e.tipoEvento)).toBe(false);
  });

  it('ocupa a disponibilidade do anfitrião: outra reunião no mesmo horário dá conflito', async () => {
    const cfg = { expediente: EXPEDIENTE_PADRAO, regras: REGRAS_PADRAO, niveis: NIVEIS_PADRAO, horizonteMeses: 6, considerarFacultativos: true };
    const ctx = await contextoExecutor('cs-1', new Date(INICIO), new Date(FIM), cfg);
    expect(ctx.eventos.map((e) => e.id)).toContain('kickoff');
    const conflitos = validarConflitos(
      [{ ref: '0', inicio: new Date('2026-12-01T17:30:00.000Z'), fim: new Date('2026-12-01T18:30:00.000Z') }],
      ctx,
    );
    expect(conflitos.map((c) => c.tipo)).toContain('sobreposicao');
  });
});

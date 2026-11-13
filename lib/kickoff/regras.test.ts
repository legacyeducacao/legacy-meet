import { describe, expect, it } from 'vitest';
import { podeGerenciarKickoff, type CurrentUser } from '@/lib/auth';
import type { EventoDTO } from '@/lib/agenda/tipos';
import {
  alternarCapacidade,
  CAPACIDADE_PADRAO,
  capacidadeValida,
  lerCapacidades,
  organizadorDoKickoff,
  PERMISSAO_KICKOFF,
} from './regras';
import { marcarEventoKickoff, passaNoFiltro } from './evento';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});

describe('permissão kickoff_impulsao.manage', () => {
  it('quem tem a permissão no perfil gerencia, independente de nome ou setor', () => {
    expect(podeGerenciarKickoff(mk({ capacidades: [PERMISSAO_KICKOFF] }))).toBe(true);
    expect(podeGerenciarKickoff(mk({ sector: 'comercial', capacidades: [PERMISSAO_KICKOFF] }))).toBe(true);
  });

  it('admin global do Meet continua podendo (é quem concede e revoga)', () => {
    expect(podeGerenciarKickoff(mk({ isAdmin: true }))).toBe(true);
  });

  it('equipe sem a permissão não gerencia', () => {
    expect(podeGerenciarKickoff(mk({}))).toBe(false);
    expect(podeGerenciarKickoff(mk({ capacidades: [] }))).toBe(false);
  });

  it('quem não é da equipe do Meet nunca gerencia, mesmo com a permissão gravada', () => {
    expect(podeGerenciarKickoff(mk({ isStaff: false, capacidades: [PERMISSAO_KICKOFF] }))).toBe(false);
    expect(podeGerenciarKickoff(mk({ isStaff: false, isAdmin: true }))).toBe(false);
    expect(podeGerenciarKickoff(null)).toBe(false);
  });
});

describe('capacidades do perfil', () => {
  it('lê só capacidades conhecidas e tolera perfil sem a coluna (antes da migration)', () => {
    expect(lerCapacidades({ capacidades: [PERMISSAO_KICKOFF, 'outra.coisa', 3] })).toEqual([PERMISSAO_KICKOFF]);
    expect(lerCapacidades({ is_admin: true })).toEqual([]);
    expect(lerCapacidades(null)).toEqual([]);
  });

  it('conceder e revogar não duplicam nem apagam outras', () => {
    expect(alternarCapacidade([], PERMISSAO_KICKOFF, true)).toEqual([PERMISSAO_KICKOFF]);
    expect(alternarCapacidade([PERMISSAO_KICKOFF], PERMISSAO_KICKOFF, true)).toEqual([PERMISSAO_KICKOFF]);
    expect(alternarCapacidade([PERMISSAO_KICKOFF], PERMISSAO_KICKOFF, false)).toEqual([]);
  });
});

describe('configuração do tipo de evento', () => {
  it('capacidade de 1 a 50, padrão 5', () => {
    expect(capacidadeValida(undefined)).toBe(CAPACIDADE_PADRAO);
    expect(capacidadeValida('')).toBe(5);
    expect(capacidadeValida(8)).toBe(8);
    expect(capacidadeValida('12')).toBe(12);
    for (const ruim of [0, 51, 2.5, 'x', -1]) expect(capacidadeValida(ruim)).toBeNull();
  });

  it('empresa organizadora vem do ambiente e precisa ser um uuid', () => {
    expect(organizadorDoKickoff({})).toBeNull();
    expect(organizadorDoKickoff({ MEET_KICKOFF_TENANT_ID: 'Customer Success' })).toBeNull();
    expect(organizadorDoKickoff({ MEET_KICKOFF_TENANT_ID: ' 11111111-1111-4111-8111-11111111111A ' })).toBe(
      '11111111-1111-4111-8111-11111111111a',
    );
  });
});

describe('sessão de kickoff como evento da agenda', () => {
  const reuniao: EventoDTO = {
    id: 'k1',
    tipo: 'reuniao',
    titulo: 'Kickoff Impulsão',
    inicio: '2026-12-01T17:00:00.000Z',
    fim: '2026-12-01T18:00:00.000Z',
    calendario: 'outros',
    status: 'scheduled',
    roomName: 'meet_abc',
    executorId: 'cs-1',
    cliente: 'Legacy Executoria',
    tenantId: 'org',
    setor: 'executoria',
    gravar: true,
    transcrever: true,
    onboarding: true,
    podeEditar: true,
  };

  it('vai para o calendário Kickoffs, sem sala do Meet e sem a empresa organizadora', () => {
    const ev = marcarEventoKickoff(reuniao, { capacidade: 5, aceitaReservas: true }, true);
    expect(ev).toMatchObject({ calendario: 'kickoff', tipoEvento: 'kickoff_impulsao', tenantId: null, cliente: null, gravar: false });
    expect(ev.roomName).toBeUndefined();
    expect(ev.kickoff).toEqual({ capacidade: 5, aceitaReservas: true, ocupadas: 0 });
    expect(ev.podeEditar).toBe(true);
  });

  it('quem não gerencia kickoffs vê a sessão na agenda, mas sem detalhes e sem editar', () => {
    const ev = marcarEventoKickoff(reuniao, { capacidade: 5, aceitaReservas: true }, false);
    expect(ev.kickoff).toBeUndefined();
    expect(ev.podeEditar).toBe(false);
    expect(ev.roomName).toBeUndefined();
  });

  it('sessão que já não está agendada não é editável', () => {
    expect(marcarEventoKickoff({ ...reuniao, status: 'canceled' }, { capacidade: 5, aceitaReservas: true }, true).podeEditar).toBe(false);
  });

  it('filtro visual: Todos, Reuniões comuns e Kickoffs', () => {
    const k = { tipoEvento: 'kickoff_impulsao' as const };
    const c = { tipoEvento: undefined };
    expect([passaNoFiltro(k, 'todos'), passaNoFiltro(c, 'todos')]).toEqual([true, true]);
    expect([passaNoFiltro(k, 'comuns'), passaNoFiltro(c, 'comuns')]).toEqual([false, true]);
    expect([passaNoFiltro(k, 'kickoffs'), passaNoFiltro(c, 'kickoffs')]).toEqual([true, false]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CurrentUser } from '@/lib/auth';

// Caminhos que mexem em reuniões fora de /api/agenda/eventos: com sessões de
// kickoff (M2), nenhum deles pode deixar reserva apontando para sessão movida,
// cancelada ou apagada.
type Linha = Record<string, unknown>;
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  meetings: [] as Linha[],
  kickoffs: new Set<string>(),
  comReservas: new Set<string>(),
  escritas: [] as string[],
  remarcar: null as null | ((itens: Array<{ id: string }>) => { ok: true; dados: number } | { ok: false; status: number; message: string }),
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: () => undefined }));
vi.mock('@/lib/calendar', () => ({
  updateCalendarEvent: async () => undefined,
  deleteCalendarEvent: async () => undefined,
  changeCalendarAttendees: async () => undefined,
}));
vi.mock('@/lib/kickoff/servidor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/kickoff/servidor')>()),
  ehSessaoDeKickoff: async (id: string) => state.kickoffs.has(id),
  sessoesDeKickoff: async (ids: string[]) =>
    new Map(ids.filter((i) => state.kickoffs.has(i)).map((i) => [i, { capacidade: 5, aceitaReservas: true, ocupadas: 1 }])),
}));
vi.mock('@/lib/kickoff/reservas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/kickoff/reservas')>()),
  sessoesComReservas: async (ids: string[]) => ids.filter((i) => state.comReservas.has(i)),
  remarcarSessoes: async (_u: string, itens: Array<{ id: string }>) => (state.remarcar ? state.remarcar(itens) : { ok: true, dados: itens.length }),
}));
vi.mock('@/lib/supabase/admin', () => {
  const from = (tabela: string) => {
    let mudou: string | null = null;
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'gte', 'order', 'limit']) q[m] = () => q;
    q.update = () => ((mudou = 'update'), q);
    q.delete = () => ((mudou = 'delete'), q);
    q.insert = async () => (state.escritas.push(`insert:${tabela}`), { error: null });
    q.maybeSingle = async () => ({ data: state.meetings[0] ?? null, error: null });
    q.then = (resolve: (v: unknown) => unknown) => {
      if (mudou) state.escritas.push(`${mudou}:${tabela}`);
      return resolve({ data: tabela === 'meetings' ? state.meetings : [], error: null });
    };
    return q;
  };
  return { createAdminSupabase: () => ({ from }) };
});

import { POST as CANCELAR_ANTIGO } from '@/app/api/meetings/cancel/route';
import { PATCH as EDITAR_ANTIGO } from '@/app/api/meetings/[id]/route';
import { POST as NO_SHOW } from '@/app/api/meetings/no-show/route';
import { POST as DESFAZER_CRIACAO } from '@/app/api/agenda/desfazer-criacao/route';
import { POST as RESTAURAR } from '@/app/api/agenda/restaurar/route';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'host', email: 'h@legacyeducacaocorp.com.br', name: 'H', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const req = (body: unknown) =>
  new NextRequest('https://meet.example/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const reuniao = (id: string): Linha => ({
  id,
  host_id: 'host',
  status: 'scheduled',
  started_at: null,
  created_at: new Date().toISOString(),
  scheduled_start_at: '2026-12-03T17:00:00.000Z',
  recurrence_parent_id: null,
});

beforeEach(() => {
  state.user = mk({});
  state.meetings = [reuniao('k1')];
  state.kickoffs = new Set(['k1']);
  state.comReservas = new Set();
  state.escritas = [];
  state.remarcar = null;
});

describe('rotas antigas de reunião não mexem em sessão de kickoff', () => {
  it('/api/meetings/cancel, /api/meetings/[id] e /api/meetings/no-show recusam (409) sem escrever', async () => {
    state.user = mk({ isAdmin: true });
    for (const res of [
      await CANCELAR_ANTIGO(req({ id: 'k1' })),
      await EDITAR_ANTIGO(req({ startAt: '2026-12-04T17:00:00.000Z' }), { params: Promise.resolve({ id: 'k1' }) }),
      await NO_SHOW(req({ id: 'k1' })),
    ]) {
      expect(res.status).toBe(409);
      expect(await res.text()).toMatch(/^Sessão de kickoff do Impulsão: altere pela agenda/);
    }
    expect(state.escritas).toEqual([]);
  });

  it('reunião comum continua passando (o cancelamento antigo grava)', async () => {
    state.kickoffs = new Set();
    expect((await CANCELAR_ANTIGO(req({ id: 'k1' }))).status).toBe(200);
    expect(state.escritas).toContain('update:meetings');
  });
});

describe('"Desfazer" da agenda com sessões de kickoff', () => {
  it('desfazer a criação de sessão que já recebeu reserva: recusa antes de apagar qualquer coisa', async () => {
    state.comReservas = new Set(['k1']);
    const res = await DESFAZER_CRIACAO(req({ ids: ['k1'] }));
    expect(res.status).toBe(409);
    expect(state.escritas).toEqual([]);
  });

  it('desfazer a criação sem reservas continua apagando', async () => {
    expect((await DESFAZER_CRIACAO(req({ ids: ['k1'] }))).status).toBe(200);
    expect(state.escritas).toContain('delete:meetings');
  });

  it('desfazer um movimento de sessão: só quem gerencia kickoffs, e pelas regras das reservas', async () => {
    const itens = [{ id: 'k1', inicio: '2026-12-03T17:00:00.000Z', fim: '2026-12-03T18:00:00.000Z' }];
    // O anfitrião sem a permissão não restaura a sessão de kickoff.
    expect(await (await RESTAURAR(req({ itens }))).json()).toEqual({ ok: true, restaurados: 0 });
    expect(state.escritas.filter((e) => e === 'update:meetings')).toEqual([]);

    state.user = mk({ capacidades: ['kickoff_impulsao.manage'] });
    state.remarcar = () => ({ ok: false, status: 422, message: 'A sessão de 03/12 às 14:00 tem 1 empresa(s) inscrita(s).' });
    const res = await RESTAURAR(req({ itens }));
    expect(res.status).toBe(422);
    expect(state.escritas.filter((e) => e === 'update:meetings')).toEqual([]);

    state.remarcar = null; // sem reservas: o banco faz; a rota não escreve de novo
    expect((await RESTAURAR(req({ itens }))).status).toBe(200);
    expect(state.escritas.filter((e) => e === 'update:meetings')).toEqual([]);
  });
});

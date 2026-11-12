import { beforeEach, describe, expect, it, vi } from 'vitest';

const HOST = 'host-1';
const linhas: Record<string, { id: string; host_id: string; title: string; status: string; scheduled_start_at: string; scheduled_end_at: string; recurrence_parent_id: null }> = {};
const updates: Array<{ id: string; ini: string; fim: string }> = [];
let falharNoId: string | null = null;
let ocupado: Array<{ id: string; inicio: Date; fim: Date }> = [];
let fimExpediente = '20:00';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => {} }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => ({ id: HOST, isAdmin: false }) }));
vi.mock('@/lib/calendar', () => ({ updateCalendarEvent: async () => {} }));
vi.mock('@/lib/agenda/servidor', () => ({
  podeUsarAgendaNova: async () => true,
  registrarSobreposicoes: async () => {},
  contextoExecutor: async () => ({
    fuso: 'America/Sao_Paulo',
    expediente: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ diaSemana: d, inicio: '07:00', fim: fimExpediente })),
    bloqueios: [],
    eventos: [...Object.values(linhas).map((l) => ({ id: l.id, inicio: new Date(l.scheduled_start_at), fim: new Date(l.scheduled_end_at) })), ...ocupado],
    feriados: [],
    filtroFeriados: { uf: null, municipio: null },
    regras: { bufferMin: 0, maxReunioesDia: 20, maxHorasDia: 12, maxHorasSemana: 60 },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => {
    const q = (tabela: string) => {
      const estado: { patch?: Record<string, string>; id?: string } = {};
      const api = {
        update(p: Record<string, string>) { estado.patch = p; return api; },
        insert: async () => ({ error: null }),
        select() { return api; },
        in: async () => ({ data: [], error: null }),
        eq(col: string, v: string) {
          if (col === 'id') estado.id = v;
          if (col === 'status' && tabela === 'meetings') {
            if (estado.id === falharNoId) { falharNoId = null; return Promise.resolve({ error: { message: 'falhou' } }); }
            updates.push({ id: estado.id!, ini: estado.patch!.scheduled_start_at, fim: estado.patch!.scheduled_end_at });
            return Promise.resolve({ error: null });
          }
          return api;
        },
      };
      return api;
    };
    return { from: q };
  },
}));
vi.mock('@/lib/agenda/alvos', async (orig) => ({
  ...(await orig<typeof import('@/lib/agenda/alvos')>()),
  resolverAlvos: async (_u: unknown, id: string) => (linhas[id] ? { ok: true, base: linhas[id], alvos: [linhas[id]] } : { ok: false, status: 404, message: 'Reunião não encontrada' }),
}));

const iso = (h: number) => new Date(Date.UTC(2026, 10, 12, h + 3)).toISOString();
const chamar = async (body: unknown) => (await import('./route')).POST(new Request('http://x/api/agenda/trocar', { method: 'POST', body: JSON.stringify(body) }) as never);

beforeEach(() => {
  for (const k of Object.keys(linhas)) delete linhas[k];
  updates.length = 0;
  ocupado = [];
  falharNoId = null;
  fimExpediente = '20:00';
  linhas.A = { id: 'A', host_id: HOST, title: 'Alfa', status: 'scheduled', scheduled_start_at: iso(9), scheduled_end_at: iso(10), recurrence_parent_id: null };
  linhas.B = { id: 'B', host_id: HOST, title: 'Beta', status: 'scheduled', scheduled_start_at: iso(13), scheduled_end_at: iso(14), recurrence_parent_id: null };
});

describe('POST /api/agenda/trocar', () => {
  it('troca as duas e devolve os horários antigos para o Desfazer', async () => {
    const r = await chamar({ a: 'A', b: 'B' });
    expect(r.status).toBe(200);
    expect(updates).toEqual([
      { id: 'A', ini: iso(13), fim: iso(14) },
      { id: 'B', ini: iso(9), fim: iso(10) },
    ]);
    const j = await r.json();
    expect(j.anteriores.map((x: { id: string; inicio: string }) => [x.id, x.inicio])).toEqual([['A', iso(9)], ['B', iso(13)]]);
  });

  it('as duas trocadas não contam como conflito uma da outra', async () => {
    const r = await chamar({ a: 'A', b: 'B' });
    expect(r.status).toBe(200);
  });

  it('sobreposição com outra reunião bloqueia o executor e não salva nada', async () => {
    ocupado = [{ id: 'X', inicio: new Date(iso(13)), fim: new Date(iso(14)) }];
    const r = await chamar({ a: 'A', b: 'B' });
    expect(r.status).toBe(409);
    expect((await r.json()).conflitos[0].tipo).toBe('sobreposicao');
    expect((await chamar({ a: 'A', b: 'B', justificativa: 'cliente pediu' })).status).toBe(409);
    expect(updates).toEqual([]);
  });

  it('aviso (fora do expediente) passa com justificativa', async () => {
    fimExpediente = '13:30';
    const r = await chamar({ a: 'A', b: 'B' });
    expect(r.status).toBe(409);
    expect(updates).toEqual([]);
    expect((await chamar({ a: 'A', b: 'B', justificativa: 'cliente pediu' })).status).toBe(200);
    expect(updates).toHaveLength(2);
  });

  it('se a segunda falhar, a primeira volta ao horário original', async () => {
    falharNoId = 'B';
    const r = await chamar({ a: 'A', b: 'B' });
    expect(r.status).toBe(500);
    expect(updates).toEqual([
      { id: 'A', ini: iso(13), fim: iso(14) },
      { id: 'A', ini: iso(9), fim: iso(10) },
    ]);
  });

  it('recusa a mesma reunião ou reunião de outra pessoa', async () => {
    expect((await chamar({ a: 'A', b: 'A' })).status).toBe(400);
    expect((await chamar({ a: 'A', b: 'Z' })).status).toBe(404);
  });
});

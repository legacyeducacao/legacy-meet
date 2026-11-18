import { beforeEach, describe, expect, it, vi } from 'vitest';

// criarReunioes com e sem Google Agenda (kickoff do Impulsão não cria evento
// nem convite). Banco e Google falsos.
const state = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; rows: unknown }>,
  leiturasEmpresa: 0,
  eventosGoogle: [] as unknown[],
  segundoPlano: [] as Array<Promise<void>>,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const q = {
        insert(rows: unknown) {
          state.inserts.push({ table, rows });
          return Promise.resolve({ error: null });
        },
        select: () => q,
        eq: () => q,
        update: () => q,
        maybeSingle: async () => {
          if (table === 'client_tenants') {
            state.leiturasEmpresa++;
            return { data: { email: 'empresa@cliente.com' }, error: null };
          }
          if (table === 'meetings') {
            return {
              data: { status: 'scheduled', scheduled_start_at: '2026-12-01T17:00:00.000Z', scheduled_end_at: '2026-12-01T18:00:00.000Z' },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/calendar', () => ({
  createCalendarEvent: async (input: unknown) => {
    state.eventosGoogle.push(input);
    return 'evt-1';
  },
}));
vi.mock('@/lib/segundoPlano', () => ({
  emSegundoPlano: (fn: () => Promise<void>) => {
    state.segundoPlano.push(fn());
  },
}));

import { criarReunioes, type CriarReunioesInput } from './meetingsCore';

const base: CriarReunioesInput = {
  hostId: 'cs-1',
  hostEmail: 'cs@legacyeducacaocorp.com.br',
  sector: 'executoria',
  tenantId: '11111111-1111-4111-8111-111111111111',
  title: 'Kickoff Impulsão',
  ocorrencias: [{ inicio: new Date('2026-12-01T17:00:00.000Z'), fim: new Date('2026-12-01T18:00:00.000Z') }],
  record: false,
  transcribe: false,
  onboarding: true,
  coHostIds: [],
  team: [],
  guestEmails: [],
  recurrenceRule: null,
};

beforeEach(() => {
  state.inserts = [];
  state.leiturasEmpresa = 0;
  state.eventosGoogle = [];
  state.segundoPlano = [];
});

describe('criarReunioes e o Google Agenda', () => {
  it('googleAgenda: false cria a reunião da agenda sem evento, sem convite e sem ler o e-mail da empresa', async () => {
    const r = await criarReunioes({ ...base, googleAgenda: false });
    expect(r.ok).toBe(true);
    await Promise.all(state.segundoPlano);
    expect(state.inserts.map((i) => i.table)).toEqual(['meetings', 'meet_meeting_sector']);
    expect(state.segundoPlano).toHaveLength(0);
    expect(state.eventosGoogle).toHaveLength(0);
    expect(state.leiturasEmpresa).toBe(0);
  });

  it('Comercial não cria evento nem convite no Google (duplicava as tarefas do CRM)', async () => {
    const r = await criarReunioes({ ...base, sector: 'comercial', onboarding: false, guestEmails: ['lead@empresa.com'] });
    expect(r.ok).toBe(true);
    await Promise.all(state.segundoPlano);
    expect(state.inserts.map((i) => i.table)).toEqual(['meetings', 'meet_meeting_sector']);
    expect(state.eventosGoogle).toHaveLength(0);
  });

  it('Avulsa cria o evento só com anfitriões e convidados, sem convidar a empresa interna', async () => {
    const r = await criarReunioes({ ...base, sector: 'avulsa', onboarding: false, guestEmails: ['parceiro@empresa.com'] });
    expect(r.ok).toBe(true);
    await Promise.all(state.segundoPlano);
    expect(state.leiturasEmpresa).toBe(0);
    expect(state.eventosGoogle).toHaveLength(1);
    expect((state.eventosGoogle[0] as { attendees: string[] }).attendees).toEqual(['cs@legacyeducacaocorp.com.br', 'parceiro@empresa.com']);
    const setor = state.inserts.find((i) => i.table === 'meet_meeting_sector')?.rows as Array<{ sector: string; onboarding: boolean }>;
    expect(setor[0]).toMatchObject({ sector: 'avulsa', onboarding: false });
  });

  it('reunião comum (padrão) continua criando o evento e convidando a empresa', async () => {
    const r = await criarReunioes({ ...base, record: true, transcribe: true, onboarding: false });
    expect(r.ok).toBe(true);
    await Promise.all(state.segundoPlano);
    expect(state.leiturasEmpresa).toBe(1);
    expect(state.eventosGoogle).toHaveLength(1);
    expect((state.eventosGoogle[0] as { attendees: string[] }).attendees).toContain('empresa@cliente.com');
  });
});

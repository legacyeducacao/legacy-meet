import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CurrentUser } from '@/lib/auth';

// Sessão de kickoff do Impulsão nunca abre sala do Meet (usa Zoom).
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  kickoffs: new Set<string>(),
  atualizadas: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));
vi.mock('@/lib/meetingHosts', () => ({ isMeetingHost: async () => true }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      if (table === 'agenda_kickoff_sessoes') {
        return {
          select: () => ({
            in: async (_c: string, ids: string[]) => ({
              data: ids.filter((id) => state.kickoffs.has(id)).map((meeting_id) => ({ meeting_id, capacidade: 5, aceita_reservas: true })),
              error: null,
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { host_id: 'cs-1', room_name: 'meet_sala' }, error: null }) }) }),
        update: (m: Record<string, unknown>) => ({ eq: async () => (state.atualizadas.push(m), { error: null }) }),
      };
    },
  }),
}));

import { POST } from './route';

const anfitriao: CurrentUser = {
  id: 'cs-1', email: 'cs@legacyeducacaocorp.com.br', name: 'CS', role: 'CUSTOMER_SUCCESS',
  isStaff: true, isAdmin: true, sector: 'ambos',
};
const iniciar = (id: string) =>
  POST(new NextRequest('https://meet.example/api/meetings/start', { method: 'POST', body: JSON.stringify({ id }) }));

beforeEach(() => {
  state.user = anfitriao;
  state.kickoffs = new Set(['kickoff']);
  state.atualizadas = [];
});

describe('POST /api/meetings/start', () => {
  it('sessão de kickoff: recusa (409) e não marca como ao vivo nem devolve sala', async () => {
    const res = await iniciar('kickoff');
    expect(res.status).toBe(409);
    expect(await res.text()).not.toContain('meet_sala');
    expect(state.atualizadas).toHaveLength(0);
  });

  it('reunião comum continua abrindo a sala do Meet', async () => {
    const res = await iniciar('comum');
    expect(res.status).toBe(200);
    expect((await res.json()).roomName).toBe('meet_sala');
    expect(state.atualizadas[0]).toMatchObject({ status: 'live' });
  });
});

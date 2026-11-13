import { beforeEach, describe, expect, it, vi } from 'vitest';

const chamadas: string[] = [];
let reuniao = { meetingId: 'm1', roomName: 'meet_sala', hostId: 'u1', executorId: 'e1', onboarding: true, noShow: false };

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => ({ id: 'u1', isStaff: true, isAdmin: false }) }));
vi.mock('@/lib/livekitAuth', () => ({ isValidRoomName: () => true }));
vi.mock('@/lib/noShow', () => ({ applyNoShow: async () => ({ ok: true }) }));
vi.mock('@/lib/execscore', async (orig) => {
  const real = await orig<typeof import('@/lib/execscore')>();
  const log = (nome: string) => async (...args: unknown[]) => {
    chamadas.push(`${nome}${args.length > 1 && typeof args[1] !== 'object' ? `:${args[1]}` : ''}`);
  };
  return {
    ...real,
    isEnabled: () => true,
    findExecutoriaMeeting: async () => reuniao,
    getIntegracao: async () => null,
    definirOnboarding: log('definirOnboarding'),
    descartarEnvio: log('descartarEnvio'),
    savePillarChoice: log('savePillarChoice'),
    garantirTranscricao: log('garantirTranscricao'),
    reabrirEnvio: log('reabrirEnvio'),
    dispatchMeeting: async () => { chamadas.push('dispatch'); return 'nao_pronta'; },
  };
});

const post = async (body: unknown) =>
  (await import('./route')).POST(new Request('http://x/api/execscore/pilares', { method: 'POST', body: JSON.stringify(body) }) as never);

beforeEach(() => {
  chamadas.length = 0;
  reuniao = { ...reuniao, onboarding: true, noShow: false };
});

describe('POST /api/execscore/pilares: onboarding', () => {
  it('desmarcar onboarding salva os pilares e devolve a reunião para a fila', async () => {
    const r = await post({ room: 'meet_sala', noShow: false, onboarding: false, desabilitados: [] });
    expect(r.status).toBe(200);
    expect(chamadas).toEqual(['definirOnboarding:false', 'savePillarChoice', 'garantirTranscricao', 'reabrirEnvio', 'dispatch']);
  });

  it('marcar onboarding tira da fila e não salva pilares', async () => {
    reuniao = { ...reuniao, onboarding: false };
    const r = await post({ room: 'meet_sala', noShow: false, onboarding: true });
    expect(await r.json()).toEqual({ ok: true, onboarding: true });
    expect(chamadas).toEqual(['definirOnboarding:true', 'descartarEnvio:reunião de onboarding']);
  });

  it('continuar como onboarding não mexe em nada', async () => {
    const r = await post({ room: 'meet_sala', noShow: false, onboarding: true });
    expect(await r.json()).toEqual({ ok: true, onboarding: true });
    expect(chamadas).toEqual([]);
  });

  it('reunião comum segue igual: salva pilares e envia', async () => {
    reuniao = { ...reuniao, onboarding: false };
    await post({ room: 'meet_sala', noShow: false, onboarding: false, desabilitados: [] });
    expect(chamadas).toEqual(['savePillarChoice', 'dispatch']);
  });
});

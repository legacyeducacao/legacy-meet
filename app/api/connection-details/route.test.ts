import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ user: null as null | { isStaff: boolean } }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => state.user }));

// A rota lê as envs no carregamento do módulo: define antes dos imports (hoisted).
vi.hoisted(() => {
  process.env.LIVEKIT_API_KEY = 'APIkey';
  process.env.LIVEKIT_API_SECRET = 'secret-de-teste-com-tamanho-suficiente-1234567890';
  process.env.LIVEKIT_URL = 'wss://livekit.example';
});

import { GET } from './route';
import { signHostKey } from '@/lib/hostLink';

function req(params: Record<string, string>, cookies: Record<string, string> = {}) {
  const url = new URL('https://meet.example/api/connection-details');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(url, { headers: cookie ? { cookie } : {} });
}

const decodeJwt = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

describe('GET /api/connection-details', () => {
  beforeAll(() => {
    state.user = null;
  });

  it('rejeita roomName inválido', async () => {
    const res = await GET(req({ roomName: '../x', participantName: 'Ana' }));
    expect(res!.status).toBe(400);
  });

  it('convidado sem hostKey: token sem publicar/assinar, sem roomAdmin', async () => {
    const res = await GET(req({ roomName: 'sala-1', participantName: 'Ana' }));
    expect(res!.status).toBe(200);
    const data = await res!.json();
    expect(data.isHost).toBe(false);
    const claims = decodeJwt(data.participantToken);
    expect(claims.video).toMatchObject({
      room: 'sala-1',
      roomJoin: true,
      canPublish: false,
      canSubscribe: false,
      canUpdateOwnMetadata: false,
    });
    expect(claims.video.roomAdmin).toBeUndefined();
    expect(res!.headers.get('set-cookie')).not.toContain('lm-host-');
  });

  it('sufixo da identidade vem de cookie assinado; cookie forjado é ignorado', async () => {
    const first = await GET(req({ roomName: 'sala-1', participantName: 'Ana' }));
    const setCookie = first!.headers.get('set-cookie') ?? '';
    const m = setCookie.match(/random-participant-postfix=([a-z0-9]+\.[a-f0-9]+)/);
    expect(m).not.toBeNull();
    const cookieValue = m![1];
    const identity1 = decodeJwt((await first!.json()).participantToken).sub as string;
    expect(identity1).toBe(`Ana__${cookieValue.split('.')[0]}`);

    // Mesmo cookie → mesma identidade (reload no meio da reunião).
    const again = await GET(req({ roomName: 'sala-1', participantName: 'Ana' }, { 'random-participant-postfix': cookieValue }));
    expect(decodeJwt((await again!.json()).participantToken).sub).toBe(identity1);

    // Cookie forjado com o sufixo de outra pessoa → sufixo novo, não o forjado.
    const forged = await GET(req({ roomName: 'sala-1', participantName: 'Ana' }, { 'random-participant-postfix': 'ab12' }));
    const identityForged = decodeJwt((await forged!.json()).participantToken).sub as string;
    expect(identityForged).not.toBe('Ana__ab12');
  });

  it('hostKey válido na URL: vira host e grava o cookie lm-host-<sala>', async () => {
    const key = signHostKey('sala-1');
    const res = await GET(req({ roomName: 'sala-1', participantName: 'João', hostKey: key }));
    const data = await res!.json();
    expect(data.isHost).toBe(true);
    expect(decodeJwt(data.participantToken).video.roomAdmin).toBe(true);
    const setCookie = res!.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`lm-host-sala-1=${key}`);
    expect(setCookie.toLowerCase()).toContain('samesite=none');
    expect(setCookie.toLowerCase()).toContain('httponly');
  });

  it('sem hostKey na URL mas com o cookie da sala: continua host (F5/reconexão)', async () => {
    const key = signHostKey('sala-1');
    const res = await GET(req({ roomName: 'sala-1', participantName: 'João' }, { 'lm-host-sala-1': key }));
    const data = await res!.json();
    expect(data.isHost).toBe(true);
  });

  it('cookie de OUTRA sala não dá host', async () => {
    const key = signHostKey('sala-2');
    const res = await GET(req({ roomName: 'sala-1', participantName: 'João' }, { 'lm-host-sala-1': key }));
    expect((await res!.json()).isHost).toBe(false);
  });
});

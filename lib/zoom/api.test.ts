import { describe, expect, it, vi } from 'vitest';
import { createZoomClient, ZoomApiError } from './api';

// Cliente Zoom com fetch e relógio falsos: nenhum teste sai para a rede.
const CREDS = { accountId: 'conta-1', clientId: 'cliente-1', clientSecret: 'segredo-que-nao-pode-vazar' };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function zoomFalso(rotas: Array<(url: string, init: RequestInit) => Response | Promise<Response> | undefined>) {
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    chamadas.push({ url: u, init: init ?? {} });
    for (const r of rotas) {
      const res = await r(u, init ?? {});
      if (res) return res;
    }
    throw new Error(`chamada inesperada: ${u}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, chamadas };
}
const token = (valor = 'tok-1', expira = 3600) => (u: string) => (u.startsWith('https://zoom.us/oauth/token') ? json(200, { access_token: valor, expires_in: expira }) : undefined);
const reuniao = (u: string) => (u.startsWith('https://api.zoom.us/v2/meetings/') ? json(200, { id: 81234567890, type: 8 }) : undefined);

describe('cliente Zoom (Server-to-Server OAuth)', () => {
  it('pede o token com account_credentials e Basic; usa Bearer na API; ID codificado', async () => {
    const z = zoomFalso([token(), reuniao]);
    const c = createZoomClient(CREDS, { fetchImpl: z.fetchImpl });
    expect(await c.getMeeting('81234567890')).toMatchObject({ type: 8 });
    expect(z.chamadas[0].url).toBe('https://zoom.us/oauth/token?grant_type=account_credentials&account_id=conta-1');
    expect(z.chamadas[0].init.method).toBe('POST');
    expect((z.chamadas[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('cliente-1:segredo-que-nao-pode-vazar').toString('base64')}`);
    expect(z.chamadas[1].url).toBe('https://api.zoom.us/v2/meetings/81234567890');
    expect((z.chamadas[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    await c.getMeeting('../users/me');
    expect(z.chamadas.slice(-1)[0]?.url).toBe('https://api.zoom.us/v2/meetings/..%2Fusers%2Fme');
  });

  it('token válido é reaproveitado; perto de vencer (folga de 60 s), é renovado', async () => {
    let agora = 1_000_000;
    let n = 0;
    const z = zoomFalso([(u) => (u.includes('oauth') ? json(200, { access_token: `tok-${++n}`, expires_in: 3600 }) : undefined), reuniao]);
    const c = createZoomClient(CREDS, { fetchImpl: z.fetchImpl, now: () => agora });
    await c.getMeeting('81234567890');
    await c.getMeeting('81234567890');
    expect(n).toBe(1);
    agora += 3600_000 - 59_000; // dentro da folga: considera vencido
    await c.getMeeting('81234567890');
    expect(n).toBe(2);
    expect((z.chamadas.slice(-1)[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tok-2');
  });

  it('pedidos simultâneos esperam a mesma renovação do token', async () => {
    let n = 0;
    const z = zoomFalso([(u) => (u.includes('oauth') ? (n++, json(200, { access_token: 'tok', expires_in: 3600 })) : undefined), reuniao]);
    const c = createZoomClient(CREDS, { fetchImpl: z.fetchImpl });
    await Promise.all([c.getMeeting('81234567890'), c.getMeeting('81234567891'), c.getMeeting('81234567892')]);
    expect(n).toBe(1);
  });

  it('401 da API (token revogado antes da hora): descarta, renova e repete UMA vez', async () => {
    let n = 0;
    let api = 0;
    const z = zoomFalso([
      (u) => (u.includes('oauth') ? json(200, { access_token: `tok-${++n}`, expires_in: 3600 }) : undefined),
      (u) => (u.includes('/meetings/') ? (++api === 1 ? json(401, { code: 124, message: 'Invalid access token.' }) : json(200, { id: 1, type: 8 })) : undefined),
    ]);
    const c = createZoomClient(CREDS, { fetchImpl: z.fetchImpl });
    expect(await c.getMeeting('81234567890')).toMatchObject({ type: 8 });
    expect(n).toBe(2);
    // Dois 401 seguidos: desiste, sem laço.
    const z2 = zoomFalso([token(), (u) => (u.includes('/meetings/') ? json(401, { code: 124 }) : undefined)]);
    const e = await createZoomClient(CREDS, { fetchImpl: z2.fetchImpl }).getMeeting('81234567890').catch((x) => x);
    expect(e).toBeInstanceOf(ZoomApiError);
    expect(e.status).toBe(401);
    expect(z2.chamadas.filter((c) => c.url.includes('/meetings/'))).toHaveLength(2);
  });

  it('credenciais recusadas: erro de origem "oauth", sem segredo na mensagem', async () => {
    const z = zoomFalso([(u) => (u.includes('oauth') ? json(400, { reason: 'Invalid client_id or client_secret', error: 'invalid_client' }) : undefined)]);
    const e = await createZoomClient(CREDS, { fetchImpl: z.fetchImpl }).getMeeting('81234567890').catch((x) => x);
    expect(e).toMatchObject({ status: 400, origem: 'oauth' });
    expect(String(e.message)).not.toMatch(/segredo|cliente-1|invalid_client/);
  });

  it('erros da API: status e código do Zoom, sem o texto dele; 429 com Retry-After', async () => {
    const casos: Array<[Response, Partial<ZoomApiError>]> = [
      [json(404, { code: 3001, message: 'Meeting does not exist: 81234567890.' }), { status: 404, code: 3001, origem: 'api' }],
      [json(429, { code: 429, message: 'Too many requests' }, { 'retry-after': '7' }), { status: 429, esperarSegundos: 7 }],
      [json(503, null), { status: 503, code: null }],
    ];
    for (const [resposta, esperado] of casos) {
      const z = zoomFalso([token(), (u) => (u.includes('/meetings/') ? resposta : undefined)]);
      const e = await createZoomClient(CREDS, { fetchImpl: z.fetchImpl }).getMeeting('81234567890').catch((x) => x);
      expect(e).toBeInstanceOf(ZoomApiError);
      expect(e).toMatchObject(esperado);
      expect(String(e.message)).not.toMatch(/does not exist|Too many/);
    }
  });

  it('rede caída ou prazo esgotado viram status 0', async () => {
    const rede = zoomFalso([() => Promise.reject(new TypeError('fetch failed'))]);
    expect(await createZoomClient(CREDS, { fetchImpl: rede.fetchImpl }).getMeeting('81234567890').catch((x) => x)).toMatchObject({ status: 0, origem: 'oauth' });
    const lento = vi.fn(
      (_u: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'TimeoutError' })))),
    ) as unknown as typeof fetch;
    const e = await createZoomClient(CREDS, { fetchImpl: lento, timeoutMs: 20 }).getMeeting('81234567890').catch((x) => x);
    expect(e).toMatchObject({ status: 0, message: 'O Zoom não respondeu a tempo.' });
  });
});

describe('cliente Zoom: inscrições (Zoom E2)', () => {
  const SALA = '81234567890';
  const BASE = `https://api.zoom.us/v2/meetings/${SALA}/registrants`;

  it('addRegistrant: POST com JSON e Bearer; devolve o id e o link individual', async () => {
    const z = zoomFalso([token(), (u, i) => (u === BASE && i.method === 'POST' ? json(201, { registrant_id: 'reg-1', join_url: 'https://zoom.us/w/1?tk=x' }) : undefined)]);
    const c = createZoomClient(CREDS, { fetchImpl: z.fetchImpl });
    const r = await c.addRegistrant(SALA, { email: 'maria@x.com.br', first_name: 'Maria', last_name: 'Silva | Padaria #A1B2C3D4', org: 'Padaria' });
    expect(r).toEqual({ registrant_id: 'reg-1', join_url: 'https://zoom.us/w/1?tk=x' });
    const chamada = z.chamadas[1];
    expect(chamada.init.method).toBe('POST');
    expect(chamada.init.headers).toMatchObject({ Authorization: 'Bearer tok-1', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(chamada.init.body))).toEqual({ email: 'maria@x.com.br', first_name: 'Maria', last_name: 'Silva | Padaria #A1B2C3D4', org: 'Padaria' });
  });

  it('getRegistrant: GET sem corpo, com o id codificado; o token é o mesmo da leitura da reunião', async () => {
    let tokens = 0;
    const z = zoomFalso([
      (u) => (u.includes('oauth') ? json(200, { access_token: `tok-${++tokens}`, expires_in: 3600 }) : undefined),
      (u) => (u === `${BASE}/a%2Fb` ? json(200, { id: 'a/b', email: 'm@x.com', status: 'approved' }) : undefined),
      reuniao,
    ]);
    const c = createZoomClient(CREDS, { fetchImpl: z.fetchImpl });
    await c.getMeeting(SALA);
    expect(await c.getRegistrant(SALA, 'a/b')).toMatchObject({ id: 'a/b', status: 'approved' });
    expect(tokens).toBe(1);
    expect(z.chamadas[2].init.body).toBeUndefined();
    expect((z.chamadas[2].init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('findRegistrantByEmail: procura em aprovadas e pendentes, pagina e não diferencia maiúsculas', async () => {
    const z = zoomFalso([
      token(),
      (u) => {
        if (!u.startsWith(`${BASE}?`)) return undefined;
        const q = new URL(u).searchParams;
        if (q.get('status') === 'approved' && !q.get('next_page_token')) return json(200, { registrants: [{ id: 'r1', email: 'outra@x.com' }], next_page_token: 'p2' });
        if (q.get('status') === 'approved') return json(200, { registrants: [{ id: 'r2', email: 'mais@x.com' }] });
        return json(200, { registrants: [{ id: 'r3', email: 'Maria@X.com', join_url: 'https://zoom.us/w/1?tk=y' }] });
      },
    ]);
    const c = createZoomClient(CREDS, { fetchImpl: z.fetchImpl });
    expect(await c.findRegistrantByEmail(SALA, ' maria@x.com ')).toEqual({ id: 'r3', email: 'Maria@X.com', join_url: 'https://zoom.us/w/1?tk=y', status: 'pending' });
    expect(z.chamadas.filter((x) => x.url.startsWith(BASE))).toHaveLength(3);
    expect(await c.findRegistrantByEmail(SALA, 'ninguem@x.com')).toBeNull();
  });

  it('erros ao inscrever: status e código do Zoom, sem o texto dele; 401 renova o token e repete uma vez', async () => {
    const z = zoomFalso([token(), (u) => (u === BASE ? json(403, { code: 4711, message: 'Invalid access token, does not contain scopes: meeting:write:registrant:admin' }) : undefined)]);
    const e = await createZoomClient(CREDS, { fetchImpl: z.fetchImpl }).addRegistrant(SALA, { email: 'm@x.com', first_name: 'M' }).catch((x) => x);
    expect(e).toBeInstanceOf(ZoomApiError);
    expect(e).toMatchObject({ status: 403, code: 4711, origem: 'api' });
    expect(String(e.message)).not.toMatch(/scopes|access token/i);

    let n = 0;
    let api = 0;
    const z2 = zoomFalso([
      (u) => (u.includes('oauth') ? json(200, { access_token: `tok-${++n}`, expires_in: 3600 }) : undefined),
      (u) => (u === BASE ? (++api === 1 ? json(401, { code: 124 }) : json(201, { registrant_id: 'reg-9', join_url: 'https://zoom.us/w/1?tk=z' })) : undefined),
    ]);
    expect(await createZoomClient(CREDS, { fetchImpl: z2.fetchImpl }).addRegistrant(SALA, { email: 'm@x.com', first_name: 'M' })).toMatchObject({ registrant_id: 'reg-9' });
    expect(n).toBe(2);
  });
});

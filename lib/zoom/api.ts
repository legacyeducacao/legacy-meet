/**
 * Cliente mínimo da API do Zoom (v2) com Server-to-Server OAuth. SÓ SERVIDOR.
 *
 * Adaptado do Legacy CS (src/lib/zoom-api.ts, guia técnico do kickoff, Apêndice A),
 * que por sua vez veio do Legacy Plan (supabase/functions/_shared/zoom.ts): o token,
 * a leitura da reunião (Zoom E1) e as inscrições (Zoom E2: criar, ler e procurar
 * pelo e-mail), todas sobre o mesmo `request`.
 *
 * Diferenças em relação ao CS:
 *   - o erro diz de onde veio (`origem`: 'oauth' ou 'api'), para a tela separar
 *     "credenciais recusadas" de "sem permissão na reunião";
 *   - o 429 traz o tempo de espera do cabeçalho Retry-After, quando houver.
 *
 * Não lê process.env nem fala com o banco: credenciais, fetch e relógio chegam de
 * fora (testes sem rede). Token: grant_type=account_credentials, guardado em
 * memória até `expires_in` menos 60 s; pedidos simultâneos esperam a mesma
 * renovação; um 401 da API descarta o token e repete a chamada UMA vez. Cada
 * chamada tem prazo (15 s); sem resposta vira ZoomApiError(0).
 *
 * Nunca loga nada. As mensagens de erro levam só o status HTTP e o código do
 * Zoom: nunca token, secret, link ou senha.
 */

export interface ZoomCredentials {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

export interface ZoomClientOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  apiBase?: string;
  oauthUrl?: string;
  /** Prazo de cada chamada ao Zoom. Padrão: 15 s. */
  timeoutMs?: number;
}

/** Erro do Zoom. Status 0 = sem resposta (rede ou prazo esgotado). */
export class ZoomApiError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly origem: 'oauth' | 'api';
  /** Segundos de espera pedidos pelo Zoom (429), quando informados. */
  readonly esperarSegundos: number | null;

  constructor(status: number, code: number | null, message: string, origem: 'oauth' | 'api' = 'api', esperarSegundos: number | null = null) {
    super(message);
    this.name = 'ZoomApiError';
    this.status = status;
    this.code = code;
    this.origem = origem;
    this.esperarSegundos = esperarSegundos;
  }
}

export interface ZoomMeetingOccurrence {
  occurrence_id?: string;
  start_time?: string;
  duration?: number;
  /** available | deleted */
  status?: string;
}

export interface ZoomMeeting {
  id: number;
  /** UUID da reunião (a E3 identifica cada execução pelo UUID da instância). */
  uuid?: string;
  topic?: string;
  /** 1 instantânea, 2 agendada, 3 recorrente sem horário fixo, 8 recorrente com horário fixo. */
  type: number;
  timezone?: string;
  duration?: number;
  recurrence?: {
    /** 1 diária, 2 semanal, 3 mensal. */
    type?: number;
    repeat_interval?: number;
    end_times?: number;
    end_date_time?: string;
  };
  /** Ocorrências que ainda vão acontecer (o Zoom não lista as passadas por padrão). */
  occurrences?: ZoomMeetingOccurrence[];
  /** Link de início do anfitrião (contém ZAK). Nunca guardar nem logar. */
  start_url?: string;
  /** Link genérico da reunião. Nunca guardar nem logar. */
  join_url?: string;
  /** Senha em texto. Nunca guardar nem logar. */
  password?: string;
  settings?: {
    /** 0 aprovação automática, 1 manual, 2 sem inscrição. */
    approval_type?: number;
    /** Só recorrentes: 1 inscreve uma vez para todas, 2 inscreve em cada, 3 escolhe ocorrências. */
    registration_type?: number;
    waiting_room?: boolean;
    meeting_authentication?: boolean;
    join_before_host?: boolean;
  };
}

export interface ZoomRegistrantInput {
  email: string;
  first_name: string;
  last_name?: string;
  org?: string;
}

export interface ZoomRegistrantCreated {
  registrant_id: string;
  /** Link individual da inscrição: credencial. Nunca logar nem mandar ao navegador fora do encaminhamento. */
  join_url: string;
}

export interface ZoomRegistrant {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  /** approved | pending | denied */
  status?: string;
  /** Link individual: credencial. */
  join_url?: string;
}

// Folga antes do vencimento: evita usar um token que expira no meio da chamada.
const FOLGA_DO_TOKEN_MS = 60_000;

function segundosDeEspera(resp: Response): number | null {
  const v = Number(resp.headers.get('retry-after'));
  return Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), 3600) : null;
}

export function createZoomClient(creds: ZoomCredentials, opts: ZoomClientOptions = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const apiBase = opts.apiBase ?? 'https://api.zoom.us/v2';
  const oauthUrl = opts.oauthUrl ?? 'https://zoom.us/oauth/token';
  const timeoutMs = opts.timeoutMs ?? 15_000;

  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  /** fetch com prazo; sem resposta vira ZoomApiError(0) sem detalhes internos. */
  async function chamar(url: string, init: RequestInit, origem: 'oauth' | 'api'): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const prazo = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new ZoomApiError(0, null, prazo ? 'O Zoom não respondeu a tempo.' : 'Falha de rede ao falar com o Zoom.', origem);
    }
  }

  async function fetchToken(): Promise<string> {
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const url = `${oauthUrl}?grant_type=account_credentials&account_id=${encodeURIComponent(creds.accountId)}`;
    const resp = await chamar(url, { method: 'POST', headers: { Authorization: `Basic ${basic}` } }, 'oauth');
    const body = await safeJson(resp);
    if (!resp.ok || typeof body?.access_token !== 'string') {
      // O corpo do OAuth traz {reason, error}; nada sensível, mas não repassamos.
      throw new ZoomApiError(resp.status, null, `Falha ao obter token do Zoom (HTTP ${resp.status})`, 'oauth', resp.status === 429 ? segundosDeEspera(resp) : null);
    }
    const expiresInSec = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    cached = { token: body.access_token, expiresAt: now() + expiresInSec * 1000 };
    return body.access_token;
  }

  async function getAccessToken(): Promise<string> {
    if (cached && now() < cached.expiresAt - FOLGA_DO_TOKEN_MS) return cached.token;
    if (!inFlight) {
      inFlight = fetchToken().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  function invalidateToken() {
    cached = null;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getAccessToken();
      const resp = await chamar(
        `${apiBase}${path}`,
        {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        },
        'api',
      );
      if (resp.status === 401 && attempt === 0) {
        invalidateToken();
        continue;
      }
      if (resp.status === 204) return undefined as T;
      const data = await safeJson(resp);
      if (!resp.ok) {
        const code = typeof data?.code === 'number' ? data.code : null;
        throw new ZoomApiError(resp.status, code, `Zoom respondeu HTTP ${resp.status}${code ? ` (código ${code})` : ''}`, 'api', resp.status === 429 ? segundosDeEspera(resp) : null);
      }
      return data as T;
    }
    throw new ZoomApiError(401, null, 'Zoom recusou o token renovado', 'api');
  }

  return {
    getAccessToken,
    invalidateToken,
    /** GET /meetings/{id}. Escopo: meeting:read:meeting:admin. Só leitura. */
    getMeeting(meetingId: string): Promise<ZoomMeeting> {
      return request<ZoomMeeting>('GET', `/meetings/${encodeURIComponent(meetingId)}`);
    },

    // Inscrições (Zoom E2), como no Legacy CS e no Plan. Escopos:
    // meeting:write:registrant:admin, meeting:read:registrant:admin e
    // meeting:read:list_registrants:admin.

    /** POST /meetings/{id}/registrants. Devolve o link individual (credencial). */
    addRegistrant(meetingId: string, input: ZoomRegistrantInput): Promise<ZoomRegistrantCreated> {
      return request<ZoomRegistrantCreated>('POST', `/meetings/${encodeURIComponent(meetingId)}/registrants`, input);
    },

    /** GET /meetings/{id}/registrants/{registrantId}. Só leitura. */
    getRegistrant(meetingId: string, registrantId: string): Promise<ZoomRegistrant> {
      return request<ZoomRegistrant>('GET', `/meetings/${encodeURIComponent(meetingId)}/registrants/${encodeURIComponent(registrantId)}`);
    },

    /** Procura uma inscrição pelo e-mail (sem diferenciar maiúsculas), entre aprovadas e pendentes. Só leitura. */
    async findRegistrantByEmail(meetingId: string, email: string): Promise<ZoomRegistrant | null> {
      const alvo = email.trim().toLowerCase();
      for (const status of ['approved', 'pending']) {
        let pageToken = '';
        // Limite de páginas: defesa contra laço se o Zoom repetir o token.
        for (let pagina = 0; pagina < 50; pagina++) {
          const qs = new URLSearchParams({ status, page_size: '300' });
          if (pageToken) qs.set('next_page_token', pageToken);
          const data = await request<{ registrants?: ZoomRegistrant[]; next_page_token?: string }>(
            'GET',
            `/meetings/${encodeURIComponent(meetingId)}/registrants?${qs.toString()}`,
          );
          const achado = (data?.registrants ?? []).find((r) => (r.email ?? '').trim().toLowerCase() === alvo);
          if (achado) return { ...achado, status: achado.status ?? status };
          pageToken = data?.next_page_token ?? '';
          if (!pageToken) break;
        }
      }
      return null;
    },
  };
}

export type ZoomClient = ReturnType<typeof createZoomClient>;

async function safeJson(resp: Response): Promise<any> {
  try {
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

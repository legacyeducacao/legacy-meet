/**
 * Regras e tipos do front da escolha de pilares do ExecScore (tela de saída e
 * detalhe da gravação). Fica separado de lib/execscore.ts, que é do servidor
 * (acessa o banco) e não pode ir para o navegador.
 */

export type Pilar = { key: string; label: string };
export type ExecScoreStatus = 'aguardando' | 'processando' | 'enviada' | 'erro' | 'descartada';

export type PilaresInfo =
  | { elegivel: false; precisaLogin: boolean }
  | {
      elegivel: true;
      meetingId: string;
      executorName: string | null;
      titulo: string | null;
      cliente: string | null;
      /** Reunião de onboarding: não tem pilares nem vai para o ExecScore. */
      onboarding: boolean;
      /** Marcada como no-show (cliente não compareceu). */
      noShow: boolean;
      pilares: Pilar[];
      /** null = o executor ainda não escolheu (todos ligados). */
      desabilitados: string[] | null;
      status: ExecScoreStatus | null;
      /** Erro e o sistema já parou de tentar sozinho: só vai reenviando. */
      esgotado?: boolean;
      avaliacaoId: string | null;
    };

export const STATUS_LABEL: Record<ExecScoreStatus, string> = {
  aguardando: 'Na fila do ExecScore',
  processando: 'Avaliando',
  enviada: 'Enviada ao ExecScore',
  erro: 'Erro no envio (vamos tentar de novo)',
  descartada: 'Fora do ExecScore',
};

/** Erro depois da última tentativa automática. */
export const LABEL_ESGOTADO = 'Erro no envio: salve os pilares para reenviar';

/** Pilares desligados no começo: a escolha salva, sem chaves que não existem mais. */
export function initialDisabled(desabilitados: string[] | null, pilares: Pilar[]): string[] {
  if (!desabilitados) return [];
  const keys = new Set(pilares.map((p) => p.key));
  const out = [...new Set(desabilitados.filter((k) => keys.has(k)))];
  // Escolha salva inválida (todos desligados) volta a ligar todos.
  return out.length >= pilares.length ? [] : out;
}

/** Pode desligar este pilar? Nunca o último que sobrou ligado. */
export function canTurnOff(disabled: readonly string[], key: string, pilares: Pilar[]): boolean {
  if (disabled.includes(key)) return true;
  const ligados = pilares.filter((p) => !disabled.includes(p.key)).length;
  return ligados > 1;
}

/** Liga/desliga um pilar respeitando "pelo menos um ligado". */
export function togglePilar(
  disabled: readonly string[],
  key: string,
  ligado: boolean,
  pilares: Pilar[],
): string[] {
  if (ligado) return disabled.filter((k) => k !== key);
  if (disabled.includes(key) || !canTurnOff(disabled, key, pilares)) return [...disabled];
  return [...disabled, key];
}

/**
 * GET /api/execscore/pilares. Sem login a rota não responde JSON: o middleware
 * manda para a página de login. Isso vira `precisaLogin` (a tela oferece o
 * link de entrar). Qualquer outro problema conta como não elegível.
 */
export async function fetchPilares(room: string): Promise<PilaresInfo> {
  const res = await fetch(`/api/execscore/pilares?room=${encodeURIComponent(room)}`, {
    cache: 'no-store',
  });
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  if (res.redirected || !isJson) return { elegivel: false, precisaLogin: true };
  if (!res.ok) return { elegivel: false, precisaLogin: false };
  const data = await res.json();
  if (!data?.elegivel || !Array.isArray(data.pilares)) return { elegivel: false, precisaLogin: false };
  return { ...data, onboarding: data.onboarding === true, noShow: data.noShow === true } as PilaresInfo;
}

export type SaveResult = { kind: 'ok' } | { kind: 'forbidden' } | { kind: 'error'; message: string };

/**
 * Corpo do POST: com no-show ou onboarding os pilares não vão (a reunião sai
 * do ExecScore). O onboarding sempre vai, para corrigir marcação por engano.
 */
export function buildSaveBody(
  room: string,
  desabilitados: string[],
  noShow: boolean,
  onboarding: boolean,
): Record<string, unknown> {
  if (noShow) return { room, noShow: true, onboarding };
  if (onboarding) return { room, noShow: false, onboarding: true };
  return { room, noShow: false, onboarding: false, desabilitados };
}

export async function savePilares(
  room: string,
  desabilitados: string[],
  opts: { noShow?: boolean; onboarding?: boolean } = {},
): Promise<SaveResult> {
  try {
    const res = await fetch('/api/execscore/pilares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSaveBody(room, desabilitados, !!opts.noShow, !!opts.onboarding)),
    });
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    if (res.status === 403 || res.redirected) return { kind: 'forbidden' };
    if (res.ok && isJson) return { kind: 'ok' };
    const text = res.status === 400 ? (await res.text().catch(() => '')).slice(0, 200) : '';
    return { kind: 'error', message: text || 'Não foi possível salvar os pilares.' };
  } catch {
    return { kind: 'error', message: 'Erro de conexão. Verifique a internet.' };
  }
}

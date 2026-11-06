// Aviso ao app (integração ExecScore). Best-effort: qualquer falha aqui só vai
// para o log; a transcrição já está salva e o varredor do app tenta de novo.

export interface ExecScoreNotifierConfig {
  appBaseUrl?: string;
  secret?: string;
  timeoutMs?: number;
  log?: (msg: string) => void;
  fetchImpl?: typeof fetch;
}

export function createExecScoreNotifier(cfg: ExecScoreNotifierConfig) {
  const base = cfg.appBaseUrl?.replace(/\/+$/, '');
  const enabled = !!(base && cfg.secret);
  const doFetch = cfg.fetchImpl ?? fetch;
  const log = cfg.log ?? (() => {});

  async function post(path: string, body: unknown): Promise<boolean> {
    if (!enabled) return false;
    try {
      const res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Execscore-Worker-Secret': cfg.secret! },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 15000),
      });
      if (!res.ok) log(`execscore: ${path} respondeu ${res.status}`);
      return res.ok;
    } catch (e) {
      log(`execscore: falha em ${path}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  return {
    enabled,
    /** Transcrição completa gravada: o app registra e envia ao ExecScore. */
    transcriptReady: (recordingId: string) => post('/api/execscore/transcricao-pronta', { recordingId }),
    /** Varredura periódica (pilares escolhidos depois, prazo vencido, retentativas). */
    sweep: () => post('/api/execscore/varrer', {}),
  };
}

/**
 * Ciclo de conteúdo rotativo (ex.: Impulsão F1 -> F2 -> C1 -> C2).
 * conteudo(grupo, data) = sequencia[(semanas desde a âncora - semanas pausadas - defasagem) mod n]
 * Nada aqui sabe de terça, quinta ou 4 aulas: sequência, defasagem e âncora
 * vêm da configuração.
 */
import { mod, startOfWeek, weeksBetween, type Ymd } from './tempo';

export interface CicloConfig {
  /** Rótulos na ordem do ciclo, ex.: ['F1','F2','C1','C2']. */
  sequencia: readonly string[];
  /** Semanas de atraso do grupo em relação à âncora (Terça 0, Quinta 1). */
  defasagem: number;
  /** Qualquer data da semana em que o índice 0 (sem defasagem) acontece. */
  ancora: Ymd;
  /**
   * Semanas sem encontro que NÃO consomem conteúdo (política "ciclo pausa"):
   * qualquer data da semana pausada.
   */
  semanasPausadas?: readonly Ymd[];
}

/** Índice do conteúdo na semana de `data`, ou null se a semana está pausada. */
export function indiceCiclo(cfg: CicloConfig, data: Ymd): number | null {
  const n = cfg.sequencia.length;
  if (n === 0) return null;
  const w = weeksBetween(cfg.ancora, data);
  const semana = startOfWeek(data);
  const pausas = [...new Set((cfg.semanasPausadas ?? []).map(startOfWeek))];
  if (pausas.includes(semana)) return null;

  // Semanas pausadas entre a âncora e a data não consomem conteúdo.
  let ajuste = 0;
  for (const p of pausas) {
    const pw = weeksBetween(cfg.ancora, p);
    if (w >= 0 && pw >= 0 && pw < w) ajuste -= 1;
    if (w < 0 && pw < 0 && pw > w) ajuste += 1;
  }
  return mod(w + ajuste - cfg.defasagem, n);
}

/** Rótulo do conteúdo na semana de `data` (null = semana pausada). */
export function conteudo(cfg: CicloConfig, data: Ymd): string | null {
  const i = indiceCiclo(cfg, data);
  return i === null ? null : cfg.sequencia[i];
}

/** Rótulos a partir de um rótulo de entrada, na ordem do ciclo (a jornada do cliente). */
export function sequenciaAPartirDe(sequencia: readonly string[], rotulo: string, quantidade = sequencia.length): string[] {
  const i = sequencia.indexOf(rotulo);
  if (i < 0) throw new Error(`rótulo ${rotulo} não está na sequência`);
  return Array.from({ length: quantidade }, (_, k) => sequencia[(i + k) % sequencia.length]);
}

/** Rótulo pela ordem da ocorrência numa série (séries personalizadas). */
export function rotuloPorOrdem(sequencia: readonly string[], ordem: number, defasagem = 0): string | null {
  if (!sequencia.length) return null;
  return sequencia[mod(ordem - defasagem, sequencia.length)];
}

/**
 * Recorrência no padrão RRULE (RFC 5545), em hora de parede no fuso da série.
 * A biblioteca rrule gera as datas "flutuantes" (hora local guardada como se
 * fosse UTC) e aqui cada uma vira instante real com o fuso: 10h continua 10h
 * antes e depois de um horário de verão.
 *
 * Edição de série:
 * - "Somente este evento": uma Excecao (cancelada, movida ou alterada).
 * - "Este e os seguintes": dividirSerie() fecha a série antes da ocorrência e
 *   devolve uma nova a partir dela; o passado fica intacto.
 * - "Todos os eventos": altera a própria série (inicioLocal, rrule, duração).
 */
import { RRule } from 'rrule';
import { rotuloPorOrdem } from './ciclo';
import { feriadosValidos, type Feriado, type FiltroFeriados } from './feriados';
import { localToUtc, localYmd, MIN_MS, utcToLocal, type LocalDateTime } from './tempo';

export interface SerieDef {
  /** Regra sem DTSTART, ex.: 'FREQ=WEEKLY;BYDAY=TU;COUNT=12'. */
  rrule: string;
  /** Primeira ocorrência em hora local: 'YYYY-MM-DDTHH:MM'. */
  inicioLocal: string;
  fuso: string;
  duracaoMin: number;
  /** Sequência rotativa acoplada à série (ex.: F1, F2, C1, C2). */
  sequencia?: readonly string[];
  defasagem?: number;
}

export type TipoExcecao = 'cancelada' | 'movida' | 'alterada';

export interface Excecao {
  /** Identifica a ocorrência (RECURRENCE-ID), mesmo depois de movida. */
  inicioOriginal: Date;
  tipo: TipoExcecao;
  novoInicio?: Date;
  novaDuracaoMin?: number;
  rotulo?: string;
}

export type StatusOcorrencia = 'agendada' | 'movida' | 'cancelada' | 'pulada_feriado';

export interface Ocorrencia {
  inicioOriginal: Date;
  inicio: Date;
  fim: Date;
  /** Posição na série contando só as que valem (0, 1, 2...). -1 = pulada. */
  ordem: number;
  rotulo: string | null;
  status: StatusOcorrencia;
  excecao: boolean;
  feriado?: string;
}

/** Feriado na série 1 a 1: 'pular' empurra o encontro para o fim (mantém o total). */
export type PoliticaFeriadoSerie = 'manter' | 'pular' | 'cancelar';

export interface OpcoesExpansao {
  excecoes?: readonly Excecao[];
  feriados?: readonly Feriado[];
  filtroFeriados?: FiltroFeriados;
  politicaFeriado?: PoliticaFeriadoSerie;
  /** Proteção contra regra sem fim e janela enorme. */
  maxOcorrencias?: number;
}

function parseLocal(s: string): LocalDateTime {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`inicioLocal inválido: ${s} (use YYYY-MM-DDTHH:MM)`);
  return { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] };
}

const flutuante = (l: LocalDateTime) => new Date(Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute));
const deFlutuante = (d: Date): LocalDateTime => ({
  year: d.getUTCFullYear(),
  month: d.getUTCMonth() + 1,
  day: d.getUTCDate(),
  hour: d.getUTCHours(),
  minute: d.getUTCMinutes(),
});

function partes(regra: string): Map<string, string> {
  const limpa = regra.replace(/^RRULE:/i, '').trim();
  const m = new Map<string, string>();
  for (const p of limpa.split(';').filter(Boolean)) {
    const [k, v] = p.split('=');
    if (k && v !== undefined) m.set(k.toUpperCase(), v);
  }
  return m;
}

function montar(m: Map<string, string>): string {
  return [...m.entries()].map(([k, v]) => `${k}=${v}`).join(';');
}

export function contagem(regra: string): number | null {
  const c = partes(regra).get('COUNT');
  return c ? Number(c) : null;
}

function regraRRule(serie: SerieDef, semCount: boolean): RRule {
  const m = partes(serie.rrule);
  if (!m.get('FREQ')) throw new Error(`regra sem FREQ: ${serie.rrule}`);
  if (semCount) m.delete('COUNT');
  return new RRule({ ...RRule.parseString(montar(m)), dtstart: flutuante(parseLocal(serie.inicioLocal)) });
}

/**
 * Ocorrências da série cujo início cai em [de, ate). A contagem e os rótulos
 * correm desde o começo da série, então a janela não muda o rótulo.
 */
export function expandirSerie(serie: SerieDef, janela: { de: Date; ate: Date }, opts: OpcoesExpansao = {}): Ocorrencia[] {
  const max = opts.maxOcorrencias ?? 5000;
  const total = contagem(serie.rrule);
  const politica = opts.politicaFeriado ?? 'manter';
  const feriados = feriadosValidos(opts.feriados ?? [], opts.filtroFeriados);
  // Com 'pular' e COUNT, a regra roda sem COUNT e paramos ao completar o total válido.
  const estender = politica === 'pular' && total !== null;
  const regra = regraRRule(serie, estender);
  const limiteFlutuante = new Date(flutuante(utcToLocal(janela.ate, serie.fuso)).getTime() + 2 * 86_400_000);

  const excecoes = new Map((opts.excecoes ?? []).map((e) => [e.inicioOriginal.getTime(), e]));
  const out: Ocorrencia[] = [];
  let validas = 0;
  let geradas = 0;

  regra.all((d) => {
    if (d > limiteFlutuante || geradas >= max) return false;
    if (estender && validas >= total!) return false;
    geradas++;
    const inicioOriginal = localToUtc(deFlutuante(d), serie.fuso);
    const feriado = feriados.get(localYmd(inicioOriginal, serie.fuso));
    const pulada = !!feriado && politica !== 'manter';
    const ordem = pulada ? -1 : validas++;
    let oc: Ocorrencia = {
      inicioOriginal,
      inicio: inicioOriginal,
      fim: new Date(inicioOriginal.getTime() + serie.duracaoMin * MIN_MS),
      ordem,
      rotulo: pulada ? null : rotuloPorOrdem(serie.sequencia ?? [], ordem, serie.defasagem ?? 0),
      status: pulada ? (politica === 'pular' ? 'pulada_feriado' : 'cancelada') : 'agendada',
      excecao: false,
      ...(feriado ? { feriado: feriado.nome } : {}),
    };
    const ex = excecoes.get(inicioOriginal.getTime());
    if (ex) oc = aplicarExcecao(oc, ex, serie.duracaoMin);
    out.push(oc);
    return true;
  });

  return out.filter((o) => o.inicio < janela.ate && o.fim > janela.de);
}

function aplicarExcecao(oc: Ocorrencia, ex: Excecao, duracaoPadrao: number): Ocorrencia {
  const dur = (ex.novaDuracaoMin ?? (oc.fim.getTime() - oc.inicio.getTime()) / MIN_MS) || duracaoPadrao;
  if (ex.tipo === 'cancelada') return { ...oc, status: 'cancelada', excecao: true };
  const inicio = ex.tipo === 'movida' && ex.novoInicio ? ex.novoInicio : oc.inicio;
  return {
    ...oc,
    inicio,
    fim: new Date(inicio.getTime() + dur * MIN_MS),
    rotulo: ex.rotulo ?? oc.rotulo,
    status: ex.tipo === 'movida' ? 'movida' : oc.status,
    excecao: true,
  };
}

export interface Divisao {
  /** Série original encerrada antes da ocorrência (null se a divisão é na primeira). */
  anterior: SerieDef | null;
  /** Nova série a partir da ocorrência (é nela que a edição é aplicada). */
  nova: SerieDef;
  /** Quantas ocorrências válidas ficaram na série anterior. */
  ocorrenciasAntes: number;
}

/**
 * "Este e os seguintes": divide a série na ocorrência `inicioOriginal`.
 * O passado fica na série anterior (mesmo id no banco, com COUNT/UNTIL novo);
 * a nova continua a contagem e a sequência de rótulos de onde parou.
 */
export function dividirSerie(serie: SerieDef, inicioOriginal: Date, opts: OpcoesExpansao = {}): Divisao {
  const inicioSerie = localToUtc(parseLocal(serie.inicioLocal), serie.fuso);
  const antes = inicioOriginal > inicioSerie
    ? expandirSerie(serie, { de: inicioSerie, ate: inicioOriginal }, { ...opts, excecoes: [] }).filter(
        (o) => o.inicioOriginal < inicioOriginal,
      )
    : [];
  const k = antes.filter((o) => o.ordem >= 0).length;
  const local = utcToLocal(inicioOriginal, serie.fuso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const inicioLocal = `${local.year}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}`;

  const total = contagem(serie.rrule);
  const regraNova = partes(serie.rrule);
  if (total !== null) regraNova.set('COUNT', String(Math.max(total - k, 0)));

  const nova: SerieDef = {
    ...serie,
    rrule: montar(regraNova),
    inicioLocal,
    defasagem: (serie.defasagem ?? 0) - k,
  };
  if (antes.length === 0) return { anterior: null, nova, ocorrenciasAntes: 0 };

  const regraAnterior = partes(serie.rrule);
  if (total !== null) {
    regraAnterior.set('COUNT', String(k));
  } else {
    regraAnterior.delete('COUNT');
    // UNTIL em hora flutuante: 1 minuto antes da ocorrência que abre a nova série.
    const ate = new Date(flutuante(local).getTime() - MIN_MS);
    regraAnterior.set('UNTIL', ate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''));
  }
  return { anterior: { ...serie, rrule: montar(regraAnterior) }, nova, ocorrenciasAntes: k };
}

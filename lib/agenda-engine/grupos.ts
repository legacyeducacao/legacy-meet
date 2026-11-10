/**
 * Grupos com ciclo de conteúdo (Impulsão): encontros de cada grupo, entrada
 * do cliente, jornada (1/N a N/N) e efeito dos feriados.
 *
 * Política de feriado do grupo:
 * - 'pausa': a semana do feriado não tem encontro e o ciclo inteiro anda junto
 *   (o conteúdo daquela semana vai para a seguinte).
 * - 'segue': a semana é perdida e o ciclo continua no calendário; quem estava
 *   na jornada recupera a aula na próxima ocorrência dela.
 */
import { conteudo, indiceCiclo, sequenciaAPartirDe } from './ciclo';
import { feriadosValidos, type Feriado, type FiltroFeriados } from './feriados';
import { addDays, diffDays, instante, MIN_MS, weekdayIso, type Hm, type Ymd } from './tempo';

export type PoliticaFeriadoGrupo = 'pausa' | 'segue';

export interface GrupoConfig {
  id: string;
  nome: string;
  /** 1 = segunda ... 7 = domingo. */
  diaSemana: number;
  hora: Hm;
  duracaoMin: number;
  fuso: string;
  sequencia: readonly string[];
  defasagem: number;
  ancora: Ymd;
  politicaFeriado: PoliticaFeriadoGrupo;
  /** Rótulos em que um cliente novo pode entrar (ex.: ['F1','C1']). */
  entradasPermitidas: readonly string[];
  /** Primeiro e último dia em que o grupo existe (opcional). */
  inicio?: Ymd;
  fim?: Ymd;
}

export type StatusOcorrenciaGrupo = 'normal' | 'pausada_feriado' | 'perdida_feriado';

export interface OcorrenciaGrupo {
  grupoId: string;
  data: Ymd;
  inicio: Date;
  fim: Date;
  /** Conteúdo da semana (na política 'segue', o conteúdo que foi perdido). */
  rotulo: string | null;
  status: StatusOcorrenciaGrupo;
  feriado?: string;
}

/** Primeira data >= `de` que cai no dia da semana. */
export function proximoDiaSemana(de: Ymd, diaSemana: number): Ymd {
  return addDays(de, (diaSemana - weekdayIso(de) + 7) % 7);
}

function semanasPausadas(g: GrupoConfig, feriados: Map<Ymd, Feriado>): Ymd[] {
  if (g.politicaFeriado !== 'pausa') return [];
  return [...feriados.keys()].filter((d) => weekdayIso(d) === g.diaSemana);
}

/** Encontros do grupo entre `de` e `ate` (inclusive), já com rótulo e feriados. */
export function ocorrenciasDoGrupo(
  g: GrupoConfig,
  de: Ymd,
  ate: Ymd,
  feriados: readonly Feriado[] = [],
  filtro: FiltroFeriados = {},
): OcorrenciaGrupo[] {
  const mapa = feriadosValidos(feriados, filtro);
  const ciclo = { sequencia: g.sequencia, defasagem: g.defasagem, ancora: g.ancora, semanasPausadas: semanasPausadas(g, mapa) };
  const out: OcorrenciaGrupo[] = [];
  const primeiro = proximoDiaSemana(g.inicio && diffDays(de, g.inicio) > 0 ? g.inicio : de, g.diaSemana);
  for (let d = primeiro; diffDays(d, ate) >= 0; d = addDays(d, 7)) {
    if (g.fim && diffDays(g.fim, d) > 0) break;
    const inicio = instante(d, g.hora, g.fuso);
    const fim = new Date(inicio.getTime() + g.duracaoMin * MIN_MS);
    const feriado = mapa.get(d);
    if (feriado && g.politicaFeriado === 'pausa') {
      out.push({ grupoId: g.id, data: d, inicio, fim, rotulo: null, status: 'pausada_feriado', feriado: feriado.nome });
      continue;
    }
    const rotulo = conteudo(ciclo, d);
    out.push({
      grupoId: g.id,
      data: d,
      inicio,
      fim,
      rotulo,
      status: feriado ? 'perdida_feriado' : 'normal',
      ...(feriado ? { feriado: feriado.nome } : {}),
    });
  }
  return out;
}

/** Índice do ciclo do grupo na data (útil para testes e para a tela). */
export function indiceDoGrupo(g: GrupoConfig, data: Ymd, feriados: readonly Feriado[] = []): number | null {
  const mapa = feriadosValidos(feriados);
  return indiceCiclo({ sequencia: g.sequencia, defasagem: g.defasagem, ancora: g.ancora, semanasPausadas: semanasPausadas(g, mapa) }, data);
}

export interface SugestaoEntrada {
  grupoId: string;
  data: Ymd;
  inicio: Date;
  rotulo: string;
  /** Dias de espera a partir de `aPartirDe`. */
  esperaDias: number;
}

/**
 * Data de entrada de um cliente novo: o encontro mais cedo (a partir de
 * `aPartirDe`) que seja uma entrada permitida (Aula 1). Com `diaSemana` ou
 * `grupoId`, só naquele dia/grupo.
 */
export function sugerirEntrada(
  grupos: readonly GrupoConfig[],
  aPartirDe: Ymd,
  feriados: readonly Feriado[] = [],
  opts: { diaSemana?: number; grupoId?: string; limiteSemanas?: number } = {},
): SugestaoEntrada | null {
  const ate = addDays(aPartirDe, 7 * (opts.limiteSemanas ?? 12));
  let melhor: SugestaoEntrada | null = null;
  for (const g of grupos) {
    if (opts.grupoId && g.id !== opts.grupoId) continue;
    if (opts.diaSemana && g.diaSemana !== opts.diaSemana) continue;
    const o = ocorrenciasDoGrupo(g, aPartirDe, ate, feriados).find(
      (x) => x.status === 'normal' && x.rotulo && g.entradasPermitidas.includes(x.rotulo),
    );
    if (o && (!melhor || o.inicio < melhor.inicio)) {
      melhor = { grupoId: g.id, data: o.data, inicio: o.inicio, rotulo: o.rotulo!, esperaDias: diffDays(aPartirDe, o.data) };
    }
  }
  return melhor;
}

export interface EncontroJornada {
  numero: number;
  rotulo: string;
  grupoId: string;
  data: Ymd;
  inicio: Date;
  fim: Date;
  /** Aula recuperada fora da sequência normal do grupo (feriado com 'segue'). */
  recuperacao: boolean;
}

export interface Jornada {
  grupoInicialId: string;
  encontros: EncontroJornada[];
  /** Rótulos que não couberam no horizonte (não deveria acontecer). */
  pendentes: string[];
  conclusao: Ymd | null;
}

/**
 * Jornada do cliente a partir do encontro de entrada: os N encontros na ordem
 * do ciclo. No fluxo normal são N semanas seguidas no mesmo grupo. Se uma
 * aula foi perdida (feriado com 'segue'), ela é recuperada na próxima
 * ocorrência daquele conteúdo; com `recuperarEmOutroGrupo`, pode ser em outro
 * grupo (o cliente segue nele).
 */
export function gerarJornada(
  grupos: readonly GrupoConfig[],
  grupoId: string,
  dataEntrada: Ymd,
  feriados: readonly Feriado[] = [],
  opts: { encontros?: number; recuperarEmOutroGrupo?: boolean; limiteSemanas?: number } = {},
): Jornada {
  const inicial = grupos.find((g) => g.id === grupoId);
  if (!inicial) throw new Error(`grupo ${grupoId} não existe`);
  const ate = addDays(dataEntrada, 7 * (opts.limiteSemanas ?? 26));
  const porGrupo = new Map(grupos.map((g) => [g.id, ocorrenciasDoGrupo(g, dataEntrada, ate, feriados)]));

  const entrada = porGrupo.get(grupoId)!.find((o) => o.data === dataEntrada);
  if (!entrada || entrada.status !== 'normal' || !entrada.rotulo) {
    throw new Error(`o grupo ${inicial.nome} não tem encontro em ${dataEntrada}`);
  }
  if (!inicial.entradasPermitidas.includes(entrada.rotulo)) {
    throw new Error(`não é possível entrar em ${entrada.rotulo}; entradas permitidas: ${inicial.entradasPermitidas.join(', ')}`);
  }

  const rotulos = sequenciaAPartirDe(inicial.sequencia, entrada.rotulo, opts.encontros ?? inicial.sequencia.length);
  const encontros: EncontroJornada[] = [];
  const pendentes: string[] = [];
  let grupoAtual = grupoId;
  let depoisDe = entrada.inicio.getTime() - 1;

  rotulos.forEach((rotulo, k) => {
    const elegiveis = (gid: string) =>
      porGrupo.get(gid)!.filter((o) => o.status === 'normal' && o.rotulo === rotulo && o.inicio.getTime() > depoisDe);
    // Próximo encontro normal do grupo atual: se for este conteúdo, é a sequência normal.
    const proximoDoGrupo = porGrupo.get(grupoAtual)!.find((o) => o.inicio.getTime() > depoisDe && o.status !== 'pausada_feriado');
    let escolhido: OcorrenciaGrupo | undefined;
    let recuperacao = false;
    if (proximoDoGrupo && proximoDoGrupo.status === 'normal' && proximoDoGrupo.rotulo === rotulo) {
      escolhido = proximoDoGrupo;
    } else {
      recuperacao = true;
      const candidatos = (opts.recuperarEmOutroGrupo ?? true ? grupos.map((g) => g.id) : [grupoAtual])
        .flatMap(elegiveis)
        .sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || (a.grupoId === grupoAtual ? -1 : 1));
      escolhido = candidatos[0];
    }
    if (!escolhido) {
      pendentes.push(rotulo);
      return;
    }
    encontros.push({
      numero: k + 1,
      rotulo,
      grupoId: escolhido.grupoId,
      data: escolhido.data,
      inicio: escolhido.inicio,
      fim: escolhido.fim,
      recuperacao: k > 0 && recuperacao,
    });
    grupoAtual = escolhido.grupoId;
    depoisDe = escolhido.inicio.getTime();
  });

  return {
    grupoInicialId: grupoId,
    encontros,
    pendentes,
    conclusao: pendentes.length ? null : encontros[encontros.length - 1]?.data ?? null,
  };
}

export interface ProgressoJornada {
  /** Encontros já acontecidos (até `agora`). */
  realizados: number;
  total: number;
  /** Texto "2/4". */
  rotulo: string;
  proximo: EncontroJornada | null;
  conclusao: Ymd | null;
  concluida: boolean;
}

export function progressoJornada(j: Jornada, agora: Date): ProgressoJornada {
  const total = j.encontros.length + j.pendentes.length;
  const realizados = j.encontros.filter((e) => e.fim.getTime() <= agora.getTime()).length;
  return {
    realizados,
    total,
    rotulo: `${realizados}/${total}`,
    proximo: j.encontros.find((e) => e.fim.getTime() > agora.getTime()) ?? null,
    conclusao: j.conclusao,
    concluida: realizados === total && total > 0,
  };
}

export interface ImpactoFeriado {
  grupoId: string;
  data: Ymd;
  antes: { rotulo: string | null; status: StatusOcorrenciaGrupo } | null;
  depois: { rotulo: string | null; status: StatusOcorrenciaGrupo } | null;
}

/**
 * Prévia do que muda nos grupos se um feriado for cadastrado: cada encontro
 * cujo conteúdo ou status mudaria, entre `de` e `ate`.
 */
export function previaImpactoFeriado(
  grupos: readonly GrupoConfig[],
  novo: Feriado,
  feriadosAtuais: readonly Feriado[],
  de: Ymd,
  ate: Ymd,
): ImpactoFeriado[] {
  const out: ImpactoFeriado[] = [];
  for (const g of grupos) {
    const antes = ocorrenciasDoGrupo(g, de, ate, feriadosAtuais);
    const depois = ocorrenciasDoGrupo(g, de, ate, [...feriadosAtuais, novo]);
    const porData = new Map(antes.map((o) => [o.data, o]));
    for (const o of depois) {
      const a = porData.get(o.data);
      if (!a || a.rotulo !== o.rotulo || a.status !== o.status) {
        out.push({
          grupoId: g.id,
          data: o.data,
          antes: a ? { rotulo: a.rotulo, status: a.status } : null,
          depois: { rotulo: o.rotulo, status: o.status },
        });
      }
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

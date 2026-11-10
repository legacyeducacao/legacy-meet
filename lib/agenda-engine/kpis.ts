/**
 * KPIs de horas e agenda. Hora realizada = duração real da gravação (não o
 * horário agendado nem started/ended da sala, que ficam abertos à toa).
 */
import { blocosDeFoco, horasDisponiveis, type ContextoAgenda } from './disponibilidade';
import { expedienteDoDia } from './disponibilidade';
import { addDays, diffDays, HORA_MS, localYmd, startOfWeek, subtractIv, totalMs, utcToLocal, type Iv, type Ymd } from './tempo';

export type StatusReuniao = 'agendada' | 'realizada' | 'no_show' | 'cancelada';
export type Origem = 'cliente' | 'executor' | 'legacy';

export interface ReuniaoKpi {
  id: string;
  produto: string; // 'impulsao' | 'legado' | 'outro'...
  inicio: Date;
  fim: Date;
  status: StatusReuniao;
  origemCancelamento?: Origem | null;
  /** A reunião foi remarcada (movida) e por quem. */
  remarcadaPor?: Origem | null;
}

export interface GravacaoKpi {
  reuniaoId: string;
  inicio: Date;
  duracaoSeg: number;
}

export interface Periodo {
  de: Ymd;
  ate: Ymd;
}

export interface ResultadoKpis {
  horasDisponiveis: number;
  horasAgendadas: number;
  horasRealizadas: number;
  /** agendadas / disponíveis */
  taxaOcupacao: number | null;
  /** realizadas / agendadas */
  taxaRealizacao: number | null;
  horasPorProduto: Record<string, number>;
  /** duração real média / duração planejada média (mesmas reuniões) */
  aderenciaDuracao: number | null;
  noShow: { total: number; taxa: number | null };
  cancelamentos: { total: number; taxa: number | null; porOrigem: Record<string, number> };
  remarcacoes: { total: number; taxa: number | null; porOrigem: Record<string, number> };
  horasForaExpediente: number;
  tempoFoco: { blocos: number; horas: number };
  cargaSemanal: Array<{ semana: Ymd; horas: number; acimaLimite: boolean }>;
  /** Contagens brutas (para somar vários executores na visão do gestor). */
  contagens: { validas: number; doPeriodo: number; comGravacao: number; planejadoComGravacaoH: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const div = (a: number, b: number) => (b > 0 ? r2(a / b) : null);
const horasDe = (ms: number) => r2(ms / HORA_MS);
const contar = (lista: readonly (string | null | undefined)[]) =>
  lista.reduce<Record<string, number>>((acc, k) => {
    const chave = k ?? 'nao_informado';
    acc[chave] = (acc[chave] ?? 0) + 1;
    return acc;
  }, {});

export function calcularKpis(
  periodo: Periodo,
  ctx: Omit<ContextoAgenda, 'eventos'>,
  reunioes: readonly ReuniaoKpi[],
  gravacoes: readonly GravacaoKpi[],
): ResultadoKpis {
  const noPeriodo = (d: Date) => {
    const dia = localYmd(d, ctx.fuso);
    return diffDays(periodo.de, dia) >= 0 && diffDays(dia, periodo.ate) >= 0;
  };
  const doPeriodo = reunioes.filter((r) => noPeriodo(r.inicio));
  const validas = doPeriodo.filter((r) => r.status !== 'cancelada');
  const planejadoMs = (r: ReuniaoKpi) => r.fim.getTime() - r.inicio.getTime();

  const porReuniao = new Map(doPeriodo.map((r) => [r.id, r]));
  const realPorReuniao = new Map<string, number>();
  const intervalosReais: Iv[] = [];
  for (const g of gravacoes) {
    if (!porReuniao.has(g.reuniaoId)) continue;
    realPorReuniao.set(g.reuniaoId, (realPorReuniao.get(g.reuniaoId) ?? 0) + g.duracaoSeg * 1000);
    intervalosReais.push([g.inicio.getTime(), g.inicio.getTime() + g.duracaoSeg * 1000]);
  }

  const agendadasMs = validas.reduce((t, r) => t + planejadoMs(r), 0);
  const realizadasMs = [...realPorReuniao.values()].reduce((t, v) => t + v, 0);
  const disponiveis = horasDisponiveis({ ...ctx, eventos: [] }, periodo.de, periodo.ate);

  const horasPorProduto: Record<string, number> = {};
  for (const [id, ms] of realPorReuniao) {
    const p = porReuniao.get(id)!.produto;
    horasPorProduto[p] = horasDe((horasPorProduto[p] ?? 0) * HORA_MS + ms);
  }

  const comGravacao = [...realPorReuniao.keys()].map((id) => porReuniao.get(id)!);
  const mediaReal = comGravacao.length ? realizadasMs / comGravacao.length : 0;
  const mediaPlanejada = comGravacao.length ? comGravacao.reduce((t, r) => t + planejadoMs(r), 0) / comGravacao.length : 0;

  // Fora do expediente: parte das gravações que cai fora das faixas cadastradas.
  const dias = new Set(intervalosReais.flatMap(([a, b]) => [localYmd(new Date(a), ctx.fuso), localYmd(new Date(b), ctx.fuso)]));
  const expediente = [...dias].flatMap((d) => expedienteDoDia(ctx.expediente, d, ctx.fuso));
  const foraMs = totalMs(subtractIv(intervalosReais, expediente));

  const foco = blocosDeFoco(
    { ...ctx, eventos: validas.map((r) => ({ id: r.id, inicio: r.inicio, fim: r.fim })) },
    periodo.de,
    periodo.ate,
  );

  const semanas = new Map<Ymd, number>();
  for (const r of validas) {
    const w = startOfWeek(localYmd(r.inicio, ctx.fuso));
    semanas.set(w, (semanas.get(w) ?? 0) + planejadoMs(r));
  }

  const noShow = validas.filter((r) => r.status === 'no_show').length;
  const canceladas = doPeriodo.filter((r) => r.status === 'cancelada');
  const remarcadas = doPeriodo.filter((r) => r.remarcadaPor);

  return {
    horasDisponiveis: r2(disponiveis),
    horasAgendadas: horasDe(agendadasMs),
    horasRealizadas: horasDe(realizadasMs),
    taxaOcupacao: div(agendadasMs / HORA_MS, disponiveis),
    taxaRealizacao: div(realizadasMs, agendadasMs),
    horasPorProduto,
    aderenciaDuracao: div(mediaReal, mediaPlanejada),
    noShow: { total: noShow, taxa: div(noShow, validas.length) },
    cancelamentos: {
      total: canceladas.length,
      taxa: div(canceladas.length, doPeriodo.length),
      porOrigem: contar(canceladas.map((r) => r.origemCancelamento)),
    },
    remarcacoes: {
      total: remarcadas.length,
      taxa: div(remarcadas.length, validas.length),
      porOrigem: contar(remarcadas.map((r) => r.remarcadaPor)),
    },
    horasForaExpediente: horasDe(foraMs),
    tempoFoco: { blocos: foco.length, horas: horasDe(totalMs(foco)) },
    contagens: {
      validas: validas.length,
      doPeriodo: doPeriodo.length,
      comGravacao: comGravacao.length,
      planejadoComGravacaoH: horasDe(comGravacao.reduce((t, r) => t + planejadoMs(r), 0)),
    },
    cargaSemanal: [...semanas.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([semana, ms]) => ({
        semana,
        horas: horasDe(ms),
        acimaLimite: !!ctx.regras.maxHorasSemana && ms > ctx.regras.maxHorasSemana * HORA_MS,
      })),
  };
}

/** Período do mesmo tamanho imediatamente antes (comparativo dos cards). */
export function periodoAnterior(p: Periodo): Periodo {
  const dias = diffDays(p.de, p.ate) + 1;
  return { de: addDays(p.de, -dias), ate: addDays(p.de, -1) };
}

/** Variação relativa (0.25 = +25%); null quando não há base. */
export function variacao(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior === 0) return null;
  return r2((atual - anterior) / anterior);
}

// ------------------------------ Jornadas ------------------------------

export type Presenca = 'pendente' | 'presente' | 'faltou';

export interface JornadaImpulsaoKpi {
  clienteId: string;
  grupoId: string;
  status: 'ativa' | 'concluida' | 'pausada' | 'cancelada';
  encontros: Array<{ numero: number; rotulo: string; presenca: Presenca }>;
}

export function kpisJornadasImpulsao(jornadas: readonly JornadaImpulsaoKpi[], rotulosAula2: readonly string[]) {
  const ativas = jornadas.filter((j) => j.status === 'ativa');
  const ativosPorGrupo = contar(ativas.map((j) => j.grupoId));
  const progresso = ativas.map((j) => ({
    clienteId: j.clienteId,
    concluidos: j.encontros.filter((e) => e.presenca === 'presente').length,
    total: j.encontros.length,
  }));
  const faltaramAula2 = jornadas
    .filter((j) => j.encontros.some((e) => rotulosAula2.includes(e.rotulo) && e.presenca === 'faltou'))
    .map((j) => j.clienteId);
  return { ativosPorGrupo, progresso, faltaramAula2 };
}

export interface JornadaLegadoKpi {
  clienteId: string;
  inicio: Ymd;
  fim: Ymd;
  previstos: number;
  realizados: number;
}

/**
 * Jornada do Legado em risco: os encontros que faltam não cabem no tempo que
 * resta na cadência (ex.: faltam 2 semanas e ainda há 3 encontros pendentes).
 */
export function riscoJornadaLegado(j: JornadaLegadoKpi, hoje: Ymd, intervaloDias = 7, encontrosFuturos?: number) {
  const pendentes = Math.max(j.previstos - j.realizados, 0);
  const diasRestantes = Math.max(diffDays(hoje, j.fim), 0);
  // Com a agenda em mãos, o que cabe são os encontros ainda marcados; sem ela, estima pela cadência.
  const possiveis = encontrosFuturos ?? Math.floor(diasRestantes / intervaloDias);
  return {
    clienteId: j.clienteId,
    pendentes,
    diasRestantes,
    possiveis,
    emRisco: pendentes > 0 && pendentes > possiveis,
    taxa: div(j.realizados, j.previstos),
  };
}

// ------------------------------ Gestor e gráficos ------------------------------

const somaMapa = (lista: Array<Record<string, number>>) =>
  lista.reduce<Record<string, number>>((acc, m) => {
    for (const [k, v] of Object.entries(m)) acc[k] = r2((acc[k] ?? 0) + v);
    return acc;
  }, {});

/** Soma os KPIs de vários executores e recalcula as taxas pelos totais. */
export function somarKpis(lista: readonly ResultadoKpis[]): ResultadoKpis {
  const soma = (f: (k: ResultadoKpis) => number) => r2(lista.reduce((t, k) => t + f(k), 0));
  const disponiveis = soma((k) => k.horasDisponiveis);
  const agendadas = soma((k) => k.horasAgendadas);
  const realizadas = soma((k) => k.horasRealizadas);
  const validas = soma((k) => k.contagens.validas);
  const doPeriodo = soma((k) => k.contagens.doPeriodo);
  const comGravacao = soma((k) => k.contagens.comGravacao);
  const planejadoComGravacao = soma((k) => k.contagens.planejadoComGravacaoH);
  const noShow = soma((k) => k.noShow.total);
  const cancel = soma((k) => k.cancelamentos.total);
  const remarc = soma((k) => k.remarcacoes.total);
  const semanas = new Map<Ymd, number>();
  for (const k of lista) for (const c of k.cargaSemanal) semanas.set(c.semana, r2((semanas.get(c.semana) ?? 0) + c.horas));
  return {
    horasDisponiveis: disponiveis,
    horasAgendadas: agendadas,
    horasRealizadas: realizadas,
    taxaOcupacao: div(agendadas, disponiveis),
    taxaRealizacao: div(realizadas, agendadas),
    horasPorProduto: somaMapa(lista.map((k) => k.horasPorProduto)),
    aderenciaDuracao: comGravacao ? div(realizadas / comGravacao, planejadoComGravacao / comGravacao) : null,
    noShow: { total: noShow, taxa: div(noShow, validas) },
    cancelamentos: { total: cancel, taxa: div(cancel, doPeriodo), porOrigem: somaMapa(lista.map((k) => k.cancelamentos.porOrigem)) },
    remarcacoes: { total: remarc, taxa: div(remarc, validas), porOrigem: somaMapa(lista.map((k) => k.remarcacoes.porOrigem)) },
    horasForaExpediente: soma((k) => k.horasForaExpediente),
    tempoFoco: { blocos: soma((k) => k.tempoFoco.blocos), horas: soma((k) => k.tempoFoco.horas) },
    // No total da equipe o limite semanal é por pessoa: o alerta fica na visão individual.
    cargaSemanal: [...semanas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, horas]) => ({ semana, horas, acimaLimite: false })),
    contagens: { validas, doPeriodo, comGravacao, planejadoComGravacaoH: planejadoComGravacao },
  };
}

/** Horas agendadas (planejadas, sem canceladas) x realizadas (gravação) por semana. */
export function horasPorSemana(
  reunioes: readonly ReuniaoKpi[],
  gravacoes: readonly GravacaoKpi[],
  fuso: string,
): Array<{ semana: Ymd; agendadas: number; realizadas: number }> {
  const m = new Map<Ymd, { a: number; r: number }>();
  const pega = (d: Date) => {
    const w = startOfWeek(localYmd(d, fuso));
    if (!m.has(w)) m.set(w, { a: 0, r: 0 });
    return m.get(w)!;
  };
  for (const r of reunioes) if (r.status !== 'cancelada') pega(r.inicio).a += r.fim.getTime() - r.inicio.getTime();
  // A hora realizada conta na semana da reunião (a gravação pode ter outra data
  // quando a sala foi reaproveitada).
  const inicioDe = new Map(reunioes.map((r) => [r.id, r.inicio]));
  for (const g of gravacoes) {
    const ini = inicioDe.get(g.reuniaoId);
    if (ini) pega(ini).r += g.duracaoSeg * 1000;
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, v]) => ({ semana, agendadas: horasDe(v.a), realizadas: horasDe(v.r) }));
}

/**
 * Mapa de calor: horas de reunião (sem canceladas) por dia da semana (1 a 7)
 * e hora do dia (0 a 23), no fuso. Reunião que atravessa a hora é dividida.
 */
export function mapaOcupacao(reunioes: readonly ReuniaoKpi[], fuso: string): number[][] {
  const mapa = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const r of reunioes) {
    if (r.status === 'cancelada') continue;
    let t = r.inicio.getTime();
    const fim = r.fim.getTime();
    while (t < fim) {
      const l = utcToLocal(new Date(t), fuso);
      const proxHora = t + (60 - l.minute) * 60_000 - l.second * 1000;
      const ate = Math.min(fim, proxHora);
      const dia = new Date(Date.UTC(l.year, l.month - 1, l.day)).getUTCDay();
      mapa[dia === 0 ? 6 : dia - 1][l.hour] += (ate - t) / HORA_MS;
      t = ate;
    }
  }
  return mapa.map((linha) => linha.map(r2));
}

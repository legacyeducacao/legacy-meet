/**
 * Disponibilidade do executor e validação de conflitos.
 * Expediente em hora local por dia da semana (várias faixas por dia),
 * bloqueios já expandidos em instantes, buffer, limites e feriados.
 */
import { feriadosValidos, type Feriado, type FiltroFeriados } from './feriados';
import {
  addDays,
  eachDay,
  HORA_MS,
  instante,
  localYmd,
  MIN_MS,
  mergeIv,
  overlaps,
  startOfWeek,
  subtractIv,
  totalMs,
  weekdayIso,
  type Hm,
  type Iv,
  type Ymd,
} from './tempo';

export interface FaixaExpediente {
  /** 1 = segunda ... 7 = domingo. */
  diaSemana: number;
  inicio: Hm;
  fim: Hm;
}

export interface Bloqueio {
  id: string;
  inicio: Date;
  fim: Date;
  /** Privado: o motor não expõe; a tela decide quem vê. */
  motivo?: string;
}

export interface EventoAgenda {
  id: string;
  inicio: Date;
  fim: Date;
  titulo?: string;
}

export type TipoConflito =
  | 'sobreposicao'
  | 'bloqueio'
  | 'feriado'
  | 'fora_expediente'
  | 'buffer'
  | 'preparo'
  | 'limite_reunioes_dia'
  | 'limite_horas_dia'
  | 'limite_horas_semana';

export type NivelRegra = 'bloqueante' | 'aviso';

/** Níveis padrão; o admin pode mudar cada um. */
export const NIVEIS_PADRAO: Record<TipoConflito, NivelRegra> = {
  sobreposicao: 'bloqueante',
  bloqueio: 'bloqueante',
  feriado: 'aviso',
  fora_expediente: 'aviso',
  buffer: 'aviso',
  preparo: 'aviso',
  limite_reunioes_dia: 'aviso',
  limite_horas_dia: 'aviso',
  limite_horas_semana: 'aviso',
};

export interface RegrasExecutor {
  bufferMin: number;
  maxReunioesDia?: number | null;
  maxHorasDia?: number | null;
  maxHorasSemana?: number | null;
  niveis?: Partial<Record<TipoConflito, NivelRegra>>;
}

/** Valores padrão adotados (configuráveis pelo admin). */
export const REGRAS_PADRAO: RegrasExecutor = {
  bufferMin: 15,
  maxReunioesDia: 8,
  maxHorasDia: 6,
  maxHorasSemana: 30,
};

export const EXPEDIENTE_PADRAO: FaixaExpediente[] = [1, 2, 3, 4, 5].flatMap((d) => [
  { diaSemana: d, inicio: '08:00', fim: '12:00' },
  { diaSemana: d, inicio: '13:00', fim: '18:00' },
]);

export interface ContextoAgenda {
  fuso: string;
  expediente: readonly FaixaExpediente[];
  bloqueios: readonly Bloqueio[];
  eventos: readonly EventoAgenda[];
  feriados?: readonly Feriado[];
  filtroFeriados?: FiltroFeriados;
  regras: RegrasExecutor;
}

export interface Candidata {
  ref: string;
  inicio: Date;
  fim: Date;
  /** Minutos livres exigidos antes (preparo do produto). */
  preparoMin?: number;
  /** Encontro de grupo: conflito com bloqueio exige substituto. */
  grupo?: boolean;
  /** Evento já existente que está sendo movido (não conflita consigo mesmo). */
  substituiEventoId?: string;
}

export type AcaoSugerida = 'mover' | 'pular' | 'manter' | 'substituto';

export interface Conflito {
  ref: string;
  inicio: Date;
  tipo: TipoConflito;
  nivel: NivelRegra;
  detalhe: string;
  acaoSugerida: AcaoSugerida;
  /** Evento ou bloqueio envolvido (o motivo do bloqueio não sai daqui). */
  com?: string;
  /** Próximo horário livre sugerido, quando a ação é mover. */
  sugestao?: Date;
}

/** Faixas de expediente de um dia, em instantes. */
export function expedienteDoDia(expediente: readonly FaixaExpediente[], data: Ymd, fuso: string): Iv[] {
  return mergeIv(
    expediente
      .filter((f) => f.diaSemana === weekdayIso(data))
      .map((f) => [instante(data, f.inicio, fuso).getTime(), instante(data, f.fim, fuso).getTime()] as Iv),
  );
}

const iv = (e: { inicio: Date; fim: Date }): Iv => [e.inicio.getTime(), e.fim.getTime()];
const horas = (ms: number) => Math.round((ms / HORA_MS) * 100) / 100;

/**
 * Valida as candidatas (ex.: todas as ocorrências futuras de uma série) contra
 * a agenda. Devolve um conflito por regra violada, com nível e ação sugerida.
 */
export function validarConflitos(candidatas: readonly Candidata[], ctx: ContextoAgenda): Conflito[] {
  const niveis = { ...NIVEIS_PADRAO, ...(ctx.regras.niveis ?? {}) };
  const feriados = feriadosValidos(ctx.feriados ?? [], ctx.filtroFeriados);
  const substituidos = new Set(candidatas.map((c) => c.substituiEventoId).filter(Boolean));
  const existentes = ctx.eventos.filter((e) => !substituidos.has(e.id));
  const out: Conflito[] = [];
  const add = (c: Candidata, tipo: TipoConflito, detalhe: string, com?: string, acao?: AcaoSugerida) => {
    const nivel = niveis[tipo];
    out.push({
      ref: c.ref,
      inicio: c.inicio,
      tipo,
      nivel,
      detalhe,
      acaoSugerida: acao ?? (nivel === 'bloqueante' ? 'mover' : 'manter'),
      ...(com ? { com } : {}),
    });
  };

  // Tudo que ocupa a agenda: o que já existe + as candidatas (uma série pode conflitar consigo).
  const ocupacao = [
    ...existentes.map((e) => ({ id: e.id, inicio: e.inicio, fim: e.fim, titulo: e.titulo, candidata: false })),
    ...candidatas.map((c) => ({ id: c.ref, inicio: c.inicio, fim: c.fim, titulo: undefined, candidata: true })),
  ];

  for (const c of candidatas) {
    const dia = localYmd(c.inicio, ctx.fuso);
    const civ = iv(c);

    const feriado = feriados.get(dia);
    if (feriado) add(c, 'feriado', `Feriado: ${feriado.nome}`, undefined, niveis.feriado === 'bloqueante' ? 'pular' : 'manter');

    const exp = expedienteDoDia(ctx.expediente, dia, ctx.fuso);
    if (!exp.some(([a, b]) => civ[0] >= a && civ[1] <= b)) add(c, 'fora_expediente', 'Fora do expediente cadastrado');

    for (const b of ctx.bloqueios) {
      if (overlaps(civ, iv(b))) {
        if (c.grupo) {
          out.push({ ref: c.ref, inicio: c.inicio, tipo: 'bloqueio', nivel: 'bloqueante', detalhe: 'Encontro de grupo em horário bloqueado: indique um substituto ou aplique a política de cancelamento', acaoSugerida: 'substituto', com: b.id });
        } else add(c, 'bloqueio', 'Horário bloqueado (Indisponível)', b.id);
      }
    }

    for (const o of ocupacao) {
      if (o.id === c.ref) continue;
      const oiv = iv(o);
      if (overlaps(civ, oiv)) {
        add(c, 'sobreposicao', `Sobrepõe ${o.titulo ? `"${o.titulo}"` : 'outra reunião'}`, o.id);
        continue;
      }
      const gapAntes = civ[0] - oiv[1];
      const gapDepois = oiv[0] - civ[1];
      const buffer = ctx.regras.bufferMin * MIN_MS;
      if ((gapAntes >= 0 && gapAntes < buffer) || (gapDepois >= 0 && gapDepois < buffer)) {
        add(c, 'buffer', `Menos de ${ctx.regras.bufferMin} min de intervalo`, o.id);
      }
      if (c.preparoMin && gapAntes >= 0 && gapAntes < c.preparoMin * MIN_MS) {
        add(c, 'preparo', `Menos de ${c.preparoMin} min de preparo antes`, o.id);
      }
    }
  }

  // Limites por dia e por semana, contando o que existe + as candidatas.
  const porDia = new Map<Ymd, { qtd: number; ms: number }>();
  const porSemana = new Map<Ymd, number>();
  for (const o of ocupacao) {
    const d = localYmd(o.inicio, ctx.fuso);
    const ms = o.fim.getTime() - o.inicio.getTime();
    const cur = porDia.get(d) ?? { qtd: 0, ms: 0 };
    porDia.set(d, { qtd: cur.qtd + 1, ms: cur.ms + ms });
    const w = startOfWeek(d);
    porSemana.set(w, (porSemana.get(w) ?? 0) + ms);
  }
  const { maxReunioesDia, maxHorasDia, maxHorasSemana } = ctx.regras;
  for (const c of candidatas) {
    const d = localYmd(c.inicio, ctx.fuso);
    const dia = porDia.get(d)!;
    if (maxReunioesDia && dia.qtd > maxReunioesDia) add(c, 'limite_reunioes_dia', `${dia.qtd} reuniões no dia (limite ${maxReunioesDia})`);
    if (maxHorasDia && dia.ms > maxHorasDia * HORA_MS) add(c, 'limite_horas_dia', `${horas(dia.ms)} h no dia (limite ${maxHorasDia} h)`);
    const sem = porSemana.get(startOfWeek(d))!;
    if (maxHorasSemana && sem > maxHorasSemana * HORA_MS) add(c, 'limite_horas_semana', `${horas(sem)} h na semana (limite ${maxHorasSemana} h)`);
  }

  // Sugestão de horário para o que precisa mudar.
  for (const conf of out) {
    if (conf.acaoSugerida !== 'mover') continue;
    const c = candidatas.find((x) => x.ref === conf.ref)!;
    const dur = (c.fim.getTime() - c.inicio.getTime()) / MIN_MS;
    const outrasCandidatas = candidatas.filter((x) => x.ref !== c.ref).map((x) => ({ id: x.ref, inicio: x.inicio, fim: x.fim }));
    const [livre] = horariosLivres({ ...ctx, eventos: [...existentes, ...outrasCandidatas] }, c.inicio, addMs(c.inicio, 14 * 24 * HORA_MS), dur, { limite: 1 });
    if (livre) conf.sugestao = livre;
  }
  return out;
}

const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms);

/** Conflito impede salvar? (algum bloqueante sem passar por cima) */
export function temBloqueante(conflitos: readonly Conflito[]): boolean {
  return conflitos.some((c) => c.nivel === 'bloqueante');
}

/** Reuniões já marcadas que um bloqueio novo atinge. */
export function reunioesAfetadas(bloqueio: Pick<Bloqueio, 'inicio' | 'fim'>, eventos: readonly EventoAgenda[]): EventoAgenda[] {
  return eventos.filter((e) => overlaps(iv(e), iv(bloqueio)));
}

/** Tempo livre do dia (expediente - reuniões com buffer - bloqueios). */
export function livreDoDia(ctx: ContextoAgenda, data: Ymd): Iv[] {
  const buffer = ctx.regras.bufferMin * MIN_MS;
  const ocupado = [
    ...ctx.eventos.map((e) => [e.inicio.getTime() - buffer, e.fim.getTime() + buffer] as Iv),
    ...ctx.bloqueios.map(iv),
  ];
  return subtractIv(expedienteDoDia(ctx.expediente, data, ctx.fuso), ocupado);
}

/**
 * Próximos horários livres para uma reunião de `duracaoMin` (Legado),
 * respeitando expediente, bloqueios, buffer, feriados e limite diário.
 */
export function horariosLivres(
  ctx: ContextoAgenda,
  de: Date,
  ate: Date,
  duracaoMin: number,
  opts: { passoMin?: number; limite?: number } = {},
): Date[] {
  const passo = (opts.passoMin ?? 15) * MIN_MS;
  const limite = opts.limite ?? 10;
  const dur = duracaoMin * MIN_MS;
  const feriados = feriadosValidos(ctx.feriados ?? [], ctx.filtroFeriados);
  const out: Date[] = [];
  for (const dia of eachDay(localYmd(de, ctx.fuso), localYmd(ate, ctx.fuso))) {
    if (feriados.has(dia)) continue;
    const doDia = ctx.eventos.filter((e) => localYmd(e.inicio, ctx.fuso) === dia);
    if (ctx.regras.maxReunioesDia && doDia.length >= ctx.regras.maxReunioesDia) continue;
    const msDia = doDia.reduce((t, e) => t + e.fim.getTime() - e.inicio.getTime(), 0);
    if (ctx.regras.maxHorasDia && msDia + dur > ctx.regras.maxHorasDia * HORA_MS) continue;
    for (const [a, b] of livreDoDia(ctx, dia)) {
      // Alinha no passo (ex.: :00, :15, :30, :45).
      let t = Math.ceil(Math.max(a, de.getTime()) / passo) * passo;
      for (; t + dur <= b && t + dur <= ate.getTime(); t += passo) {
        out.push(new Date(t));
        if (out.length >= limite) return out;
      }
    }
  }
  return out;
}

/** Blocos livres de pelo menos `minimoMin` dentro do expediente (tempo de foco). */
export function blocosDeFoco(ctx: ContextoAgenda, de: Ymd, ate: Ymd, minimoMin = 120): Iv[] {
  const feriados = feriadosValidos(ctx.feriados ?? [], ctx.filtroFeriados);
  const semBuffer = { ...ctx, regras: { ...ctx.regras, bufferMin: 0 } };
  return eachDay(de, ate)
    .filter((d) => !feriados.has(d))
    .flatMap((d) => livreDoDia(semBuffer, d))
    .filter(([a, b]) => b - a >= minimoMin * MIN_MS);
}

/** Horas de expediente no período, menos bloqueios e feriados. */
export function horasDisponiveis(ctx: ContextoAgenda, de: Ymd, ate: Ymd): number {
  const feriados = feriadosValidos(ctx.feriados ?? [], ctx.filtroFeriados);
  const exp = eachDay(de, ate)
    .filter((d) => !feriados.has(d))
    .flatMap((d) => expedienteDoDia(ctx.expediente, d, ctx.fuso));
  return totalMs(subtractIv(exp, ctx.bloqueios.map(iv))) / HORA_MS;
}

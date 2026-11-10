/**
 * Regras puras da tela da agenda nova: períodos de cada visão, navegação,
 * títulos em pt-BR, encaixe de 15 minutos e montagem da repetição (RRULE)
 * a partir do formulário. Sem React: testável.
 */
import { addDays, diffDays, instante, localYmd, parseYmd, startOfWeek, utcToLocal, weekdayIso, type Ymd } from '@/lib/agenda-engine';

export type Visao = 'dia' | '4dias' | 'semana' | 'mes' | 'lista';

export const NOME_VISAO: Record<Visao, string> = {
  dia: 'Dia',
  '4dias': '4 dias',
  semana: 'Semana',
  mes: 'Mês',
  lista: 'Lista',
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const DIAS_CURTOS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
export const DIAS_LONGOS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const DIA_RRULE = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export const DIAS_LISTA = 30;

/** Dias que a visão mostra (a semana começa na segunda). */
export function diasDaVisao(visao: Visao, cursor: Ymd): Ymd[] {
  switch (visao) {
    case 'dia':
      return [cursor];
    case '4dias':
      return [0, 1, 2, 3].map((i) => addDays(cursor, i));
    case 'semana': {
      const s = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    case 'mes': {
      const { year, month } = parseYmd(cursor);
      const primeiro = `${year}-${String(month).padStart(2, '0')}-01`;
      const s = startOfWeek(primeiro);
      return Array.from({ length: 42 }, (_, i) => addDays(s, i));
    }
    case 'lista':
      return Array.from({ length: DIAS_LISTA }, (_, i) => addDays(cursor, i));
  }
}

/** Período (instantes) a buscar no servidor para a visão. */
export function periodoDaVisao(visao: Visao, cursor: Ymd, tz: string): { de: Date; ate: Date } {
  const dias = diasDaVisao(visao, cursor);
  return { de: instante(dias[0], '00:00', tz), ate: instante(addDays(dias[dias.length - 1], 1), '00:00', tz) };
}

/** Próximo/anterior período. */
export function navegar(visao: Visao, cursor: Ymd, direcao: 1 | -1): Ymd {
  switch (visao) {
    case 'dia':
      return addDays(cursor, direcao);
    case '4dias':
      return addDays(cursor, 4 * direcao);
    case 'semana':
      return addDays(cursor, 7 * direcao);
    case 'lista':
      return addDays(cursor, DIAS_LISTA * direcao);
    case 'mes': {
      const { year, month, day } = parseYmd(cursor);
      const m = month - 1 + direcao;
      const y = year + Math.floor(m / 12);
      const mm = ((m % 12) + 12) % 12;
      const ultimo = new Date(Date.UTC(y, mm + 1, 0)).getUTCDate();
      return `${y}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(day, ultimo)).padStart(2, '0')}`;
    }
  }
}

function dm(d: Ymd) {
  const { day, month } = parseYmd(d);
  return { day, mes: MESES[month - 1] };
}

/** Título do período, ex.: "9 a 15 de novembro de 2026". */
export function tituloPeriodo(visao: Visao, cursor: Ymd): string {
  const { year, month } = parseYmd(cursor);
  if (visao === 'mes') return `${MESES[month - 1][0].toUpperCase()}${MESES[month - 1].slice(1)} de ${year}`;
  const dias = diasDaVisao(visao, cursor);
  const a = dias[0];
  const b = dias[dias.length - 1];
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  if (dias.length === 1) return `${DIAS_LONGOS[weekdayIso(a) - 1]}, ${pa.day} de ${MESES[pa.month - 1]} de ${pa.year}`;
  if (pa.year !== pb.year) return `${pa.day} de ${dm(a).mes} de ${pa.year} a ${pb.day} de ${dm(b).mes} de ${pb.year}`;
  if (pa.month !== pb.month) return `${pa.day} de ${dm(a).mes} a ${pb.day} de ${dm(b).mes} de ${pb.year}`;
  return `${pa.day} a ${pb.day} de ${dm(a).mes} de ${pa.year}`;
}

export function rotuloDia(d: Ymd): string {
  const { day, mes } = dm(d);
  return `${DIAS_LONGOS[weekdayIso(d) - 1]}, ${day} de ${mes}`;
}

export const SNAP_MIN = 15;
export const HORA_PX = 48;

/** Minutos arredondados para o múltiplo de 15 mais próximo. */
export function snap(min: number, passo = SNAP_MIN): number {
  return Math.round(min / passo) * passo;
}

/** Minutos desde 00:00 local de um instante no dia `dia`. */
export function minutosNoDia(d: Date, dia: Ymd, tz: string): number {
  return Math.round((d.getTime() - instante(dia, '00:00', tz).getTime()) / 60_000);
}

/** Instante de `dia` + minutos locais. */
export function instanteMin(dia: Ymd, minutos: number, tz: string): Date {
  const dias = Math.floor(minutos / 1440);
  const resto = minutos - dias * 1440;
  const h = String(Math.floor(resto / 60)).padStart(2, '0');
  const m = String(resto % 60).padStart(2, '0');
  return instante(addDays(dia, dias), `${h}:${m}`, tz);
}

export function horaCurta(d: Date, tz: string): string {
  const l = utcToLocal(d, tz);
  return `${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}`;
}

export function faixaHorario(inicio: Date, fim: Date, tz: string): string {
  return `${horaCurta(inicio, tz)} às ${horaCurta(fim, tz)}`;
}

/** Valor de <input type="datetime-local"> no fuso. */
export function paraInputLocal(d: Date, tz: string): string {
  return `${localYmd(d, tz)}T${horaCurta(d, tz)}`;
}

export function deInputLocal(v: string, tz: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(v);
  return m ? instante(m[1], m[2], tz) : null;
}

/** Eventos que aparecem no dia (início ou fim dentro dele). */
export function noDia<T extends { inicio: string; fim: string }>(eventos: readonly T[], dia: Ymd, tz: string): T[] {
  const a = instante(dia, '00:00', tz).getTime();
  const b = instante(addDays(dia, 1), '00:00', tz).getTime();
  return eventos.filter((e) => Date.parse(e.inicio) < b && Date.parse(e.fim) > a);
}

export function hojeNoFuso(agora: Date, tz: string): Ymd {
  return localYmd(agora, tz);
}

export function mesmoMes(a: Ymd, b: Ymd): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function diasEntre(a: Ymd, b: Ymd): number {
  return diffDays(a, b);
}

// ------------------------------ Repetição ------------------------------

export type Frequencia = 'nenhuma' | 'diaria' | 'semanal' | 'mensal_dia' | 'mensal_semana';
export type Termino = 'nunca' | 'contagem' | 'data';

export interface Repeticao {
  frequencia: Frequencia;
  intervalo: number;
  /** 1 = segunda ... 7 = domingo (semanal). */
  diasSemana: number[];
  termino: Termino;
  contagem: number;
  ate: Ymd | null;
}

export const SEM_REPETICAO: Repeticao = { frequencia: 'nenhuma', intervalo: 1, diasSemana: [], termino: 'contagem', contagem: 12, ate: null };

/** Posição do dia no mês ("2ª terça"); -1 = última. */
export function posicaoNoMes(d: Ymd): number {
  const { year, month, day } = parseYmd(d);
  const ultimo = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day + 7 > ultimo ? -1 : Math.ceil(day / 7);
}

/** RRULE (sem DTSTART) a partir do formulário; null = sem repetição. */
export function montarRRule(r: Repeticao, primeiroDia: Ymd): string | null {
  if (r.frequencia === 'nenhuma') return null;
  const partes: string[] = [];
  const intervalo = Math.max(1, Math.floor(r.intervalo || 1));
  if (r.frequencia === 'diaria') partes.push('FREQ=DAILY');
  if (r.frequencia === 'semanal') {
    const dias = (r.diasSemana.length ? r.diasSemana : [weekdayIso(primeiroDia)]).slice().sort();
    partes.push('FREQ=WEEKLY', `BYDAY=${dias.map((d) => DIA_RRULE[d - 1]).join(',')}`);
  }
  if (r.frequencia === 'mensal_dia') partes.push('FREQ=MONTHLY', `BYMONTHDAY=${parseYmd(primeiroDia).day}`);
  if (r.frequencia === 'mensal_semana') {
    partes.push('FREQ=MONTHLY', `BYDAY=${posicaoNoMes(primeiroDia)}${DIA_RRULE[weekdayIso(primeiroDia) - 1]}`);
  }
  if (intervalo > 1) partes.push(`INTERVAL=${intervalo}`);
  if (r.termino === 'contagem') partes.push(`COUNT=${Math.max(1, Math.floor(r.contagem || 1))}`);
  if (r.termino === 'data' && r.ate) partes.push(`UNTIL=${r.ate.replace(/-/g, '')}T235959Z`);
  return partes.join(';');
}

const ORDINAL = ['', '1ª', '2ª', '3ª', '4ª', '5ª'];

/** Descrição em português, ex.: "Semanal às terças e quintas, 12 vezes". */
export function descreverRepeticao(r: Repeticao, primeiroDia: Ymd): string {
  if (r.frequencia === 'nenhuma') return 'Não se repete';
  const n = Math.max(1, Math.floor(r.intervalo || 1));
  const plural = (dias: number[]) => {
    const nomes = dias.map((d) => `${DIAS_LONGOS[d - 1]}${d >= 6 ? 's' : 's'}`);
    return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0];
  };
  let base = '';
  if (r.frequencia === 'diaria') base = n > 1 ? `A cada ${n} dias` : 'Todos os dias';
  if (r.frequencia === 'semanal') {
    const dias = (r.diasSemana.length ? r.diasSemana : [weekdayIso(primeiroDia)]).slice().sort();
    base = `${n > 1 ? `A cada ${n} semanas` : 'Semanal'} às ${plural(dias)}`;
  }
  if (r.frequencia === 'mensal_dia') base = `${n > 1 ? `A cada ${n} meses` : 'Mensal'} no dia ${parseYmd(primeiroDia).day}`;
  if (r.frequencia === 'mensal_semana') {
    const p = posicaoNoMes(primeiroDia);
    base = `${n > 1 ? `A cada ${n} meses` : 'Mensal'} na ${p === -1 ? 'última' : ORDINAL[p]} ${DIAS_LONGOS[weekdayIso(primeiroDia) - 1]}`;
  }
  if (r.termino === 'contagem') return `${base}, ${r.contagem} ${r.contagem === 1 ? 'vez' : 'vezes'}`;
  if (r.termino === 'data' && r.ate) {
    const { day, month, year } = parseYmd(r.ate);
    return `${base}, até ${day}/${String(month).padStart(2, '0')}/${year}`;
  }
  return `${base}, sem data para acabar`;
}

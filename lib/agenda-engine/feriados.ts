/**
 * Feriados. Os nacionais são calculados aqui (fixos + os que dependem da
 * Páscoa), sem depender de API. Estaduais, municipais e recessos da Legacy
 * chegam cadastrados pelo admin no mesmo formato.
 */
import { addDays, type Ymd } from './tempo';

export type EscopoFeriado = 'nacional' | 'estadual' | 'municipal' | 'legacy';

export interface Feriado {
  data: Ymd;
  nome: string;
  escopo: EscopoFeriado;
  /** Ponto facultativo nacional (Carnaval, Corpus Christi): conta ou não por configuração. */
  facultativo?: boolean;
  uf?: string | null;
  municipio?: string | null;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function pascoa(ano: number): Ymd {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Feriados nacionais do ano (Lei 662/1949, 6.802/1980, 14.759/2023) + pontos facultativos. */
export function feriadosNacionais(ano: number): Feriado[] {
  const fixo = (mmdd: string, nome: string): Feriado => ({ data: `${ano}-${mmdd}`, nome, escopo: 'nacional' });
  const p = pascoa(ano);
  const lista: Feriado[] = [
    fixo('01-01', 'Confraternização Universal'),
    { data: addDays(p, -48), nome: 'Carnaval (segunda)', escopo: 'nacional', facultativo: true },
    { data: addDays(p, -47), nome: 'Carnaval (terça)', escopo: 'nacional', facultativo: true },
    { data: addDays(p, -2), nome: 'Sexta-feira Santa', escopo: 'nacional' },
    fixo('04-21', 'Tiradentes'),
    fixo('05-01', 'Dia do Trabalho'),
    { data: addDays(p, 60), nome: 'Corpus Christi', escopo: 'nacional', facultativo: true },
    fixo('09-07', 'Independência do Brasil'),
    fixo('10-12', 'Nossa Senhora Aparecida'),
    fixo('11-02', 'Finados'),
    fixo('11-15', 'Proclamação da República'),
    fixo('12-25', 'Natal'),
  ];
  // Consciência Negra é feriado nacional desde 2024 (Lei 14.759/2023).
  if (ano >= 2024) lista.push(fixo('11-20', 'Dia Nacional de Zumbi e da Consciência Negra'));
  return lista.sort((a, b) => a.data.localeCompare(b.data));
}

export interface FiltroFeriados {
  /** Pontos facultativos contam como feriado? (padrão: sim) */
  considerarFacultativos?: boolean;
  /** UF/município do executor: estaduais/municipais de outros lugares não contam. */
  uf?: string | null;
  municipio?: string | null;
}

/** Feriados que valem para um executor, indexados por data. */
export function feriadosValidos(lista: readonly Feriado[], filtro: FiltroFeriados = {}): Map<Ymd, Feriado> {
  const out = new Map<Ymd, Feriado>();
  for (const f of lista) {
    if (f.facultativo && filtro.considerarFacultativos === false) continue;
    if (f.escopo === 'estadual' && f.uf && filtro.uf && f.uf !== filtro.uf) continue;
    if (f.escopo === 'municipal' && f.municipio && filtro.municipio && f.municipio !== filtro.municipio) continue;
    if (!out.has(f.data)) out.set(f.data, f);
  }
  return out;
}

/** Feriados nacionais de vários anos (para gerar agendas que cruzam a virada). */
export function feriadosNacionaisEntre(anoInicio: number, anoFim: number): Feriado[] {
  const out: Feriado[] = [];
  for (let a = anoInicio; a <= anoFim; a++) out.push(...feriadosNacionais(a));
  return out;
}

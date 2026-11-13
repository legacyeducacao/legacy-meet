/**
 * Calendário da página pública do kickoff: regras puras das visões Mês, Semana
 * e Dia. Adaptado do Legacy CS (src/lib/kickoffs-publico-calendario.ts).
 *
 * Só reorganiza as sessões que o banco já devolveu (abertas, futuras e com vaga,
 * com data e hora de Brasília). Nenhuma regra de disponibilidade nasce aqui.
 * Semanas de domingo a sábado, como no calendário de parede.
 */
import { DIAS_DA_SEMANA, MESES, dataPorExtenso, diaDaSemanaDe, sessoesPorDia, somarDias, type SessaoPublica } from './publico';

export type VisaoDoCalendario = 'mes' | 'semana' | 'dia';

export const VISOES: { valor: VisaoDoCalendario; rotulo: string }[] = [
  { valor: 'mes', rotulo: 'Mês' },
  { valor: 'semana', rotulo: 'Semana' },
  { valor: 'dia', rotulo: 'Dia' },
];

/** Tela larga abre no mês; celular abre no dia, com os horários em botões grandes. */
export function visaoInicial(telaLarga: boolean): VisaoDoCalendario {
  return telaLarga ? 'mes' : 'dia';
}

/** Horários de cada data, em ordem; só datas que têm horário. */
export function horariosPorData(sessoes: SessaoPublica[]): Map<string, SessaoPublica[]> {
  return new Map(sessoesPorDia(sessoes).map((d) => [d.data, d.sessoes]));
}

function partes(data: string) {
  const [ano, mes, dia] = data.split('-').map(Number);
  return { ano, mes, dia };
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

export function primeiroDoMes(data: string): string {
  return `${data.slice(0, 7)}-01`;
}

/** Dia 1 do mês anterior (-1) ou seguinte (+1). */
export function mesVizinho(data: string, passo: -1 | 1): string {
  const { ano, mes } = partes(data);
  const d = new Date(ano, mes - 1 + passo, 1);
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-01`;
}

export function ultimoDoMes(data: string): string {
  return somarDias(mesVizinho(data, 1), -1);
}

/** Domingo da semana do dia dado. */
export function domingoDaSemana(data: string): string {
  return somarDias(data, -diaDaSemanaDe(data));
}

/** Os 7 dias, de domingo a sábado. */
export function seteDias(domingo: string): string[] {
  return Array.from({ length: 7 }, (_, i) => somarDias(domingo, i));
}

/** Semanas do mês, de domingo a sábado. Null = dia de outro mês (célula vazia). */
export function gradeDoMes(data: string): (string | null)[][] {
  const mes = data.slice(0, 7);
  const semanas: (string | null)[][] = [];
  for (let domingo = domingoDaSemana(primeiroDoMes(data)); ; domingo = somarDias(domingo, 7)) {
    const dias = seteDias(domingo).map((d) => (d.slice(0, 7) === mes ? d : null));
    if (dias.every((d) => d === null)) return semanas;
    semanas.push(dias);
  }
}

/** "Novembro de 2026". */
export function rotuloDoMes(data: string): string {
  const { ano, mes } = partes(data);
  const nome = MESES[mes - 1];
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`;
}

/** "15 a 21 de novembro", "29 de novembro a 5 de dezembro"... */
export function intervaloDaSemana(domingo: string): string {
  const a = partes(domingo);
  const b = partes(somarDias(domingo, 6));
  if (a.ano !== b.ano) return `${a.dia} de ${MESES[a.mes - 1]} de ${a.ano} a ${b.dia} de ${MESES[b.mes - 1]} de ${b.ano}`;
  if (a.mes !== b.mes) return `${a.dia} de ${MESES[a.mes - 1]} a ${b.dia} de ${MESES[b.mes - 1]}`;
  return `${a.dia} a ${b.dia} de ${MESES[b.mes - 1]}`;
}

/** Até onde dá para navegar: de hoje ao último dia que tem horário. */
export interface LimitesDoCalendario {
  primeiro: string;
  ultimo: string;
}

export function limitesDoCalendario(datasComHorario: string[], hoje: string): LimitesDoCalendario {
  const ultimo = datasComHorario[datasComHorario.length - 1] ?? hoje;
  return { primeiro: hoje, ultimo: ultimo > hoje ? ultimo : hoje };
}

function periodo(visao: VisaoDoCalendario, data: string): [string, string] {
  if (visao === 'mes') return [primeiroDoMes(data), ultimoDoMes(data)];
  if (visao === 'semana') {
    const domingo = domingoDaSemana(data);
    return [domingo, somarDias(domingo, 6)];
  }
  return [data, data];
}

/** Se voltar (-1) ou avançar (+1) leva a algum dia que vale a pena ver. */
export function podeNavegar(visao: VisaoDoCalendario, data: string, passo: -1 | 1, limites: LimitesDoCalendario): boolean {
  const [inicio, fim] = periodo(visao, data);
  return passo < 0 ? inicio > limites.primeiro : fim < limites.ultimo;
}

/** Dia em foco depois de voltar ou avançar. */
export function diaAoNavegar(
  visao: VisaoDoCalendario,
  data: string,
  passo: -1 | 1,
  datasComHorario: string[],
  limites: LimitesDoCalendario,
): string {
  if (visao === 'dia') return somarDias(data, passo);
  const alvo = visao === 'mes' ? mesVizinho(data, passo) : somarDias(domingoDaSemana(data), 7 * passo);
  const [inicio, fim] = periodo(visao, alvo);
  const comHorario = datasComHorario.find((d) => d >= inicio && d <= fim && d >= limites.primeiro);
  if (comHorario) return comHorario;
  return inicio < limites.primeiro ? limites.primeiro : inicio;
}

export function proximoDiaComHorario(datasComHorario: string[], data: string): string | null {
  return datasComHorario.find((d) => d > data) ?? null;
}

export function diaAnteriorComHorario(datasComHorario: string[], data: string): string | null {
  return datasComHorario.filter((d) => d < data).pop() ?? null;
}

/** "Hoje", "Amanhã" ou null. */
export function apelidoDoDia(data: string, hoje: string): string | null {
  if (data === hoje) return 'Hoje';
  if (data === somarDias(hoje, 1)) return 'Amanhã';
  return null;
}

export function horarios(n: number): string {
  return n === 1 ? '1 horário' : `${n} horários`;
}

/** Para leitor de tela: "Terça-feira, 17 de novembro, hoje: 2 horários". */
export function descricaoDoDia(data: string, quantos: number, hoje: string): string {
  const apelido = apelidoDoDia(data, hoje);
  const quando = `${dataPorExtenso(data)}${apelido ? `, ${apelido.toLowerCase()}` : ''}`;
  return `${quando}: ${quantos > 0 ? horarios(quantos) : 'sem horários'}`;
}

/** "12 de novembro". */
export function diaEMes(data: string): string {
  const { mes, dia } = partes(data);
  return `${dia} de ${MESES[mes - 1]}`;
}

/** "Quinta-feira", "Quarta-feira · Amanhã". */
export function diaDaSemanaPorExtenso(data: string, hoje: string): string {
  const apelido = apelidoDoDia(data, hoje);
  return `${DIAS_DA_SEMANA[diaDaSemanaDe(data)]}${apelido ? ` · ${apelido}` : ''}`;
}

export function numeroDoDia(data: string): number {
  return partes(data).dia;
}

/** Rola até o elemento só se ele estiver fora da vista; respeita prefers-reduced-motion. */
export function mostrarNaTela(el: HTMLElement | null, sempre = false): void {
  if (!el || typeof window === 'undefined') return;
  const topo = el.getBoundingClientRect().top;
  if (!sempre && topo >= 0 && topo <= window.innerHeight - 160) return;
  const reduzir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  el.scrollIntoView({ behavior: reduzir ? 'auto' : 'smooth', block: 'start' });
}

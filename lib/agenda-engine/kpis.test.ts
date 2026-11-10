import { describe, expect, it } from 'vitest';
import { EXPEDIENTE_PADRAO } from './disponibilidade';
import {
  calcularKpis,
  horasPorSemana,
  mapaOcupacao,
  somarKpis,
  kpisJornadasImpulsao,
  periodoAnterior,
  riscoJornadaLegado,
  variacao,
  type GravacaoKpi,
  type ReuniaoKpi,
} from './kpis';
import { instante } from './tempo';

const SP = 'America/Sao_Paulo';
const em = (d: string, h: string) => instante(d, h, SP);
const min = (n: number) => n * 60;

// Semana de 09 a 13/11/2026 (seg a sex), conjunto fixo de exemplo.
const ctx = {
  fuso: SP,
  expediente: EXPEDIENTE_PADRAO, // 9 h por dia
  bloqueios: [{ id: 'b', inicio: em('2026-11-11', '14:00'), fim: em('2026-11-11', '16:00') }],
  regras: { bufferMin: 15, maxHorasSemana: 30 },
};
const r = (id: string, d: string, h1: string, h2: string, produto: string, status: ReuniaoKpi['status'], extra = {}): ReuniaoKpi => ({
  id, produto, status, inicio: em(d, h1), fim: em(d, h2), ...extra,
});
const reunioes: ReuniaoKpi[] = [
  r('r1', '2026-11-09', '09:00', '10:00', 'legado', 'realizada'),
  r('r2', '2026-11-09', '10:30', '11:30', 'impulsao', 'realizada'),
  r('r3', '2026-11-10', '09:00', '10:00', 'legado', 'no_show'),
  r('r4', '2026-11-10', '14:00', '15:00', 'legado', 'cancelada', { origemCancelamento: 'cliente' }),
  r('r5', '2026-11-11', '09:00', '10:00', 'legado', 'agendada', { remarcadaPor: 'executor' }),
  r('r6', '2026-11-12', '18:00', '19:00', 'legado', 'realizada'),
  r('r7', '2026-11-16', '09:00', '10:00', 'legado', 'realizada'), // fora do período
];
const gravacoes: GravacaoKpi[] = [
  { reuniaoId: 'r1', inicio: em('2026-11-09', '09:02'), duracaoSeg: min(50) },
  { reuniaoId: 'r2', inicio: em('2026-11-09', '10:30'), duracaoSeg: min(70) },
  { reuniaoId: 'r6', inicio: em('2026-11-12', '18:00'), duracaoSeg: min(60) },
  { reuniaoId: 'r7', inicio: em('2026-11-16', '09:00'), duracaoSeg: min(60) },
];

describe('calcularKpis (conjunto fixo)', () => {
  const k = calcularKpis({ de: '2026-11-09', ate: '2026-11-13' }, ctx, reunioes, gravacoes);

  it('horas disponíveis, agendadas e realizadas', () => {
    expect(k.horasDisponiveis).toBe(43); // 45 h de expediente - 2 h de bloqueio
    expect(k.horasAgendadas).toBe(5); // r1, r2, r3, r5, r6 (cancelada não conta)
    expect(k.horasRealizadas).toBe(3); // 50 + 70 + 60 min de gravação
  });

  it('taxas de ocupação e realização', () => {
    expect(k.taxaOcupacao).toBe(0.12); // 5 / 43
    expect(k.taxaRealizacao).toBe(0.6); // 3 / 5
  });

  it('horas por produto e aderência à duração', () => {
    expect(k.horasPorProduto).toEqual({ legado: 1.83, impulsao: 1.17 });
    expect(k.aderenciaDuracao).toBe(1); // média real 60 min / média planejada 60 min
  });

  it('no-show, cancelamentos e remarcações por origem', () => {
    expect(k.noShow).toEqual({ total: 1, taxa: 0.2 });
    expect(k.cancelamentos).toEqual({ total: 1, taxa: 0.17, porOrigem: { cliente: 1 } });
    expect(k.remarcacoes).toEqual({ total: 1, taxa: 0.2, porOrigem: { executor: 1 } });
  });

  it('horas fora do expediente (gravação das 18h às 19h)', () => {
    expect(k.horasForaExpediente).toBe(1);
  });

  it('tempo de foco: blocos livres de 2 h ou mais', () => {
    expect(k.tempoFoco).toEqual({ blocos: 9, horas: 34 });
  });

  it('carga semanal com alerta acima do limite', () => {
    expect(k.cargaSemanal).toEqual([{ semana: '2026-11-09', horas: 5, acimaLimite: false }]);
    const apertado = calcularKpis({ de: '2026-11-09', ate: '2026-11-13' }, { ...ctx, regras: { bufferMin: 15, maxHorasSemana: 4 } }, reunioes, gravacoes);
    expect(apertado.cargaSemanal[0].acimaLimite).toBe(true);
  });
});

describe('comparativo com o período anterior', () => {
  it('período anterior do mesmo tamanho e variação', () => {
    expect(periodoAnterior({ de: '2026-11-09', ate: '2026-11-13' })).toEqual({ de: '2026-11-04', ate: '2026-11-08' });
    expect(variacao(5, 4)).toBe(0.25);
    expect(variacao(5, 0)).toBeNull();
  });
});

describe('jornadas', () => {
  it('Impulsão: ativos por grupo, progresso e quem faltou a uma Aula 2', () => {
    const k = kpisJornadasImpulsao(
      [
        { clienteId: 'a', grupoId: 'ter', status: 'ativa', encontros: [
          { numero: 1, rotulo: 'F1', presenca: 'presente' },
          { numero: 2, rotulo: 'F2', presenca: 'faltou' },
          { numero: 3, rotulo: 'C1', presenca: 'pendente' },
          { numero: 4, rotulo: 'C2', presenca: 'pendente' },
        ] },
        { clienteId: 'b', grupoId: 'qui', status: 'ativa', encontros: [
          { numero: 1, rotulo: 'C1', presenca: 'presente' },
          { numero: 2, rotulo: 'C2', presenca: 'presente' },
          { numero: 3, rotulo: 'F1', presenca: 'pendente' },
          { numero: 4, rotulo: 'F2', presenca: 'pendente' },
        ] },
        { clienteId: 'c', grupoId: 'ter', status: 'concluida', encontros: [] },
      ],
      ['F2', 'C2'],
    );
    expect(k.ativosPorGrupo).toEqual({ ter: 1, qui: 1 });
    expect(k.progresso).toEqual([
      { clienteId: 'a', concluidos: 1, total: 4 },
      { clienteId: 'b', concluidos: 2, total: 4 },
    ]);
    expect(k.faltaramAula2).toEqual(['a']);
  });

  it('Legado em risco: faltam 2 semanas e ainda há 3 encontros', () => {
    const j = { clienteId: 'x', inicio: '2026-08-17', fim: '2026-11-23', previstos: 12, realizados: 9 };
    expect(riscoJornadaLegado(j, '2026-11-09')).toMatchObject({ pendentes: 3, possiveis: 2, emRisco: true });
    expect(riscoJornadaLegado({ ...j, realizados: 10 }, '2026-11-09')).toMatchObject({ pendentes: 2, emRisco: false });
    expect(riscoJornadaLegado({ ...j, realizados: 12 }, '2026-11-09').emRisco).toBe(false);
  });
});

describe('visão do gestor e gráficos', () => {
  const k = calcularKpis({ de: '2026-11-09', ate: '2026-11-13' }, ctx, reunioes, gravacoes);

  it('somar dois executores iguais dobra as horas e mantém as taxas', () => {
    const t = somarKpis([k, k]);
    expect(t.horasDisponiveis).toBe(86);
    expect(t.horasAgendadas).toBe(10);
    expect(t.horasRealizadas).toBe(6);
    expect(t.taxaRealizacao).toBe(0.6);
    expect(t.noShow).toEqual({ total: 2, taxa: 0.2 });
    expect(t.cancelamentos.porOrigem).toEqual({ cliente: 2 });
    expect(t.aderenciaDuracao).toBe(1);
    expect(t.cargaSemanal).toEqual([{ semana: '2026-11-09', horas: 10, acimaLimite: false }]);
  });

  it('horas por semana: agendadas x realizadas', () => {
    const semanas = horasPorSemana(reunioes, gravacoes, 'America/Sao_Paulo');
    expect(semanas).toEqual([
      { semana: '2026-11-09', agendadas: 5, realizadas: 3 },
      { semana: '2026-11-16', agendadas: 1, realizadas: 1 },
    ]);
  });

  it('mapa de calor por dia da semana e hora', () => {
    const m = mapaOcupacao(reunioes, 'America/Sao_Paulo');
    expect(m[0][9]).toBe(2); // segundas 9h: r1 (09/11) + r7 (16/11)
    expect(m[0][10]).toBe(0.5); // r2 começa 10:30
    expect(m[0][11]).toBe(0.5);
    expect(m[1][14]).toBe(0); // r4 cancelada não conta
    expect(m[3][18]).toBe(1); // quinta 18h
    expect(m.flat().reduce((a, b) => a + b, 0)).toBe(6);
  });
});

import { describe, expect, it } from 'vitest';
import { feriadosNacionais } from './feriados';
import { dividirSerie, expandirSerie, type SerieDef } from './recorrencia';

const SP = 'America/Sao_Paulo';
const iso = (d: Date) => d.toISOString();
const janela = (de: string, ate: string) => ({ de: new Date(de), ate: new Date(ate) });
const ANO = janela('2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z');

describe('expandirSerie', () => {
  it('vários dias da semana', () => {
    const s: SerieDef = { rrule: 'FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4', inicioLocal: '2026-01-06T09:00', fuso: SP, duracaoMin: 60 };
    expect(expandirSerie(s, ANO).map((o) => iso(o.inicio))).toEqual([
      '2026-01-06T12:00:00.000Z',
      '2026-01-08T12:00:00.000Z',
      '2026-01-13T12:00:00.000Z',
      '2026-01-15T12:00:00.000Z',
    ]);
  });

  it('"2ª terça do mês" e término por data', () => {
    const s: SerieDef = { rrule: 'FREQ=MONTHLY;BYDAY=+2TU;UNTIL=20260401T000000Z', inicioLocal: '2026-01-01T14:00', fuso: SP, duracaoMin: 60 };
    expect(expandirSerie(s, ANO).map((o) => iso(o.inicio).slice(0, 10))).toEqual(['2026-01-13', '2026-02-10', '2026-03-10']);
  });

  it('a cada 2 semanas, sem fim, limitado pela janela', () => {
    const s: SerieDef = { rrule: 'FREQ=WEEKLY;INTERVAL=2', inicioLocal: '2026-01-05T10:00', fuso: SP, duracaoMin: 30 };
    const o = expandirSerie(s, janela('2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z'));
    expect(o.map((x) => iso(x.inicio).slice(0, 10))).toEqual(['2026-02-02', '2026-02-16']);
    // a ordem conta desde o começo da série, não da janela
    expect(o.map((x) => x.ordem)).toEqual([2, 3]);
  });

  it('virada de ano', () => {
    const s: SerieDef = { rrule: 'FREQ=WEEKLY;COUNT=3', inicioLocal: '2026-12-22T10:00', fuso: SP, duracaoMin: 60 };
    expect(expandirSerie(s, ANO).map((o) => iso(o.inicio))).toEqual([
      '2026-12-22T13:00:00.000Z',
      '2026-12-29T13:00:00.000Z',
      '2027-01-05T13:00:00.000Z',
    ]);
  });

  it('horário de verão: 10h continua 10h (Brasil 2018)', () => {
    const s: SerieDef = { rrule: 'FREQ=WEEKLY;COUNT=2', inicioLocal: '2018-10-29T10:00', fuso: SP, duracaoMin: 60 };
    expect(expandirSerie(s, janela('2018-01-01T00:00:00Z', '2019-01-01T00:00:00Z')).map((o) => iso(o.inicio))).toEqual([
      '2018-10-29T13:00:00.000Z',
      '2018-11-05T12:00:00.000Z',
    ]);
  });

  it('horário de verão: Nova York em março', () => {
    const s: SerieDef = { rrule: 'FREQ=WEEKLY;COUNT=2', inicioLocal: '2026-03-02T10:00', fuso: 'America/New_York', duracaoMin: 60 };
    expect(expandirSerie(s, ANO).map((o) => iso(o.inicio))).toEqual(['2026-03-02T15:00:00.000Z', '2026-03-09T14:00:00.000Z']);
  });

  it('sequência rotativa acoplada à série, com defasagem', () => {
    const s: SerieDef = {
      rrule: 'FREQ=WEEKLY;COUNT=5',
      inicioLocal: '2026-01-08T09:00',
      fuso: SP,
      duracaoMin: 120,
      sequencia: ['F1', 'F2', 'C1', 'C2'],
      defasagem: 1,
    };
    expect(expandirSerie(s, ANO).map((o) => o.rotulo)).toEqual(['C2', 'F1', 'F2', 'C1', 'C2']);
  });

  it("feriado 'pular': o encontro vai para o fim e o total se mantém (Tiradentes 2026)", () => {
    const s: SerieDef = { rrule: 'FREQ=WEEKLY;COUNT=4', inicioLocal: '2026-04-07T10:00', fuso: SP, duracaoMin: 60 };
    const o = expandirSerie(s, ANO, { feriados: feriadosNacionais(2026), politicaFeriado: 'pular' });
    expect(o.map((x) => [iso(x.inicio).slice(0, 10), x.status, x.ordem])).toEqual([
      ['2026-04-07', 'agendada', 0],
      ['2026-04-14', 'agendada', 1],
      ['2026-04-21', 'pulada_feriado', -1],
      ['2026-04-28', 'agendada', 2],
      ['2026-05-05', 'agendada', 3],
    ]);
    expect(o[2].feriado).toBe('Tiradentes');
  });

  it('exceções: cancelada e movida, sem quebrar a série', () => {
    const s: SerieDef = { rrule: 'FREQ=WEEKLY;COUNT=3', inicioLocal: '2026-01-06T09:00', fuso: SP, duracaoMin: 60 };
    const o = expandirSerie(s, ANO, {
      excecoes: [
        { inicioOriginal: new Date('2026-01-13T12:00:00Z'), tipo: 'cancelada' },
        { inicioOriginal: new Date('2026-01-20T12:00:00Z'), tipo: 'movida', novoInicio: new Date('2026-01-21T17:00:00Z'), novaDuracaoMin: 90 },
      ],
    });
    expect(o.map((x) => [x.status, iso(x.inicio), iso(x.fim), x.excecao])).toEqual([
      ['agendada', '2026-01-06T12:00:00.000Z', '2026-01-06T13:00:00.000Z', false],
      ['cancelada', '2026-01-13T12:00:00.000Z', '2026-01-13T13:00:00.000Z', true],
      ['movida', '2026-01-21T17:00:00.000Z', '2026-01-21T18:30:00.000Z', true],
    ]);
    expect(iso(o[2].inicioOriginal)).toBe('2026-01-20T12:00:00.000Z');
  });
});

describe('dividirSerie ("este e os seguintes")', () => {
  const serie: SerieDef = {
    rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=12',
    inicioLocal: '2026-01-06T09:00',
    fuso: SP,
    duracaoMin: 60,
    sequencia: ['F1', 'F2', 'C1', 'C2'],
  };

  it('preserva o passado, continua a contagem e os rótulos', () => {
    const todas = expandirSerie(serie, ANO);
    const corte = todas[4].inicioOriginal; // 5ª ocorrência
    const { anterior, nova, ocorrenciasAntes } = dividirSerie(serie, corte);
    expect(ocorrenciasAntes).toBe(4);
    const antes = expandirSerie(anterior!, ANO);
    const depois = expandirSerie(nova, ANO);
    expect(antes.map((o) => iso(o.inicio))).toEqual(todas.slice(0, 4).map((o) => iso(o.inicio)));
    expect(depois.map((o) => iso(o.inicio))).toEqual(todas.slice(4).map((o) => iso(o.inicio)));
    expect(depois.map((o) => o.rotulo)).toEqual(todas.slice(4).map((o) => o.rotulo));
    expect(anterior!.rrule).toContain('COUNT=4');
    expect(nova.rrule).toContain('COUNT=8');
  });

  it('edição aplicada só na nova série (ex.: mudar para 10h) não mexe no passado', () => {
    const todas = expandirSerie(serie, ANO);
    const { anterior, nova } = dividirSerie(serie, todas[6].inicioOriginal);
    const editada = { ...nova, inicioLocal: nova.inicioLocal.replace('09:00', '10:00') };
    expect(expandirSerie(anterior!, ANO).every((o) => iso(o.inicio).endsWith('12:00:00.000Z'))).toBe(true);
    expect(expandirSerie(editada, ANO).every((o) => iso(o.inicio).endsWith('13:00:00.000Z'))).toBe(true);
    expect(expandirSerie(editada, ANO)).toHaveLength(6);
  });

  it('série sem fim: a anterior ganha UNTIL', () => {
    const semFim: SerieDef = { ...serie, rrule: 'FREQ=WEEKLY;BYDAY=TU' };
    const todas = expandirSerie(semFim, janela('2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'));
    const { anterior } = dividirSerie(semFim, todas[3].inicioOriginal);
    expect(anterior!.rrule).toMatch(/UNTIL=20260127T085900Z/);
    expect(expandirSerie(anterior!, ANO)).toHaveLength(3);
  });

  it('dividir na primeira ocorrência = editar todos (sem série anterior)', () => {
    const r = dividirSerie(serie, new Date('2026-01-06T12:00:00Z'));
    expect(r.anterior).toBeNull();
    expect(r.nova.rrule).toContain('COUNT=12');
  });
});

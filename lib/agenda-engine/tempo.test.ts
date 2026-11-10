import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  instante,
  localToUtc,
  localYmd,
  mergeIv,
  overlapMs,
  startOfWeek,
  subtractIv,
  utcToLocal,
  weekdayIso,
  weeksBetween,
} from './tempo';
import { feriadosNacionais, pascoa } from './feriados';

describe('fuso horário', () => {
  it('São Paulo hoje é UTC-3', () => {
    expect(instante('2026-11-10', '10:00').toISOString()).toBe('2026-11-10T13:00:00.000Z');
    expect(localYmd(new Date('2026-11-11T02:30:00Z'))).toBe('2026-11-10');
  });

  it('horário de verão no Brasil (2018): hora que não existe é empurrada para frente', () => {
    // 04/11/2018 00:00 virou 01:00. 00:30 não existiu: vira 01:30 (UTC-2).
    const d = localToUtc({ year: 2018, month: 11, day: 4, hour: 0, minute: 30 }, 'America/Sao_Paulo');
    expect(d.toISOString()).toBe('2018-11-04T03:30:00.000Z');
    expect(utcToLocal(d, 'America/Sao_Paulo')).toMatchObject({ hour: 1, minute: 30 });
  });

  it('fim do horário de verão (2019): hora repetida usa o primeiro instante', () => {
    const d = localToUtc({ year: 2019, month: 2, day: 16, hour: 23, minute: 30 }, 'America/Sao_Paulo');
    expect(d.toISOString()).toBe('2019-02-17T01:30:00.000Z');
  });

  it('Nova York: 10h é 15Z no inverno e 14Z no verão', () => {
    expect(instante('2026-03-02', '10:00', 'America/New_York').toISOString()).toBe('2026-03-02T15:00:00.000Z');
    expect(instante('2026-03-09', '10:00', 'America/New_York').toISOString()).toBe('2026-03-09T14:00:00.000Z');
  });
});

describe('datas de calendário', () => {
  it('dias, semanas e virada de ano', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(diffDays('2026-12-30', '2027-01-02')).toBe(3);
    expect(weekdayIso('2026-11-10')).toBe(2);
    expect(weekdayIso('2026-11-15')).toBe(7);
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09');
    expect(weeksBetween('2026-12-29', '2027-01-05')).toBe(1);
    expect(weeksBetween('2027-01-05', '2026-12-29')).toBe(-1);
  });
});

describe('intervalos', () => {
  it('juntar, subtrair e sobreposição', () => {
    expect(mergeIv([[5, 8], [1, 3], [2, 4]])).toEqual([[1, 4], [5, 8]]);
    expect(subtractIv([[0, 10]], [[2, 3], [5, 7]])).toEqual([[0, 2], [3, 5], [7, 10]]);
    expect(overlapMs([[0, 10]], [[5, 20]])).toBe(5);
  });
});

describe('feriados nacionais', () => {
  it('Páscoa', () => {
    expect(pascoa(2026)).toBe('2026-04-05');
    expect(pascoa(2027)).toBe('2027-03-28');
  });
  it('2026: móveis, fixos e Consciência Negra', () => {
    const f = new Map(feriadosNacionais(2026).map((x) => [x.data, x]));
    expect(f.get('2026-04-03')?.nome).toBe('Sexta-feira Santa');
    expect(f.get('2026-02-17')?.facultativo).toBe(true);
    expect(f.get('2026-06-04')?.nome).toBe('Corpus Christi');
    expect(f.has('2026-11-20')).toBe(true);
    expect(f.has('2026-04-21')).toBe(true);
    expect(feriadosNacionais(2023).some((x) => x.data === '2023-11-20')).toBe(false);
  });
});

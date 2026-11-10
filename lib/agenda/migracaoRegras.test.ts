import { describe, expect, it } from 'vitest';
import { rruleDeRegraAntiga } from './migracaoRegras';

const SP = 'America/Sao_Paulo';
const terca = new Date('2026-11-10T12:00:00Z');

describe('rruleDeRegraAntiga', () => {
  it('agenda atual do Meet', () => {
    expect(rruleDeRegraAntiga('weekly;count=12', terca, 12, SP)).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=12', origem: 'meet' });
    expect(rruleDeRegraAntiga('biweekly;until=2026-12-31', terca, 4, SP).rrule).toBe('FREQ=WEEKLY;BYDAY=TU;INTERVAL=2;UNTIL=20261231T235959Z');
    expect(rruleDeRegraAntiga('monthly;count=3', terca, 3, SP).rrule).toBe('FREQ=MONTHLY;COUNT=3');
  });
  it('JSON do Legacy Plan', () => {
    const r = rruleDeRegraAntiga('{"freq":"weekly","interval":1,"byDays":["WE"],"endType":"count","count":12}', terca, 12, SP);
    expect(r).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=WE;COUNT=12', origem: 'plan' });
  });
  it('série da agenda nova já é RRULE', () => {
    expect(rruleDeRegraAntiga('rrule:FREQ=WEEKLY;BYDAY=TU;COUNT=12', terca, 12, SP).origem).toBe('agenda-nova');
  });
  it('sem regra: semanal no dia da primeira com o total', () => {
    expect(rruleDeRegraAntiga(null, terca, 7, SP)).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=7', origem: 'inferida' });
    expect(rruleDeRegraAntiga('{quebrado', terca, 2, SP).origem).toBe('inferida');
  });
});

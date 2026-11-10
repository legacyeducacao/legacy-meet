import { describe, expect, it } from 'vitest';
import { expandirSerie } from '@/lib/agenda-engine';
import {
  descreverRepeticao,
  diasDaVisao,
  instanteMin,
  minutosNoDia,
  montarRRule,
  navegar,
  noDia,
  periodoDaVisao,
  posicaoNoMes,
  snap,
  SEM_REPETICAO,
  tituloPeriodo,
} from './visao';
import { decidirConflitos } from './regras';

const SP = 'America/Sao_Paulo';

describe('visões', () => {
  it('semana começa na segunda; mês mostra 6 semanas', () => {
    expect(diasDaVisao('semana', '2026-11-12')).toEqual([
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15',
    ]);
    const mes = diasDaVisao('mes', '2026-11-12');
    expect(mes).toHaveLength(42);
    expect(mes[0]).toBe('2026-10-26');
    expect(diasDaVisao('4dias', '2026-12-30')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('período em instantes (São Paulo)', () => {
    const p = periodoDaVisao('dia', '2026-11-10', SP);
    expect(p.de.toISOString()).toBe('2026-11-10T03:00:00.000Z');
    expect(p.ate.toISOString()).toBe('2026-11-11T03:00:00.000Z');
  });

  it('navegar: mês preserva o dia quando possível', () => {
    expect(navegar('mes', '2026-01-31', 1)).toBe('2026-02-28');
    expect(navegar('mes', '2026-12-15', 1)).toBe('2027-01-15');
    expect(navegar('mes', '2026-01-15', -1)).toBe('2025-12-15');
    expect(navegar('semana', '2026-11-10', -1)).toBe('2026-11-03');
    expect(navegar('4dias', '2026-11-10', 1)).toBe('2026-11-14');
  });

  it('títulos em português, sem travessão', () => {
    expect(tituloPeriodo('semana', '2026-11-12')).toBe('9 a 15 de novembro de 2026');
    expect(tituloPeriodo('semana', '2026-12-30')).toBe('28 de dezembro de 2026 a 3 de janeiro de 2027');
    expect(tituloPeriodo('mes', '2026-11-12')).toBe('Novembro de 2026');
    expect(tituloPeriodo('dia', '2026-11-10')).toBe('terça, 10 de novembro de 2026');
    expect(tituloPeriodo('semana', '2026-10-28')).toBe('26 de outubro a 1 de novembro de 2026');
  });
});

describe('grade de horas', () => {
  it('encaixe de 15 minutos', () => {
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(15);
    expect(snap(602)).toBe(600);
  });
  it('minutos no dia e de volta', () => {
    const d = instanteMin('2026-11-10', 9 * 60 + 30, SP);
    expect(d.toISOString()).toBe('2026-11-10T12:30:00.000Z');
    expect(minutosNoDia(d, '2026-11-10', SP)).toBe(570);
    expect(instanteMin('2026-11-10', 24 * 60, SP).toISOString()).toBe('2026-11-11T03:00:00.000Z');
  });
  it('eventos do dia incluem quem atravessa a meia-noite', () => {
    const ev = [{ inicio: '2026-11-11T02:00:00Z', fim: '2026-11-11T04:00:00Z' }]; // 23h às 01h
    expect(noDia(ev, '2026-11-10', SP)).toHaveLength(1);
    expect(noDia(ev, '2026-11-11', SP)).toHaveLength(1);
    expect(noDia(ev, '2026-11-12', SP)).toHaveLength(0);
  });
});

describe('repetição do formulário', () => {
  const base = { ...SEM_REPETICAO };
  it('sem repetição', () => {
    expect(montarRRule(base, '2026-11-10')).toBeNull();
    expect(descreverRepeticao(base, '2026-11-10')).toBe('Não se repete');
  });
  it('semanal em vários dias, 12 vezes', () => {
    const r = { ...base, frequencia: 'semanal' as const, diasSemana: [4, 2] };
    expect(montarRRule(r, '2026-11-10')).toBe('FREQ=WEEKLY;BYDAY=TU,TH;COUNT=12');
    expect(descreverRepeticao(r, '2026-11-10')).toBe('Semanal às terças e quintas, 12 vezes');
  });
  it('2ª terça do mês até uma data', () => {
    expect(posicaoNoMes('2026-11-10')).toBe(2);
    expect(posicaoNoMes('2026-11-24')).toBe(-1);
    const r = { ...base, frequencia: 'mensal_semana' as const, termino: 'data' as const, ate: '2027-03-31' };
    const rule = montarRRule(r, '2026-11-10')!;
    expect(rule).toBe('FREQ=MONTHLY;BYDAY=2TU;UNTIL=20270331T235959Z');
    expect(descreverRepeticao(r, '2026-11-10')).toBe('Mensal na 2ª terça, até 31/03/2027');
    const ocs = expandirSerie({ rrule: rule, inicioLocal: '2026-11-10T09:00', fuso: SP, duracaoMin: 60 }, {
      de: new Date('2026-11-01T00:00:00Z'),
      ate: new Date('2027-12-31T00:00:00Z'),
    });
    expect(ocs.map((o) => o.inicio.toISOString().slice(0, 10))).toEqual(['2026-11-10', '2026-12-08', '2027-01-12', '2027-02-09', '2027-03-09']);
  });
  it('a cada 2 semanas sem fim', () => {
    const r = { ...base, frequencia: 'semanal' as const, intervalo: 2, termino: 'nunca' as const };
    expect(montarRRule(r, '2026-11-10')).toBe('FREQ=WEEKLY;BYDAY=TU;INTERVAL=2');
    expect(descreverRepeticao(r, '2026-11-10')).toBe('A cada 2 semanas às terças, sem data para acabar');
  });
});

describe('decidirConflitos', () => {
  const c = (nivel: 'bloqueante' | 'aviso') => ({ ref: '0', inicio: new Date(), tipo: 'buffer' as const, nivel, detalhe: '', acaoSugerida: 'manter' as const });
  it('sem conflito salva', () => {
    expect(decidirConflitos([], false).ok).toBe(true);
  });
  it('aviso exige justificativa', () => {
    expect(decidirConflitos([c('aviso')], false).ok).toBe(false);
    expect(decidirConflitos([c('aviso')], false, 'cliente pediu').ok).toBe(true);
  });
  it('bloqueante: só admin, com justificativa', () => {
    expect(decidirConflitos([c('bloqueante')], false, 'urgente').ok).toBe(false);
    expect(decidirConflitos([c('bloqueante')], true).ok).toBe(false);
    const d = decidirConflitos([c('bloqueante')], true, 'urgente');
    expect(d.ok && d.registrar).toHaveLength(1);
  });
});

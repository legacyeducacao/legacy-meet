import { describe, expect, it } from 'vitest';
import { feriadosNacionais, type Feriado } from './feriados';
import {
  gerarJornada,
  ocorrenciasDoGrupo,
  previaImpactoFeriado,
  progressoJornada,
  proximoDiaSemana,
  reancorar,
  sugerirEntrada,
  type GrupoConfig,
} from './grupos';
import { addDays, weekdayIso } from './tempo';

const TERCA_1 = '2026-01-06';
const terca = (semana: number) => addDays(TERCA_1, 7 * (semana - 1));
const quinta = (semana: number) => addDays(terca(semana), 2);

const base = {
  hora: '09:00',
  duracaoMin: 120,
  fuso: 'America/Sao_Paulo',
  sequencia: ['F1', 'F2', 'C1', 'C2'],
  ancora: TERCA_1,
  entradasPermitidas: ['F1', 'C1'],
};
const grupo = (politica: 'pausa' | 'segue'): GrupoConfig[] => [
  { ...base, id: 'ter', nome: 'Grupo Terça', diaSemana: 2, defasagem: 0, politicaFeriado: politica },
  { ...base, id: 'qui', nome: 'Grupo Quinta', diaSemana: 4, defasagem: 1, politicaFeriado: politica },
];
const [TER, QUI] = grupo('pausa');
const feriadoLegacy = (data: string): Feriado => ({ data, nome: 'Recesso', escopo: 'legacy' });

describe('ocorrenciasDoGrupo', () => {
  it('reproduz a tabela de referência com horário real', () => {
    const t = ocorrenciasDoGrupo(TER, TERCA_1, terca(5));
    const q = ocorrenciasDoGrupo(QUI, TERCA_1, quinta(5));
    expect(t.map((o) => o.rotulo)).toEqual(['F1', 'F2', 'C1', 'C2', 'F1']);
    expect(q.map((o) => o.rotulo)).toEqual(['C2', 'F1', 'F2', 'C1', 'C2']);
    expect(t[0].inicio.toISOString()).toBe('2026-01-06T12:00:00.000Z');
    expect(t[0].fim.toISOString()).toBe('2026-01-06T14:00:00.000Z');
  });

  it('Tiradentes (terça, 21/04/2026) pausa só o grupo da terça', () => {
    const fer = feriadosNacionais(2026);
    expect(weekdayIso('2026-04-21')).toBe(2);
    // Sem feriado nenhum, 14/04 seria C1. Mas a terça de Carnaval (17/02/2026)
    // já pausou o grupo uma vez, então o ciclo da terça está uma semana atrás.
    expect(ocorrenciasDoGrupo(TER, '2026-04-14', '2026-04-14')[0].rotulo).toBe('C1');
    const t = ocorrenciasDoGrupo(TER, '2026-04-14', '2026-05-05', fer);
    expect(t.map((o) => [o.data, o.status, o.rotulo])).toEqual([
      ['2026-04-14', 'normal', 'F2'],
      ['2026-04-21', 'pausada_feriado', null],
      ['2026-04-28', 'normal', 'C1'],
      ['2026-05-05', 'normal', 'C2'],
    ]);
    // Sem contar pontos facultativos (Carnaval), só Tiradentes pausa.
    const t2 = ocorrenciasDoGrupo(TER, '2026-04-14', '2026-04-28', fer, { considerarFacultativos: false });
    expect(t2.map((o) => o.rotulo)).toEqual(['C1', null, 'C2']);
    const q = ocorrenciasDoGrupo(QUI, '2026-04-16', '2026-04-30', fer);
    expect(q.map((o) => o.rotulo)).toEqual(['F2', 'C1', 'C2']);
  });

  it("política 'segue': a semana é perdida e o calendário continua", () => {
    const [ter] = grupo('segue');
    const t = ocorrenciasDoGrupo(ter, terca(1), terca(4), [feriadoLegacy(terca(2))]);
    expect(t.map((o) => [o.status, o.rotulo])).toEqual([
      ['normal', 'F1'],
      ['perdida_feriado', 'F2'],
      ['normal', 'C1'],
      ['normal', 'C2'],
    ]);
  });
});

describe('regra de entrada', () => {
  it('em toda semana existe exatamente um grupo com Aula 1 (2 anos, sem feriados)', () => {
    for (let s = -20; s < 104; s++) {
      const t = ocorrenciasDoGrupo(TER, terca(s), terca(s))[0];
      const q = ocorrenciasDoGrupo(QUI, quinta(s), quinta(s))[0];
      const aula1 = [t, q].filter((o) => base.entradasPermitidas.includes(o.rotulo!));
      expect(aula1).toHaveLength(1);
    }
  });

  it('sem preferência de dia: entra na mesma semana (espera de no máximo 3 dias a partir da segunda)', () => {
    for (let s = 1; s <= 12; s++) {
      const segunda = addDays(terca(s), -1);
      const e = sugerirEntrada(grupo('pausa'), segunda)!;
      expect(e.esperaDias).toBeLessThanOrEqual(3);
      expect(['F1', 'C1']).toContain(e.rotulo);
    }
  });

  it('com dia fixo: nunca espera mais de uma semana além do próximo encontro do seu dia', () => {
    for (let d = 0; d < 56; d++) {
      const hoje = addDays(TERCA_1, d);
      for (const g of grupo('pausa')) {
        const e = sugerirEntrada(grupo('pausa'), hoje, [], { diaSemana: g.diaSemana })!;
        const proximo = proximoDiaSemana(hoje, g.diaSemana);
        expect([proximo, addDays(proximo, 7)]).toContain(e.data);
        expect(e.grupoId).toBe(g.id);
      }
    }
  });

  it('pula a semana pausada por feriado ao sugerir', () => {
    // Terça da semana 1 (F1) é feriado: a próxima Aula 1 na terça é a semana 2 (o ciclo andou).
    const e = sugerirEntrada(grupo('pausa'), terca(1), [feriadoLegacy(terca(1))], { diaSemana: 2 })!;
    expect(e.data).toBe(terca(2));
    expect(e.rotulo).toBe('F1');
  });
});

describe('jornada do cliente', () => {
  it('fluxo normal: 4 encontros seguidos no mesmo grupo', () => {
    const j = gerarJornada(grupo('pausa'), 'ter', terca(1));
    expect(j.encontros.map((e) => [e.numero, e.rotulo, e.grupoId, e.data, e.recuperacao])).toEqual([
      [1, 'F1', 'ter', terca(1), false],
      [2, 'F2', 'ter', terca(2), false],
      [3, 'C1', 'ter', terca(3), false],
      [4, 'C2', 'ter', terca(4), false],
    ]);
    expect(j.conclusao).toBe(terca(4));
  });

  it('entrada em C1 faz C1, C2, F1, F2', () => {
    const j = gerarJornada(grupo('pausa'), 'qui', quinta(4));
    expect(j.encontros.map((e) => e.rotulo)).toEqual(['C1', 'C2', 'F1', 'F2']);
    expect(j.encontros.every((e) => e.grupoId === 'qui')).toBe(true);
  });

  it('não deixa entrar numa Aula 2', () => {
    expect(() => gerarJornada(grupo('pausa'), 'ter', terca(2))).toThrow(/F2/);
  });

  it("feriado com 'pausa': a jornada só anda uma semana, sem recuperação", () => {
    const j = gerarJornada(grupo('pausa'), 'ter', terca(1), [feriadoLegacy(terca(2))]);
    expect(j.encontros.map((e) => [e.rotulo, e.data])).toEqual([
      ['F1', terca(1)],
      ['F2', terca(3)],
      ['C1', terca(4)],
      ['C2', terca(5)],
    ]);
    expect(j.encontros.some((e) => e.recuperacao)).toBe(false);
  });

  it("feriado com 'segue': recupera a aula perdida na próxima ocorrência dela (no outro grupo)", () => {
    const j = gerarJornada(grupo('segue'), 'ter', terca(1), [feriadoLegacy(terca(2))]);
    expect(j.encontros.map((e) => [e.rotulo, e.grupoId, e.data, e.recuperacao])).toEqual([
      ['F1', 'ter', terca(1), false],
      ['F2', 'qui', quinta(3), true],
      ['C1', 'qui', quinta(4), false],
      ['C2', 'qui', quinta(5), false],
    ]);
  });

  it("feriado com 'segue' sem trocar de grupo: espera a próxima F2 da terça", () => {
    const j = gerarJornada(grupo('segue'), 'ter', terca(1), [feriadoLegacy(terca(2))], { recuperarEmOutroGrupo: false });
    expect(j.encontros.map((e) => [e.rotulo, e.data])).toEqual([
      ['F1', terca(1)],
      ['F2', terca(6)],
      ['C1', terca(7)],
      ['C2', terca(8)],
    ]);
  });

  it('progresso 2/4 e próximo encontro', () => {
    const j = gerarJornada(grupo('pausa'), 'ter', terca(1));
    const p = progressoJornada(j, new Date(`${terca(2)}T20:00:00Z`));
    expect(p.rotulo).toBe('2/4');
    expect(p.proximo?.rotulo).toBe('C1');
    expect(p.concluida).toBe(false);
    expect(progressoJornada(j, new Date(`${terca(5)}T00:00:00Z`)).concluida).toBe(true);
  });
});

describe('prévia do impacto de um feriado', () => {
  it("mostra a semana pausada e o conteúdo que anda nas semanas seguintes ('pausa')", () => {
    const impacto = previaImpactoFeriado(grupo('pausa'), feriadoLegacy(terca(2)), [], terca(1), terca(4));
    expect(impacto.map((i) => [i.grupoId, i.data, i.antes?.rotulo, i.depois?.rotulo, i.depois?.status])).toEqual([
      ['ter', terca(2), 'F2', null, 'pausada_feriado'],
      ['ter', terca(3), 'C1', 'F2', 'normal'],
      ['ter', terca(4), 'C2', 'C1', 'normal'],
    ]);
  });
  it("na política 'segue' só a própria semana muda", () => {
    const impacto = previaImpactoFeriado(grupo('segue'), feriadoLegacy(terca(2)), [], terca(1), terca(4));
    expect(impacto).toHaveLength(1);
    expect(impacto[0].depois).toEqual({ rotulo: 'F2', status: 'perdida_feriado' });
  });
});

describe('mudar o dia do grupo', () => {
  it('o ciclo continua de onde estava, mesmo com feriado no dia antigo', () => {
    // Terça com recesso na semana 2: semanas 1..5 dão F1, (pausa), F2, C1, C2.
    const feriados = [feriadoLegacy(terca(2))];
    const antes = ocorrenciasDoGrupo(TER, terca(1), terca(5), feriados).map((o) => o.rotulo);
    expect(antes).toEqual(['F1', null, 'F2', 'C1', 'C2']);
    // A partir da semana 4 o grupo passa para quarta: a quarta da semana 4 tem que dar C1.
    const novo = { ...TER, diaSemana: 3, ...reancorar(TER.sequencia, 'C1', terca(4)) };
    const depois = ocorrenciasDoGrupo(novo, terca(4), addDays(terca(6), 1), feriados).map((o) => [o.data, o.rotulo]);
    expect(depois).toEqual([
      [addDays(terca(4), 1), 'C1'],
      [addDays(terca(5), 1), 'C2'],
      [addDays(terca(6), 1), 'F1'],
    ]);
  });
});

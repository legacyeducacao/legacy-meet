import { describe, it, expect } from 'vitest';
import {
  applyNpsFilters,
  categoryScores,
  emptyNpsFilters,
  presetRange,
  toggleScore,
  toggleCategory,
  trendByMonth,
  type NpsResponse,
} from './npsFilters';

const mk = (over: Partial<NpsResponse> = {}): NpsResponse => ({
  id: Math.random().toString(36).slice(2),
  meetingId: 'm',
  title: 'Onboarding',
  clientName: 'ACME',
  createdAt: '2026-09-10T12:00:00.000Z',
  score: 10,
  comment: null,
  respondentName: null,
  hostName: 'Ana',
  hostId: 'h',
  ...over,
});

describe('applyNpsFilters', () => {
  it('sem filtros devolve tudo', () => {
    const rs = [mk(), mk({ score: 3 })];
    expect(applyNpsFilters(rs, emptyNpsFilters())).toHaveLength(2);
  });

  it('filtra por notas selecionadas', () => {
    const rs = [mk({ score: 10 }), mk({ score: 8 }), mk({ score: 3 })];
    const out = applyNpsFilters(rs, { ...emptyNpsFilters(), scores: [8, 3] });
    expect(out.map((r) => r.score)).toEqual([8, 3]);
  });

  it('somente com comentário ignora comentários vazios', () => {
    const rs = [mk({ comment: 'ótimo' }), mk({ comment: '   ' }), mk({ comment: null })];
    const out = applyNpsFilters(rs, { ...emptyNpsFilters(), onlyWithComment: true });
    expect(out).toHaveLength(1);
    expect(out[0].comment).toBe('ótimo');
  });

  it('busca por texto ignora caixa e acentos em comentário, respondente, título e empresa', () => {
    const rs = [
      mk({ comment: 'Problema no ÁUDIO da sala' }),
      mk({ respondentName: 'João Gaspar' }),
      mk({ title: 'Reunião de acompanhamento' }),
      mk({ clientName: 'Big Creme' }),
      mk({ comment: 'nada a ver' }),
    ];
    const f = emptyNpsFilters();
    expect(applyNpsFilters(rs, { ...f, search: 'audio' })).toHaveLength(1);
    expect(applyNpsFilters(rs, { ...f, search: 'joao' })).toHaveLength(1);
    expect(applyNpsFilters(rs, { ...f, search: 'ACOMPANHAMENTO' })).toHaveLength(1);
    expect(applyNpsFilters(rs, { ...f, search: 'creme' })).toHaveLength(1);
    expect(applyNpsFilters(rs, { ...f, search: '  ' })).toHaveLength(5);
  });

  it('mantém filtros de empresa, anfitrião e datas', () => {
    const rs = [
      mk({ clientName: 'A', hostName: 'Ana', createdAt: '2026-09-01T00:00:00Z' }),
      mk({ clientName: 'B', hostName: 'Ana', createdAt: '2026-09-05T00:00:00Z' }),
      mk({ clientName: 'A', hostName: 'Bia', createdAt: '2026-09-20T00:00:00Z' }),
    ];
    const f = emptyNpsFilters();
    expect(applyNpsFilters(rs, { ...f, company: 'A' })).toHaveLength(2);
    expect(applyNpsFilters(rs, { ...f, host: 'Bia' })).toHaveLength(1);
    expect(applyNpsFilters(rs, { ...f, dateFrom: '2026-09-02', dateTo: '2026-09-10' })).toHaveLength(1);
  });
});

describe('seleção de notas', () => {
  it('categoryScores mapeia as faixas do NPS', () => {
    expect(categoryScores('detrator')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(categoryScores('neutro')).toEqual([7, 8]);
    expect(categoryScores('promotor')).toEqual([9, 10]);
  });

  it('toggleScore adiciona e remove uma nota', () => {
    expect(toggleScore([], 8)).toEqual([8]);
    expect(toggleScore([8, 3], 8)).toEqual([3]);
  });

  it('toggleCategory seleciona a faixa inteira e, se já estiver toda selecionada, remove', () => {
    expect(toggleCategory([], 'neutro')).toEqual([7, 8]);
    expect(toggleCategory([7], 'neutro')).toEqual([7, 8]);
    expect(toggleCategory([7, 8, 10], 'neutro')).toEqual([10]);
  });
});

describe('presetRange', () => {
  const today = new Date(2026, 8, 14); // 14/09/2026 (local)
  it('7 e 30 dias terminam hoje e incluem o dia de hoje na contagem', () => {
    expect(presetRange('7d', today)).toEqual({ from: '2026-09-08', to: '2026-09-14' });
    expect(presetRange('30d', today)).toEqual({ from: '2026-08-16', to: '2026-09-14' });
  });
  it('este mês vai do dia 1 até hoje', () => {
    expect(presetRange('month', today)).toEqual({ from: '2026-09-01', to: '2026-09-14' });
  });
  it('trimestre vai do início do trimestre corrente até hoje', () => {
    expect(presetRange('quarter', today)).toEqual({ from: '2026-07-01', to: '2026-09-14' });
    expect(presetRange('quarter', new Date(2026, 0, 5))).toEqual({ from: '2026-01-01', to: '2026-01-05' });
  });
});

describe('trendByMonth', () => {
  it('agrupa por mês em ordem cronológica com nps, média e total', () => {
    const rs = [
      mk({ createdAt: '2026-09-03T00:00:00Z', score: 10 }),
      mk({ createdAt: '2026-09-20T00:00:00Z', score: 4 }),
      mk({ createdAt: '2026-07-10T00:00:00Z', score: 9 }),
      mk({ createdAt: '2026-07-11T00:00:00Z', score: 8 }),
    ];
    expect(trendByMonth(rs)).toEqual([
      { month: '2026-07', label: 'jul/26', nps: 50, media: 8.5, total: 2 },
      { month: '2026-09', label: 'set/26', nps: 0, media: 7, total: 2 },
    ]);
  });
  it('lista vazia devolve vazio', () => {
    expect(trendByMonth([])).toEqual([]);
  });
});

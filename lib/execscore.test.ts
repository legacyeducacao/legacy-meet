import { describe, expect, it } from 'vitest';
import {
  activePillars,
  joinTranscriptParts,
  motivoForaDoScore,
  PILARES,
  roomFromRecordingId,
  sanitizeDisabled,
} from './execscore';

describe('sanitizeDisabled', () => {
  it('mantém só chaves válidas, sem repetição', () => {
    expect(sanitizeDisabled(['score_marketing', 'xyz', 'score_marketing', 3])).toEqual(['score_marketing']);
  });
  it('lista vazia = todos os pilares ativos', () => {
    expect(sanitizeDisabled([])).toEqual([]);
  });
  it('recusa desligar os seis', () => {
    expect(() => sanitizeDisabled(PILARES.map((p) => p.key))).toThrow(/pelo menos um/);
  });
  it('recusa formato que não é lista', () => {
    expect(() => sanitizeDisabled('score_marketing')).toThrow();
  });
});

describe('activePillars', () => {
  it('sem escolha = todos', () => {
    expect(activePillars(null)).toHaveLength(6);
  });
  it('remove os desligados preservando a ordem', () => {
    expect(activePillars(['score_financeiro', 'score_lideranca'])).toEqual([
      'score_estrategia', 'score_execucao', 'score_processos', 'score_marketing',
    ]);
  });
});

describe('roomFromRecordingId', () => {
  it('extrai a sala do id do egress', () => {
    expect(roomFromRecordingId('meet_abc-123__2026-11-06T13-00-00-000Z')).toBe('meet_abc-123');
  });
  it('rejeita ids sem separador ou com caracteres estranhos', () => {
    expect(roomFromRecordingId('semseparador')).toBeNull();
    expect(roomFromRecordingId('__2026')).toBeNull();
    expect(roomFromRecordingId('../x__2026')).toBeNull();
  });
});

describe('joinTranscriptParts', () => {
  it('uma parte volta sem cabeçalho', () => {
    expect(joinTranscriptParts([{ createdAt: '2026-11-06T10:00:00Z', text: ' oi \n' }])).toBe('oi');
  });
  it('várias partes saem em ordem cronológica e numeradas', () => {
    const out = joinTranscriptParts([
      { createdAt: '2026-11-06T11:00:00Z', text: 'segunda' },
      { createdAt: '2026-11-06T10:00:00Z', text: 'primeira' },
      { createdAt: '2026-11-06T12:00:00Z', text: '   ' },
    ]);
    expect(out).toBe('=== Parte 1 de 2 da reunião ===\nprimeira\n\n=== Parte 2 de 2 da reunião ===\nsegunda');
  });
  it('nada aproveitável vira string vazia', () => {
    expect(joinTranscriptParts([])).toBe('');
  });
});

describe('motivoForaDoScore', () => {
  it('reunião comum vai para o ExecScore', () => {
    expect(motivoForaDoScore({ onboarding: false, noShow: false })).toBeNull();
  });
  it('onboarding fica de fora', () => {
    expect(motivoForaDoScore({ onboarding: true, noShow: false })).toMatch(/onboarding/);
  });
  it('no-show fica de fora (e é o motivo que aparece, mesmo sendo onboarding)', () => {
    expect(motivoForaDoScore({ onboarding: true, noShow: true })).toMatch(/no-show/);
  });
});

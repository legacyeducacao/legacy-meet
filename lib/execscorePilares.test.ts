import { describe, expect, it } from 'vitest';
import { buildSaveBody, canTurnOff, initialDisabled, togglePilar, type Pilar } from './execscorePilares';

const PILARES: Pilar[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => ({ key: k, label: k.toUpperCase() }));

describe('initialDisabled', () => {
  it('sem escolha salva começa com todos ligados', () => {
    expect(initialDisabled(null, PILARES)).toEqual([]);
  });

  it('reflete a escolha salva, sem chaves desconhecidas nem repetidas', () => {
    expect(initialDisabled(['b', 'x', 'b', 'd'], PILARES)).toEqual(['b', 'd']);
  });

  it('escolha salva com tudo desligado volta a ligar todos', () => {
    expect(initialDisabled(['a', 'b', 'c', 'd', 'e', 'f'], PILARES)).toEqual([]);
  });
});

describe('canTurnOff', () => {
  it('permite desligar enquanto houver outro ligado', () => {
    expect(canTurnOff(['a', 'b', 'c', 'd'], 'e', PILARES)).toBe(true);
  });

  it('não deixa desligar o último ligado', () => {
    expect(canTurnOff(['a', 'b', 'c', 'd', 'e'], 'f', PILARES)).toBe(false);
  });

  it('um pilar já desligado sempre pode ser religado', () => {
    expect(canTurnOff(['a', 'b', 'c', 'd', 'e'], 'a', PILARES)).toBe(true);
  });
});

describe('togglePilar', () => {
  it('desliga e religa', () => {
    const off = togglePilar([], 'c', false, PILARES);
    expect(off).toEqual(['c']);
    expect(togglePilar(off, 'c', true, PILARES)).toEqual([]);
  });

  it('nunca deixa os 6 desligados', () => {
    let off: string[] = [];
    for (const p of PILARES) off = togglePilar(off, p.key, false, PILARES);
    expect(off).toHaveLength(5);
    expect(off).not.toContain('f');
  });

  it('desligar o que já está desligado não duplica', () => {
    expect(togglePilar(['a'], 'a', false, PILARES)).toEqual(['a']);
  });
});

describe('buildSaveBody', () => {
  it('no-show não manda pilares', () => {
    expect(buildSaveBody('sala', ['a'], true, false)).toEqual({ room: 'sala', noShow: true, onboarding: false });
  });
  it('onboarding sem no-show não manda pilares', () => {
    expect(buildSaveBody('sala', ['a'], false, true)).toEqual({ room: 'sala', noShow: false, onboarding: true });
  });
  it('reunião comum manda os pilares desligados e desliga o onboarding', () => {
    expect(buildSaveBody('sala', ['a'], false, false)).toEqual({ room: 'sala', noShow: false, onboarding: false, desabilitados: ['a'] });
  });
});

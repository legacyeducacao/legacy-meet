import { describe, expect, it } from 'vitest';
import { MAX_CO_HOSTS, normalizeCoHostIds } from './meetingHosts';

const allowed = new Set(['luan', 'leonardo', 'guilherme', ...Array.from({ length: 20 }, (_, i) => `u${i}`)]);

describe('normalizeCoHostIds', () => {
  it('mantém colaboradores conhecidos na ordem escolhida', () => {
    expect(normalizeCoHostIds(['leonardo', 'guilherme'], allowed, 'luan')).toEqual(['leonardo', 'guilherme']);
  });

  it('remove o próprio criador (ele já é o anfitrião)', () => {
    expect(normalizeCoHostIds(['luan', 'leonardo'], allowed, 'luan')).toEqual(['leonardo']);
  });

  it('ignora ids desconhecidos, repetidos e lixo', () => {
    expect(normalizeCoHostIds(['leonardo', 'cliente-x', 'leonardo', 42, null], allowed, 'luan')).toEqual([
      'leonardo',
    ]);
  });

  it('aceita só lista; qualquer outra coisa vira vazio', () => {
    expect(normalizeCoHostIds('leonardo', allowed, 'luan')).toEqual([]);
    expect(normalizeCoHostIds(undefined, allowed, 'luan')).toEqual([]);
  });

  it('limita a quantidade', () => {
    const many = Array.from({ length: 20 }, (_, i) => `u${i}`);
    expect(normalizeCoHostIds(many, allowed, 'luan')).toHaveLength(MAX_CO_HOSTS);
  });
});

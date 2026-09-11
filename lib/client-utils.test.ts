import { describe, expect, it } from 'vitest';
import { preferredDeviceId } from './client-utils';

describe('preferredDeviceId', () => {
  it('descarta os pseudo-dispositivos do Chrome (viram preferência, não filtro exato)', () => {
    expect(preferredDeviceId('default')).toBeUndefined();
    expect(preferredDeviceId('communications')).toBeUndefined();
  });

  it('descarta vazio, null e undefined', () => {
    expect(preferredDeviceId('')).toBeUndefined();
    expect(preferredDeviceId(null)).toBeUndefined();
    expect(preferredDeviceId(undefined)).toBeUndefined();
  });

  it('mantém um id real escolhido pelo usuário', () => {
    const id = '84ccef33-03e7-4f8e-940d-22fa070d4099';
    expect(preferredDeviceId(id)).toBe(id);
  });
});

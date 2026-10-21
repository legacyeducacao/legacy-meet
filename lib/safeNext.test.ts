import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safeNext';

describe('safeNextPath', () => {
  it('volta para a sala de onde o colaborador veio', () => {
    expect(safeNextPath('/rooms/meet_abc?rec=1&tx=1')).toBe('/rooms/meet_abc?rec=1&tx=1');
  });

  it('sem destino vai para o início', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath('')).toBe('/');
  });

  it('bloqueia destinos fora do Meet', () => {
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath('//evil.com/rooms')).toBe('/');
    expect(safeNextPath('/\\evil.com')).toBe('/');
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
  });

  it('não volta para o próprio login (laço)', () => {
    expect(safeNextPath('/login?next=/x')).toBe('/');
  });
});

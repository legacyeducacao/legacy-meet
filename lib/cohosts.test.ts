import { describe, expect, it } from 'vitest';
import { isCohostIdentity, parseCohosts, withCohost } from './cohosts';

describe('cohosts (metadados da sala)', () => {
  it('parse tolera vazio, JSON inválido e formatos estranhos', () => {
    expect(parseCohosts('')).toEqual([]);
    expect(parseCohosts(null)).toEqual([]);
    expect(parseCohosts('{oops')).toEqual([]);
    expect(parseCohosts('{"cohosts":"x"}')).toEqual([]);
    expect(parseCohosts('{"cohosts":["a",1,"b"]}')).toEqual(['a', 'b']);
  });

  it('withCohost adiciona sem duplicar, remove e preserva outros campos', () => {
    const m1 = withCohost('{"title":"t"}', 'ana__1', true);
    expect(JSON.parse(m1)).toEqual({ title: 't', cohosts: ['ana__1'] });
    const m2 = withCohost(m1, 'ana__1', true);
    expect(parseCohosts(m2)).toEqual(['ana__1']);
    const m3 = withCohost(m2, 'ana__1', false);
    expect(JSON.parse(m3)).toEqual({ title: 't', cohosts: [] });
  });

  it('isCohostIdentity', () => {
    expect(isCohostIdentity('{"cohosts":["ana__1"]}', 'ana__1')).toBe(true);
    expect(isCohostIdentity('{"cohosts":["ana__1"]}', 'bob__2')).toBe(false);
  });
});

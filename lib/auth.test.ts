import { describe, it, expect } from 'vitest';
import { canSeeExecutoria, canSeeComercial, canSeeNps } from './auth';

const mk = (over: Partial<import('./auth').CurrentUser> = {}) => ({
  id: 'u', email: 'e', name: 'n', isStaff: true, isAdmin: false, sector: 'ambos' as const, role: 'EXECUTOR', ...over,
});

describe('gates de setor', () => {
  it('admin vê tudo', () => {
    const u = mk({ isAdmin: true, sector: 'comercial' });
    expect(canSeeExecutoria(u)).toBe(true);
    expect(canSeeComercial(u)).toBe(true);
    expect(canSeeNps(u)).toBe(true);
  });
  it('comercial não vê executoria nem nps', () => {
    const u = mk({ sector: 'comercial' });
    expect(canSeeExecutoria(u)).toBe(false);
    expect(canSeeNps(u)).toBe(false);
    expect(canSeeComercial(u)).toBe(true);
  });
  it('executoria vê executoria/nps, não comercial', () => {
    const u = mk({ sector: 'executoria' });
    expect(canSeeExecutoria(u)).toBe(true);
    expect(canSeeNps(u)).toBe(true);
    expect(canSeeComercial(u)).toBe(false);
  });
  it('ambos vê os dois', () => {
    const u = mk({ sector: 'ambos' });
    expect(canSeeExecutoria(u)).toBe(true);
    expect(canSeeComercial(u)).toBe(true);
  });
  it('null/não-staff não vê nada', () => {
    expect(canSeeExecutoria(null)).toBe(false);
    expect(canSeeComercial(mk({ isStaff: false, sector: null }))).toBe(false);
  });
});

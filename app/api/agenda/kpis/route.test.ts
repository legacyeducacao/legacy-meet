import { describe, expect, it, vi } from 'vitest';

let admin = false;
const montar = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/agenda/rota', async () => {
  const { NextResponse } = await import('next/server');
  return {
    usuarioAgenda: async () => ({ user: { id: 'u1', isAdmin: admin } }),
    soAdmin: () => new NextResponse('Só um admin pode alterar isto', { status: 403 }),
  };
});
vi.mock('@/lib/agenda/painel', () => ({ montarPainel: (...a: unknown[]) => montar(...(a as [])) }));
vi.mock('@/lib/agenda/duracoes', () => ({ sincronizarDuracoes: async () => ({}) }));

const get = async () => {
  const { GET } = await import('./route');
  const { NextRequest } = await import('next/server');
  return GET(new NextRequest('http://x/api/agenda/kpis?de=2026-11-01&ate=2026-11-13&executor=todos'));
};

describe('GET /api/agenda/kpis', { timeout: 30000 }, () => {
  it('executor (não admin) não vê o painel', async () => {
    admin = false;
    const r = await get();
    expect(r.status).toBe(403);
    expect(montar).not.toHaveBeenCalled();
  });
  it('admin vê todos os executores', async () => {
    admin = true;
    const r = await get();
    expect(r.status).toBe(200);
    expect(montar).toHaveBeenCalledWith(expect.objectContaining({ executores: null }));
  });
});

import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// O que o middleware deixa abrir sem login (M3): só o agendamento público
// (/impulsao/* e /api/impulsao/*). A gestão dos convites e a busca de empresas
// continuam exigindo login.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

import { middleware } from '@/middleware';

const abre = async (caminho: string) => {
  const res = await middleware(new NextRequest(`https://meet.example${caminho}`));
  return !res.headers.get('location')?.includes('/login');
};

describe('middleware: rotas públicas do kickoff', () => {
  it('página e API do agendamento abrem sem login', async () => {
    expect(await abre('/impulsao/agendar/abcdefghjkmn')).toBe(true);
    expect(await abre('/api/impulsao/convites/abcdefghjkmn')).toBe(true);
    expect(await abre('/api/impulsao/convites/abcdefghjkmn/agendar')).toBe(true);
  });

  it('gestão de convites, busca de empresas e a seção de kickoffs continuam exigindo login', async () => {
    for (const c of ['/api/agenda/kickoffs/convites', '/api/agenda/kickoffs/empresas?q=ab', '/api/agenda/kickoffs', '/agenda/kickoffs', '/impulsaoX', '/api/impulsaox/x']) {
      expect(await abre(c)).toBe(false);
    }
  });
});

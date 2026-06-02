import { NextRequest, NextResponse } from 'next/server';

// Login fixo da equipe (sem banco). Protege a criação de reuniões (home) e o
// viewer de gravações. Convidados entram pelo link (/rooms/...) SEM login —
// essas rotas não estão no matcher abaixo.
const STAFF_COOKIE = 'staff_auth';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Libera a tela de login e a rota de login
  if (pathname === '/login' || pathname === '/api/staff/login') {
    return NextResponse.next();
  }

  const expected = process.env.STAFF_PASSWORD;
  // Sem senha configurada → não bloqueia (útil em dev)
  if (!expected) {
    return NextResponse.next();
  }

  if (req.cookies.get(STAFF_COOKIE)?.value === expected) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return new NextResponse('Não autorizado', { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Protegido: home (criar reunião) + viewer de gravações.
  // Aberto (fora do matcher): /rooms/*, /obrigado, /api/record, /api/meetings, /api/connection-details
  matcher: ['/', '/gravacoes/:path*', '/api/recordings/:path*'],
};

import { NextRequest, NextResponse } from 'next/server';

// Protege o viewer de gravações com uma senha simples (env RECORDINGS_PASSWORD).
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Libera a tela de login e a rota de login
  if (pathname === '/gravacoes/login' || pathname === '/api/recordings/login') {
    return NextResponse.next();
  }

  const expected = process.env.RECORDINGS_PASSWORD;
  // Sem senha configurada → não bloqueia (útil em dev)
  if (!expected) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get('recordings_auth')?.value;
  if (cookie === expected) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/recordings')) {
    return new NextResponse('Não autorizado', { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/gravacoes/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/gravacoes/:path*', '/api/recordings/:path*'],
};

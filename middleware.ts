import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Rotas PÚBLICAS (sem login): login, sala, obrigado, e APIs usadas por convidados/CRM/worker.
const PUBLIC_PREFIXES = ['/login', '/rooms', '/obrigado'];
const PUBLIC_API_PREFIXES = [
  '/api/connection-details', '/api/room/', '/api/meetings', '/api/record/', '/api/auth/',
  '/api/nps/context', '/api/nps/submit',
];

function isPublic(path: string) {
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || path === '/login')) return true;
  if (path.startsWith('/api/')) return PUBLIC_API_PREFIXES.some((p) => path.startsWith(p));
  return false;
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) => toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  if (!isPublic(path) && !user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|mp3|ico)$).*)'],
};

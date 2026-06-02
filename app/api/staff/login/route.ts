import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const expected = process.env.STAFF_PASSWORD;
  if (!expected) {
    return new NextResponse('STAFF_PASSWORD não configurado no servidor', { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (body.password !== expected) {
    return new NextResponse('Senha incorreta', { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set('staff_auth', expected, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

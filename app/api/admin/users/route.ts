import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await getCurrentUser();
  if (me?.role !== 'MASTER') return new NextResponse('Não autorizado', { status: 401 });
  const admin = createAdminSupabase();
  const { data } = await admin
    .from('users')
    .select('id,name,email,role')
    .in('role', ['MASTER', 'EXECUTOR'])
    .order('name');
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (me?.role !== 'MASTER') return new NextResponse('Não autorizado', { status: 401 });
  const { email, password, name, role } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
    role?: string;
  };
  if (!email || !password || !name)
    return new NextResponse('email, password e name são obrigatórios', { status: 400 });
  const finalRole = role === 'MASTER' ? 'MASTER' : 'EXECUTOR';
  const admin = createAdminSupabase();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !created.user)
    return new NextResponse('Falha ao criar: ' + (error?.message ?? ''), { status: 400 });
  const { error: e2 } = await admin
    .from('users')
    .insert({ id: created.user.id, email: email.trim(), name, role: finalRole });
  if (e2)
    return new NextResponse('Conta criada, mas falha no perfil: ' + e2.message, { status: 500 });
  return NextResponse.json({ ok: true });
}

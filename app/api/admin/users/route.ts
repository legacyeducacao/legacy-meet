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
  const cleanEmail = (email ?? '').trim();
  const cleanName = (name ?? '').trim();
  if (!cleanEmail || !password || !cleanName)
    return new NextResponse('email, password e name são obrigatórios', { status: 400 });
  const finalRole = role === 'MASTER' ? 'MASTER' : 'EXECUTOR';
  const admin = createAdminSupabase();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
    user_metadata: { name: cleanName },
  });
  if (error || !created.user)
    return new NextResponse('Falha ao criar: ' + (error?.message ?? ''), { status: 400 });
  const { error: e2 } = await admin
    .from('users')
    .insert({ id: created.user.id, email: cleanEmail, name: cleanName, role: finalRole });
  if (e2) {
    // desfaz a conta no Auth pra não deixar usuário órfão (sem perfil em public.users)
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return new NextResponse('Falha ao criar o perfil do usuário: ' + e2.message, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

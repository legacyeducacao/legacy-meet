import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const SECTORS = ['comercial', 'executoria', 'ambos'] as const;
type Sector = (typeof SECTORS)[number];
const asSector = (s: unknown): Sector => (SECTORS.includes(s as Sector) ? (s as Sector) : 'ambos');

export async function GET() {
  const me = await getCurrentUser();
  if (!me?.isAdmin) return new NextResponse('Não autorizado', { status: 401 });
  const admin = createAdminSupabase();
  // Só usuários internos do Meet: e-mail do domínio @legacyeducacaocorp.com.br
  // (evita listar clientes do Legacy Plan que compartilham a tabela `users`).
  const { data } = await admin
    .from('users')
    .select('id, name, email, role, meet_user_profile(is_admin, sector)')
    .ilike('email', '%@legacyeducacaocorp.com.br')
    .order('name');
  const users = ((data ?? []) as any[]).map((u) => {
    const p = Array.isArray(u.meet_user_profile) ? u.meet_user_profile[0] : u.meet_user_profile;
    return {
      id: u.id as string,
      name: u.name as string,
      email: u.email as string,
      isAdmin: p?.is_admin ?? false,
      sector: (p?.sector as Sector | undefined) ?? null,
    };
  });
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me?.isAdmin) return new NextResponse('Não autorizado', { status: 401 });
  const { email, password, name, sector } = (await req.json().catch(() => ({}))) as {
    email?: string; password?: string; name?: string; sector?: string;
  };
  const cleanEmail = (email ?? '').trim();
  const cleanName = (name ?? '').trim();
  if (!cleanEmail || !password || !cleanName)
    return new NextResponse('email, password e name são obrigatórios', { status: 400 });
  const admin = createAdminSupabase();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: cleanEmail, password, email_confirm: true, user_metadata: { name: cleanName },
  });
  if (error || !created.user)
    return new NextResponse('Falha ao criar: ' + (error?.message ?? ''), { status: 400 });
  const { error: e2 } = await admin
    .from('users')
    .insert({ id: created.user.id, email: cleanEmail, name: cleanName, role: 'EXECUTOR' });
  if (e2) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return new NextResponse('Falha ao criar o perfil do usuário: ' + e2.message, { status: 500 });
  }
  const { error: e3 } = await admin
    .from('meet_user_profile')
    .upsert({ user_id: created.user.id, is_admin: false, sector: asSector(sector) });
  if (e3)
    return new NextResponse('Perfil criado mas falha ao salvar o setor: ' + e3.message, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me?.isAdmin) return new NextResponse('Não autorizado', { status: 401 });
  const { userId, isAdmin, sector } = (await req.json().catch(() => ({}))) as {
    userId?: string; isAdmin?: boolean; sector?: string;
  };
  if (!userId) return new NextResponse('userId obrigatório', { status: 400 });
  const admin = createAdminSupabase();
  const { error } = await admin
    .from('meet_user_profile')
    .upsert({ user_id: userId, is_admin: !!isAdmin, sector: asSector(sector), updated_at: new Date().toISOString() });
  if (error) return new NextResponse('Falha ao salvar: ' + error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}

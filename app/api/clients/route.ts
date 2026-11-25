import { NextResponse } from 'next/server';
import { canSeeExecutoria, getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { filtroCarteira } from '@/lib/carteira';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const admin = createAdminSupabase();
  let query = admin.from('client_tenants').select('id, name').order('name');

  // Quem tem acesso à Executoria (admin, Executoria, Acesso geral) vê todos os
  // clientes para agendar (pedido do usuário em 25/11/2026). Os demais, só a
  // própria carteira (executor principal ou financeiro), que costuma ser vazia.
  if (!user.isStaff) return NextResponse.json({ clients: [] });
  if (!canSeeExecutoria(user)) {
    query = query.or(filtroCarteira(user.id));
  }

  const { data, error } = await query;
  if (error) return new NextResponse('Erro ao buscar clientes: ' + error.message, { status: 500 });

  return NextResponse.json({ clients: data ?? [] });
}

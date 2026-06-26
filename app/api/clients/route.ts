import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const admin = createAdminSupabase();
  let query = admin.from('client_tenants').select('id, name').order('name');

  // MASTER vê todos; demais veem só os seus (executor_id = user.id)
  if (user.role !== 'MASTER') {
    query = query.eq('executor_id', user.id);
  }

  const { data, error } = await query;
  if (error) return new NextResponse('Erro ao buscar clientes: ' + error.message, { status: 500 });

  return NextResponse.json({ clients: data ?? [] });
}
